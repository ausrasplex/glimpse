import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema } from "../db";
import { id, token, sha256 } from "../ids";
import { encrypt } from "../crypto";
import { fail, notify, notifyAdmins, requireMember, requireOwner, membership } from "../core";
import { str, bool } from "../http";
import { enqueue } from "../queue";
import { sendMail } from "../mail";
import { env } from "../env";
import type { Action, Ctx } from "./types";

const COLORS = ["#E8A33D", "#D9C04A", "#9BBF5A", "#6CC99B", "#5BA3A0", "#52BCCB", "#6FA8DC", "#7C89E3", "#9B87D6", "#B47AC9", "#E895C2", "#D9768F", "#EB8A72", "#D97757", "#C4A57F", "#8C96A3"];
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
type Tx = Ctx["db"] | Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

async function myCategory(tx: Tx, userId: string, catId: string) {
  const c = await tx.query.categories.findFirst({ where: and(eq(schema.categories.id, catId), eq(schema.categories.userId, userId)) });
  if (!c) fail(400, "Pick one of your categories.");
  return c!;
}

export const createProject: Action = async ({ db, user }, a) => {
  const name = str(a.name, 40).trim();
  if (!name) fail(400, "Give the project a name.");
  const cat = await myCategory(db, user.id, str(a.categoryId, 60));
  const pid = id("p_");
  await db.transaction(async (tx) => {
    await tx.insert(schema.projects).values({ id: pid, name, desc: str(a.desc, 300).trim(), ownerId: user.id });
    await tx.insert(schema.members).values({ id: id("mb_"), projectId: pid, userId: user.id, role: "OWNER", status: "ACTIVE", categoryId: cat.id, joinedAt: new Date(), lastViewedAt: new Date() });
  });
  return { projectId: pid };
};

export const saveProject: Action = async ({ db, user }, a) => {
  const pid = str(a.projectId, 60);
  const mem = await requireOwner(db, pid, user.id);
  const name = str(a.name, 40).trim();
  if (!name) fail(400, "Give the project a name.");
  let cover: string | null = str(a.cover, 60) || null;
  if (cover) {
    const used = await db.query.entries.findFirst({ where: and(eq(schema.entries.projectId, pid), eq(schema.entries.mediaId, cover)) });
    if (!used) cover = null;
  }
  await db.update(schema.projects).set({ name, desc: str(a.desc, 300).trim(), coverMediaId: cover }).where(eq(schema.projects.id, pid));
  if (a.categoryId) { const c = await myCategory(db, user.id, str(a.categoryId, 60)); await db.update(schema.members).set({ categoryId: c.id }).where(eq(schema.members.id, mem.id)); }
};

// Personal to each member: category, pin, archive.
export const setMemberPrefs: Action = async ({ db, user }, a) => {
  const mem = await requireMember(db, str(a.projectId, 60), user.id);
  const o: Partial<typeof schema.members.$inferInsert> = {};
  if (typeof a.pinned === "boolean") o.pinned = a.pinned;
  if (typeof a.archived === "boolean") o.archived = a.archived;
  if (a.categoryId) o.categoryId = (await myCategory(db, user.id, str(a.categoryId, 60))).id;
  if (Object.keys(o).length) await db.update(schema.members).set(o).where(eq(schema.members.id, mem.id));
};

// Remove a person's clips from one project; uploads used nowhere else are deleted.
async function dropClips(tx: Tx, projectId: string, userId: string) {
  const es = await tx.select().from(schema.entries).where(and(eq(schema.entries.projectId, projectId), eq(schema.entries.authorId, userId)));
  if (!es.length) return;
  await tx.delete(schema.entries).where(inArray(schema.entries.id, es.map((e) => e.id)));
  await gcMedia(tx, [...new Set(es.map((e) => e.mediaId))]);
}
export async function gcMedia(tx: Tx, mediaIds: string[]) {
  for (const mid of mediaIds) {
    const still = await tx.query.entries.findFirst({ where: eq(schema.entries.mediaId, mid) });
    if (still) continue;
    const m = await tx.query.media.findFirst({ where: eq(schema.media.id, mid) });
    if (!m) continue;
    await tx.delete(schema.media).where(eq(schema.media.id, mid));
    await enqueue.deleteObjects([], [`media/${m.ownerId}/${m.id}/`]);
  }
}

export const deleteProject: Action = async ({ db, user }, a) => {
  const pid = str(a.projectId, 60);
  await requireOwner(db, pid, user.id);
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, pid) });
  await db.transaction(async (tx) => {
    const others = await tx.select({ userId: schema.members.userId }).from(schema.members).where(and(eq(schema.members.projectId, pid), eq(schema.members.status, "ACTIVE"), ne(schema.members.userId, user.id)));
    for (const o of others) if (o.userId) await notify(tx, o.userId, { type: "INFO", title: `${p!.name} was deleted`, body: `By ${user.name.split(" ")[0]}. Your clips in other projects are untouched.` });
    const mediaIds = (await tx.select({ m: schema.entries.mediaId }).from(schema.entries).where(eq(schema.entries.projectId, pid))).map((r) => r.m);
    // Mashes already rendered belong to whoever made them and are kept (they no longer need the clips),
    // except shared ones when the owner chose to delete those too.
    const mashes = await tx.select().from(schema.mashes).where(eq(schema.mashes.projectId, pid));
    const delMashes = bool(a.deleteSharedMashes) ? mashes.filter((m) => m.shared) : [];
    if (delMashes.length) await tx.delete(schema.mashes).where(inArray(schema.mashes.id, delMashes.map((m) => m.id)));
    await tx.update(schema.mashes).set({ shared: false }).where(eq(schema.mashes.projectId, pid));
    await tx.delete(schema.projects).where(eq(schema.projects.id, pid)); // cascades entries and members; mashes keep their project name
    await enqueue.deleteObjects(delMashes.flatMap((m) => [m.outputKey, m.posterKey].filter((k): k is string => !!k)), []);
    await gcMedia(tx, [...new Set(mediaIds)]);
  });
};

export const leaveProject: Action = async ({ db, user }, a) => {
  const pid = str(a.projectId, 60);
  const mem = await requireMember(db, pid, user.id);
  if (mem.role === "OWNER") fail(400, "Make someone else the owner before you leave, or delete the project.");
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, pid) });
  const take = str(a.choice, 10) === "take";
  await db.transaction(async (tx) => {
    if (take) await dropClips(tx, pid, user.id);
    await tx.delete(schema.members).where(eq(schema.members.id, mem.id));
    await notify(tx, p!.ownerId, { type: "INFO", title: `${user.name.split(" ")[0]} left ${p!.name}`, body: take ? "They took their clips with them." : "Their clips stay in the project." });
  });
};

export const transferOwner: Action = async ({ db, user }, a) => {
  const pid = str(a.projectId, 60), to = str(a.userId, 60);
  await requireOwner(db, pid, user.id);
  const target = await membership(db, pid, to);
  if (!target) fail(404, "That person isn't in this project.");
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, pid) });
  await db.transaction(async (tx) => {
    await tx.update(schema.members).set({ role: "CONTRIBUTOR" }).where(and(eq(schema.members.projectId, pid), eq(schema.members.status, "ACTIVE")));
    await tx.update(schema.members).set({ role: "OWNER" }).where(eq(schema.members.id, target!.id));
    await tx.update(schema.projects).set({ ownerId: to }).where(eq(schema.projects.id, pid));
    await notify(tx, to, { type: "INFO", title: `You now own ${p!.name}`, body: `${user.name.split(" ")[0]} made you the owner.`, link: { route: "project", params: { projectId: pid } } });
  });
};

export const removeMember: Action = async ({ db, user }, a) => {
  const pid = str(a.projectId, 60), who = str(a.userId, 60);
  await requireOwner(db, pid, user.id);
  if (who === user.id) fail(400, "You can't remove yourself.");
  const m = await membership(db, pid, who);
  if (!m) fail(404, "That person isn't in this project.");
  await db.transaction(async (tx) => {
    if (str(a.choice, 10) === "drop") await dropClips(tx, pid, who);
    await tx.delete(schema.members).where(eq(schema.members.id, m!.id));
  });
};

// ---------- Invites into a project ----------
async function invitesToday(tx: Tx, userId: string) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.invites).where(and(eq(schema.invites.invitedBy, userId), sql`${schema.invites.createdAt} > now() - interval '1 day'`));
  const [{ m }] = await tx.select({ m: sql<number>`count(*)::int` }).from(schema.members).where(and(eq(schema.members.invitedBy, userId), sql`${schema.members.invitedAt} > now() - interval '1 day'`, sql`${schema.members.userId} is not null`));
  return n + m;
}

async function inviteExisting(tx: Tx, me: Ctx["user"], pid: string, target: typeof schema.users.$inferSelect, email: string | null = null) {
  const existing = await tx.query.members.findFirst({ where: and(eq(schema.members.projectId, pid), eq(schema.members.userId, target.id)) });
  if (existing) return;
  // A disabled account still gets a pending row (so the owner sees the same thing as for a new email), just no notification.
  if (target.disabled) { await tx.insert(schema.members).values({ id: id("mb_"), projectId: pid, userId: target.id, email, role: "CONTRIBUTOR", status: "INVITED", invitedBy: me.id, invitedAt: new Date() }); return; }
  const p = await tx.query.projects.findFirst({ where: eq(schema.projects.id, pid) });
  const [{ members }] = await tx.select({ members: sql<number>`count(*)::int` }).from(schema.members).where(and(eq(schema.members.projectId, pid), eq(schema.members.status, "ACTIVE")));
  const [{ clips }] = await tx.select({ clips: sql<number>`count(*)::int` }).from(schema.entries).where(eq(schema.entries.projectId, pid));
  await tx.insert(schema.members).values({ id: id("mb_"), projectId: pid, userId: target.id, email, role: "CONTRIBUTOR", status: "INVITED", invitedBy: me.id, invitedAt: new Date() });
  await notify(tx, target.id, { type: "PROJECT_INVITE", title: `${me.name.split(" ")[0]} invited you to ${p!.name}`, body: `${members} members · ${clips} clips`, action: { projectId: pid } });
}

// Someone you already share another project with.
export const inviteKnown: Action = async ({ db, user, settings }, a) => {
  const pid = str(a.projectId, 60), who = str(a.userId, 60);
  await requireOwner(db, pid, user.id);
  if (user.role !== "ADMIN" && settings.userInvites && (await invitesToday(db, user.id)) >= settings.perDay) fail(429, "You've used today's invites. Try again tomorrow.");
  const shared = await db.select({ p: schema.members.projectId }).from(schema.members).where(and(eq(schema.members.userId, user.id), eq(schema.members.status, "ACTIVE")));
  const known = shared.length ? await db.query.members.findFirst({ where: and(eq(schema.members.userId, who), eq(schema.members.status, "ACTIVE"), inArray(schema.members.projectId, shared.map((x) => x.p))) }) : null;
  if (!known && user.role !== "ADMIN") fail(404, "That person wasn't found.");
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, who) });
  if (!target) fail(404, "That person wasn't found.");
  await db.transaction((tx) => inviteExisting(tx, user, pid, target!));
};

// Invite by email. The response never says whether the email already has an account.
export const inviteByEmail: Action = async ({ db, user, settings }, a) => {
  const pid = str(a.projectId, 60);
  await requireOwner(db, pid, user.id);
  const em = str(a.email, 200).trim().toLowerCase();
  if (!validEmail(em)) fail(400, "That doesn't look like an email address.");
  const admin = user.role === "ADMIN";
  if (!admin && settings.userInvites && (await invitesToday(db, user.id)) >= settings.perDay) fail(429, "You've used today's invites. Try again tomorrow.");
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, pid) });
  let mailTo: { email: string; link: string } | null = null;
  await db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ where: eq(schema.users.email, em) });
    if (target) { await inviteExisting(tx, user, pid, target, em); return; }
    const already = await tx.query.members.findFirst({ where: and(eq(schema.members.projectId, pid), eq(schema.members.email, em), eq(schema.members.status, "INVITED")) });
    if (already) return;
    const needsApproval = !admin && !settings.userInvites;
    const t = token(24), iid = id("i_");
    await tx.insert(schema.invites).values({ id: iid, tokenHash: sha256(t), tokenEnc: encrypt(t), email: em, invitedBy: user.id, projectId: pid, status: needsApproval ? "needs" : "pending", expiresAt: new Date(Date.now() + 7 * 86400e3) });
    await tx.insert(schema.members).values({ id: id("mb_"), projectId: pid, userId: null, inviteId: iid, email: em, role: "CONTRIBUTOR", status: "INVITED", invitedBy: user.id, invitedAt: new Date() });
    if (needsApproval) await notifyAdmins(tx, { type: "APPROVAL", title: `${user.name.split(" ")[0]} wants to invite ${em}`, body: `Into ${p!.name} · needs your approval`, link: { route: "settings", params: { open: "people" } } }, user.id);
    else mailTo = { email: em, link: env.appUrl + "/invite/" + t };
  });
  // Not awaited: waiting on the mail server only for new addresses would make the response time give the answer away.
  if (mailTo) void sendInviteEmail(mailTo, user.name, p!.name, settings).catch(() => {});
};

export async function sendInviteEmail(to: { email: string; link: string }, fromName: string, projectName: string | null, settings: Ctx["settings"]) {
  await sendMail(to.email, `${fromName.split(" ")[0]} invited you to Glimpse`, `${fromName} invited you to join ${projectName ? projectName + " on " : ""}${settings.name}, a private video diary.\n\nCreate your account here (the link works once and expires in 7 days):\n${to.link}\n`, settings);
}

export const cancelProjectInvite: Action = async ({ db, user }, a) => {
  const pid = str(a.projectId, 60);
  await requireOwner(db, pid, user.id);
  const mid = str(a.memberId, 60);
  const m = await db.query.members.findFirst({ where: and(eq(schema.members.id, mid), eq(schema.members.projectId, pid), eq(schema.members.status, "INVITED")) });
  if (!m) return;
  await db.delete(schema.members).where(eq(schema.members.id, m.id));
  if (m.inviteId) await db.update(schema.invites).set({ status: "revoked" }).where(eq(schema.invites.id, m.inviteId));
};

// ---------- Categories (personal) ----------
export const addCategory: Action = async ({ db, user }, a) => {
  const n = await db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.userId, user.id));
  if (n.length >= 40) fail(400, "That's a lot of categories. Remove one first.");
  const cid = id("c_");
  const color = COLORS.includes(str(a.color, 9)) ? str(a.color, 9) : "#9B87D6";
  await db.insert(schema.categories).values({ id: cid, userId: user.id, name: str(a.name, 24).trim() || "New category", color, daily: bool(a.daily), sort: n.length });
  return { categoryId: cid };
};
export const patchCategory: Action = async ({ db, user }, a) => {
  const c = await myCategory(db, user.id, str(a.categoryId, 60));
  const o: Partial<typeof schema.categories.$inferInsert> = {};
  if (typeof a.name === "string") o.name = a.name.slice(0, 24).trim() || c.name;
  if (typeof a.color === "string" && COLORS.includes(a.color)) o.color = a.color;
  if (typeof a.daily === "boolean" && !c.isDefault) o.daily = a.daily;
  if (Object.keys(o).length) await db.update(schema.categories).set(o).where(eq(schema.categories.id, c.id));
};
export const deleteCategory: Action = async ({ db, user }, a) => {
  const c = await myCategory(db, user.id, str(a.categoryId, 60));
  if (c.isDefault) fail(400, "Diary and Freestyle can't be deleted.");
  const to = await myCategory(db, user.id, str(a.moveTo, 60));
  if (to.id === c.id) fail(400, "Pick a different category to move projects into.");
  await db.update(schema.members).set({ categoryId: to.id }).where(and(eq(schema.members.userId, user.id), eq(schema.members.categoryId, c.id)));
  await db.delete(schema.categories).where(eq(schema.categories.id, c.id));
};
