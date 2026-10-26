// Accounts: password sign-in, lockout, resets, invite sign-up, single sign-on and first-run setup.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { id, token, sha256 } from "./ids";
import { hashPassword, verifyPassword, encrypt } from "./crypto";
import { getSettings, saveSettings } from "./settings";
import { createSession } from "./session";
import { createUserBasics, fail, notify, notifyAdmins, freestyleCategory } from "./core";
import { hit, clear, ttl } from "./ratelimit";
import { sendMail } from "./mail";
import { env } from "./env";
import type { Identity } from "./oidc";

const LOCK_MIN = 15;
const COLORS = ["#9B87D6", "#52BCCB", "#EB8A72", "#6CC99B", "#E895C2", "#6FA8DC", "#D9C04A", "#D97757"];
export const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- Password sign-in ----------
export async function login(email: string, password: string, recovery: string | null, ip: string, ua: string | null) {
  const s = await getSettings();
  if (!s.setupDone) fail(409, "This server hasn't been set up yet.");
  if ((await hit("login-ip:" + ip, 900)) > 60) fail(429, `Too many sign-in attempts from your network. Try again in ${LOCK_MIN} minutes.`);
  const em = normEmail(email);
  const failKey = "login-fail:" + sha256(ip + "|" + em);
  const lockLeft = await ttl("login-lock:" + sha256(em));
  if (lockLeft > 0) fail(429, `Too many tries. Try again in ${Math.ceil(lockLeft / 60)} minutes.`);

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, em) });
  let viaRecovery = false;
  if (s.sso.on && !s.sso.passwordLogin) {
    const rec = recovery ? await db.query.settings.findFirst({ where: eq(schema.settings.key, "recovery") }) : null;
    const v = rec?.value as { hash?: string } | undefined;
    if (!recovery || !v?.hash || v.hash !== sha256(recovery)) fail(403, "Password sign-in is turned off on this server. Use single sign-on.");
    viaRecovery = true;
  }
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) {
    const n = await hit(failKey, LOCK_MIN * 60);
    if (n >= s.lockAfter) {
      await hit("login-lock:" + sha256(em), LOCK_MIN * 60);
      await clear(failKey);
      if (user) await db.update(schema.users).set({ lockedUntil: new Date(Date.now() + LOCK_MIN * 60e3) }).where(eq(schema.users.id, user.id));
      fail(429, `Too many tries. Try again in ${LOCK_MIN} minutes.`);
    }
    const left = s.lockAfter - n;
    fail(401, `That email and password don't match an account. ${left} ${left === 1 ? "try" : "tries"} left before a short lockout.`);
  }
  if (user!.disabled) fail(403, "This account is switched off. Ask the server admin to turn it back on.");
  if (viaRecovery) {
    if (user!.role !== "ADMIN") fail(403, "The recovery link is for admins only.");
    await db.delete(schema.settings).where(eq(schema.settings.key, "recovery"));
  }
  await clear(failKey);
  return { ok: true, ...(await createSession(user!.id, { userAgent: ua })) };
}

// ---------- Password reset ----------
export async function createResetToken(userId: string): Promise<string> {
  const t = token(32);
  await db.insert(schema.passwordResets).values({ tokenHash: sha256(t), userId, expiresAt: new Date(Date.now() + 3600e3) });
  return t;
}
export const resetLink = (t: string) => env.appUrl + "/reset/" + encodeURIComponent(t);

export async function requestReset(email: string, ip: string) {
  if ((await hit("reset-ip:" + ip, 3600)) > 10) return; // quietly stop; same response either way
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, normEmail(email)) });
  if (!user || user.disabled) return;
  const s = await getSettings();
  const t = await createResetToken(user.id);
  await sendMail(user.email, "Reset your Glimpse password", `Hi ${user.name.split(" ")[0]},\n\nSomeone asked to reset the password for your account on ${s.name}. If that was you, open this link within an hour:\n\n${resetLink(t)}\n\nIf it wasn't you, you can ignore this email. Your password won't change.\n`, s);
}

export async function confirmReset(t: string, password: string, ua: string | null) {
  if (password.length < 10) fail(400, "Use at least 10 characters.");
  const row = await db.query.passwordResets.findFirst({ where: and(eq(schema.passwordResets.tokenHash, sha256(t)), gt(schema.passwordResets.expiresAt, new Date())) });
  if (!row || row.usedAt) fail(400, "This reset link has expired or was already used. Ask for a new one.");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, row!.userId) });
  if (!user || user.disabled) fail(400, "This reset link doesn't work any more.");
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, user!.id));
  await db.update(schema.passwordResets).set({ usedAt: new Date() }).where(eq(schema.passwordResets.tokenHash, row!.tokenHash));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user!.id));
  await clear("login-lock:" + sha256(user!.email));
  return createSession(user!.id, { userAgent: ua });
}

// ---------- Invites ----------
export async function findInvite(t: string) {
  if (!t) return null;
  const inv = await db.query.invites.findFirst({ where: eq(schema.invites.tokenHash, sha256(t)) });
  if (!inv || inv.status !== "pending" || inv.expiresAt < new Date()) return null;
  return inv;
}

export async function inviteInfo(t: string) {
  const inv = await findInvite(t);
  if (!inv) return null;
  const by = await db.query.users.findFirst({ where: eq(schema.users.id, inv.invitedBy) });
  let project: { name: string; members: number; clips: number; strip: string[] } | null = null;
  if (inv.projectId) {
    const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, inv.projectId) });
    if (p) {
      const [{ n: members }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.members).where(and(eq(schema.members.projectId, p.id), eq(schema.members.status, "ACTIVE")));
      const [{ n: clips }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.entries).where(eq(schema.entries.projectId, p.id));
      const last = await db.select({ mediaId: schema.entries.mediaId }).from(schema.entries).where(eq(schema.entries.projectId, p.id)).orderBy(sql`${schema.entries.createdAt} desc`).limit(5);
      project = { name: p.name, members, clips, strip: last.reverse().map((e) => `/api/files/media/${e.mediaId}/poster?invite=${encodeURIComponent(t)}`) };
    }
  }
  return {
    email: inv.email, project, daysLeft: Math.max(1, Math.ceil((inv.expiresAt.getTime() - Date.now()) / 86400e3)),
    inviter: { name: by?.name || "Someone", color: by?.color || "#E8A33D", photo: by?.avatarKey ? `/api/files/avatar/${by.id}?invite=${encodeURIComponent(t)}` : null }
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Create an account (from an invite, SSO group, or setup) with the usual starting data.
async function createAccount(tx: Tx, o: { name: string; email: string; passwordHash: string | null; tz: string; role?: string; oidcSub?: string | null }) {
  const s = await getSettings();
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  const uid = id("u_");
  await tx.insert(schema.users).values({
    id: uid, name: o.name, email: o.email, role: o.role || "USER", color: COLORS[n % COLORS.length], tz: o.tz || s.tz,
    quotaGb: o.role === "ADMIN" ? null : s.defaultQuota || null, passwordHash: o.passwordHash, oidcSub: o.oidcSub || null, ssoLinked: !!o.oidcSub,
    prefs: { accent: "#E8A33D", badge: "dot", milestones: true, fill: "blur", onThisDay: true }
  });
  await createUserBasics(tx, uid, s.email.ok);
  return uid;
}

async function acceptInvite(tx: Tx, inv: typeof schema.invites.$inferSelect, userId: string, name: string) {
  await tx.update(schema.invites).set({ status: "accepted", acceptedAt: new Date(), acceptedUserId: userId }).where(eq(schema.invites.id, inv.id));
  if (inv.projectId) {
    const p = await tx.query.projects.findFirst({ where: eq(schema.projects.id, inv.projectId) });
    const cat = await freestyleCategory(tx, userId);
    const m = await tx.query.members.findFirst({ where: and(eq(schema.members.projectId, inv.projectId), eq(schema.members.inviteId, inv.id)) });
    if (m) await tx.update(schema.members).set({ userId, status: "ACTIVE", categoryId: cat, joinedAt: new Date(), pinned: true, archived: false, lastViewedAt: new Date(), email: null }).where(eq(schema.members.id, m.id));
    else await tx.insert(schema.members).values({ id: id("mb_"), projectId: inv.projectId, userId, role: "CONTRIBUTOR", status: "ACTIVE", categoryId: cat, pinned: true, joinedAt: new Date(), lastViewedAt: new Date(), invitedBy: inv.invitedBy, invitedAt: inv.createdAt });
    if (p) {
      const others = await tx.select({ userId: schema.members.userId }).from(schema.members).where(and(eq(schema.members.projectId, p.id), eq(schema.members.status, "ACTIVE")));
      const inviter = await tx.query.users.findFirst({ where: eq(schema.users.id, inv.invitedBy) });
      for (const o of others) if (o.userId && o.userId !== userId) await notify(tx, o.userId, { type: "MEMBER_JOINED", title: `${name} joined ${p.name}`, body: inviter ? "Invited by " + inviter.name.split(" ")[0] : "", link: { route: "project", params: { projectId: p.id } } });
    }
  }
  await notify(tx, inv.invitedBy, { type: "INVITE_ACCEPTED", title: `${name} joined your server`, body: inv.email ? `Your invite to ${inv.email} was accepted.` : "Your invite link was used to create an account." });
}

export async function signup(o: { token: string; name: string; email: string; password: string; tz: string }, ua: string | null) {
  const s = await getSettings();
  if (s.sso.on && !s.sso.passwordLogin) fail(403, "This server only uses single sign-on. Use the SSO button to join.");
  const inv = await findInvite(o.token);
  if (!inv) fail(400, "This invite link doesn't work any more. Ask for a new one.");
  const name = o.name.trim().slice(0, 80);
  if (!name) fail(400, "Add your name.");
  if (o.password.length < 10) fail(400, "Use at least 10 characters for your password.");
  const email = inv!.email ? normEmail(inv!.email) : normEmail(o.email);
  if (!validEmail(email)) fail(400, "That doesn't look like an email address.");
  const taken = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (taken) fail(400, "Use a different email address.");
  const hash = await hashPassword(o.password);
  const uid = await db.transaction(async (tx) => {
    const u = await createAccount(tx, { name, email, passwordHash: hash, tz: o.tz });
    await acceptInvite(tx, inv!, u, name);
    return u;
  });
  return { projectId: inv!.projectId, ...(await createSession(uid, { userAgent: ua })) };
}

// ---------- Single sign-on ----------
export type SsoResult = { userId: string } | { error: string } | { linked: true };

export async function ssoSignIn(idn: Identity, opts: { inviteToken?: string | null; linkUserId?: string | null }): Promise<SsoResult> {
  const s = await getSettings();
  if (!s.sso.on) return { error: "sso_off" };
  const adminGroup = s.sso.adminGroup.trim();
  const makeAdmin = !!adminGroup && idn.groups.includes(adminGroup);

  // Linking from Profile: attach this identity to the signed-in person.
  if (opts.linkUserId) {
    const other = await db.query.users.findFirst({ where: eq(schema.users.oidcSub, idn.sub) });
    if (other && other.id !== opts.linkUserId) return { error: "linked_elsewhere" };
    await db.update(schema.users).set({ oidcSub: idn.sub, ssoLinked: true }).where(eq(schema.users.id, opts.linkUserId));
    return { linked: true };
  }

  let user = await db.query.users.findFirst({ where: eq(schema.users.oidcSub, idn.sub) });
  if (!user && idn.email) {
    if (!idn.emailVerified) return { error: "email_unverified" };
    user = await db.query.users.findFirst({ where: eq(schema.users.email, idn.email) });
    if (user && user.oidcSub && user.oidcSub !== idn.sub) return { error: "failed" };
  }
  if (user) {
    if (user.disabled) return { error: "disabled" };
    await db.update(schema.users).set({ oidcSub: idn.sub, ssoLinked: true, ...(makeAdmin ? { role: "ADMIN" } : {}) }).where(eq(schema.users.id, user.id));
    // An invite that's still open for this person (e.g. into a project) is accepted too.
    if (opts.inviteToken) {
      const inv = await findInvite(opts.inviteToken);
      if (inv && inv.projectId && (!inv.email || normEmail(inv.email) === user.email)) await db.transaction((tx) => acceptInvite(tx, inv, user!.id, user!.name));
    }
    return { userId: user.id };
  }

  if (!idn.email || !idn.emailVerified) return { error: "email_unverified" };
  let inv = opts.inviteToken ? await findInvite(opts.inviteToken) : null;
  if (inv && inv.email && normEmail(inv.email) !== idn.email) return { error: "no_account" };
  if (!inv) inv = (await db.query.invites.findFirst({ where: and(eq(schema.invites.email, idn.email), eq(schema.invites.status, "pending"), gt(schema.invites.expiresAt, new Date())) })) || null;
  const inGroup = s.sso.newAccounts === "group" && !!s.sso.group.trim() && idn.groups.includes(s.sso.group.trim());
  if (!inv && !inGroup) return { error: "no_account" };

  const uid = await db.transaction(async (tx) => {
    const u = await createAccount(tx, { name: idn.name, email: idn.email!, passwordHash: null, tz: s.tz, role: makeAdmin ? "ADMIN" : "USER", oidcSub: idn.sub });
    if (inv) await acceptInvite(tx, inv, u, idn.name);
    else await notifyAdmins(tx, { type: "INFO", title: `${idn.name} joined through SSO`, body: `Member of ${s.sso.group.trim()} · ${idn.email}`, link: { route: "settings", params: { open: "people" } } }, u);
    return u;
  });
  return { userId: uid };
}

// ---------- First-run setup ----------
export async function checkSetupCode(code: string, ip: string) {
  const s = await getSettings();
  if (s.setupDone) fail(410, "Setup is already finished.");
  if ((await hit("setup-ip:" + ip, 3600)) > 30) fail(429, "Too many attempts. Restart the container for a new code, then try again in an hour.");
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "setup") });
  const v = row?.value as { hash?: string } | undefined;
  if (!v?.hash || v.hash !== sha256(code.replace(/\D/g, ""))) fail(403, "That code doesn't match. Check the latest line in the logs. A new code is printed each time the container restarts.");
}

export async function finishSetup(o: { name: string; email: string; password: string; tz: string; serverName: string; quota: number; smtp: null | { host: string; port: string; user: string; pass: string; from: string }; sso: null | { issuer: string; clientId: string; secret: string } }, ua: string | null) {
  if (!o.name.trim()) fail(400, "Add your name.");
  const email = normEmail(o.email);
  if (!validEmail(email)) fail(400, "That doesn't look like an email address.");
  if (o.password.length < 10) fail(400, "Use at least 10 characters for your password.");
  const hash = await hashPassword(o.password);
  const uid = await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${schema.settings} IN EXCLUSIVE MODE`);
    const admins = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, "ADMIN"));
    if (admins.length) fail(410, "Setup is already finished.");
    const u = await createAccount(tx, { name: o.name.trim().slice(0, 80), email, passwordHash: hash, tz: o.tz, role: "ADMIN" });
    await tx.delete(schema.settings).where(eq(schema.settings.key, "setup"));
    return u;
  });
  await saveSettings((s) => {
    s.setupDone = true; s.name = o.serverName.trim().slice(0, 60) || "Home Server"; s.tz = o.tz || s.tz;
    s.defaultQuota = [0, 1, 5, 10, 25].includes(o.quota) ? o.quota : 5;
    if (o.smtp) s.email = { host: o.smtp.host, port: o.smtp.port, user: o.smtp.user, passEnc: o.smtp.pass ? encrypt(o.smtp.pass) : null, from: o.smtp.from, ok: true };
    if (o.sso) s.sso = { ...s.sso, on: true, issuer: o.sso.issuer, clientId: o.sso.clientId, secretEnc: encrypt(o.sso.secret), tested: true };
  });
  if (o.smtp) await db.update(schema.reminders).set({ email: true }).where(and(eq(schema.reminders.userId, uid), eq(schema.reminders.time, "08:00")));
  return createSession(uid, { userAgent: ua });
}

export async function lastAdminGuard(userIds: string[]) {
  const admins = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, "ADMIN"), eq(schema.users.disabled, false)));
  if (admins.every((a) => userIds.includes(a.id))) fail(400, "There must always be at least one active admin.");
}
export { inArray };
