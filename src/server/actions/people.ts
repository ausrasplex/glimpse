import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { schema } from "../db";
import { id, token, sha256 } from "../ids";
import { encrypt, decrypt } from "../crypto";
import { fail, notify, notifyAdmins } from "../core";
import { str, bool, num } from "../http";
import { enqueue } from "../queue";
import { saveSettings, ssoFromEnv } from "../settings";
import { createResetToken, resetLink, lastAdminGuard } from "../auth";
import { sendMail, sendWith } from "../mail";
import { testProvider } from "../oidc";
import { testImmich as pingImmich } from "../immich";
import { clear } from "../ratelimit";
import { env } from "../env";
import { sendInviteEmail } from "./projects";
import type { Action, Ctx } from "./types";

type DB = Ctx["db"];
const requireAdmin = (u: Ctx["user"]) => { if (u.role !== "ADMIN") fail(403, "Only admins can do that."); };
export const TOMBSTONE_DOMAIN = "@glimpse.invalid";

// Removes an account. "keep" leaves their clips in projects shared with others (the account becomes a
// nameless placeholder so those clips still have an author); "drop" removes everything they made.
export async function deleteUserCompletely(db: DB, userId: string, choice: "keep" | "drop") {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) return;
  const prefixes: string[] = [];
  const keys: string[] = [];
  await db.transaction(async (tx) => {
    // Projects they own: hand to the longest-standing other member, or delete if they're alone.
    const owned = await tx.select().from(schema.projects).where(eq(schema.projects.ownerId, userId));
    for (const p of owned) {
      const others = await tx.select().from(schema.members).where(and(eq(schema.members.projectId, p.id), eq(schema.members.status, "ACTIVE"), ne(schema.members.userId, userId))).orderBy(schema.members.joinedAt);
      if (others.length) {
        await tx.update(schema.members).set({ role: "OWNER" }).where(eq(schema.members.id, others[0].id));
        await tx.update(schema.projects).set({ ownerId: others[0].userId! }).where(eq(schema.projects.id, p.id));
        await notify(tx, others[0].userId!, { type: "INFO", title: `You now own ${p.name}`, body: `${u.name.split(" ")[0]}'s account was deleted, so the project passed to you.`, link: { route: "project", params: { projectId: p.id } } });
      } else await tx.delete(schema.projects).where(eq(schema.projects.id, p.id));
    }
    const mashes = await tx.select().from(schema.mashes).where(eq(schema.mashes.ownerId, userId));
    for (const m of mashes) keys.push(...[m.outputKey, m.posterKey].filter((k): k is string => !!k));
    if (u.avatarKey) keys.push(u.avatarKey);

    if (choice === "drop") {
      const media = await tx.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.ownerId, userId));
      if (media.length) prefixes.push(`media/${userId}/`);
      await tx.delete(schema.users).where(eq(schema.users.id, userId)); // cascades everything they own
      return;
    }
    // Keep clips that are in projects with other people.
    const mine = await tx.select().from(schema.entries).where(eq(schema.entries.authorId, userId));
    const keepProjects = new Set<string>();
    for (const pid of [...new Set(mine.map((e) => e.projectId))]) {
      const others = await tx.select({ id: schema.members.id }).from(schema.members).where(and(eq(schema.members.projectId, pid), eq(schema.members.status, "ACTIVE"), ne(schema.members.userId, userId)));
      if (others.length) keepProjects.add(pid);
    }
    const drop = mine.filter((e) => !keepProjects.has(e.projectId));
    if (drop.length) await tx.delete(schema.entries).where(inArray(schema.entries.id, drop.map((e) => e.id)));
    const allMedia = await tx.select().from(schema.media).where(eq(schema.media.ownerId, userId));
    for (const m of allMedia) {
      const still = await tx.query.entries.findFirst({ where: eq(schema.entries.mediaId, m.id) });
      if (!still) { await tx.delete(schema.media).where(eq(schema.media.id, m.id)); prefixes.push(`media/${userId}/${m.id}/`); }
    }
    await tx.delete(schema.mashes).where(eq(schema.mashes.ownerId, userId));
    await tx.delete(schema.members).where(eq(schema.members.userId, userId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await tx.delete(schema.reminders).where(eq(schema.reminders.userId, userId));
    await tx.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
    await tx.delete(schema.categories).where(eq(schema.categories.userId, userId));
    await tx.delete(schema.mashPicks).where(eq(schema.mashPicks.userId, userId));
    await tx.delete(schema.invites).where(eq(schema.invites.invitedBy, userId));
    await tx.delete(schema.removalRequests).where(eq(schema.removalRequests.userId, userId));
    await tx.update(schema.users).set({
      name: "Former member", email: `deleted+${userId}${TOMBSTONE_DOMAIN}`, role: "USER", disabled: true, passwordHash: null, oidcSub: null, ssoLinked: false,
      avatarKey: null, immichKeyEnc: null, prefs: {}, quotaGb: null
    }).where(eq(schema.users.id, userId));
  });
  if (keys.length || prefixes.length) await enqueue.deleteObjects(keys, prefixes);
}

// ---------- People ----------
export const adminSetUser: Action = async ({ db, user }, a) => {
  requireAdmin(user);
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, str(a.userId, 60)) });
  if (!target || target.email.endsWith(TOMBSTONE_DOMAIN)) fail(404, "That person wasn't found.");
  const o: Partial<typeof schema.users.$inferInsert> = {};
  if ("quota" in a) o.quotaGb = a.quota === null ? null : Math.round(num(a.quota, 1, 100000, 5));
  if (a.role === "ADMIN" || a.role === "USER") {
    if (a.role === "USER" && target!.role === "ADMIN") await lastAdminGuard([target!.id]);
    o.role = a.role;
  }
  if (typeof a.disabled === "boolean") {
    if (target!.id === user.id) fail(400, "You can't disable your own account.");
    if (a.disabled && target!.role === "ADMIN") await lastAdminGuard([target!.id]);
    o.disabled = a.disabled;
    if (a.disabled) await db.delete(schema.sessions).where(eq(schema.sessions.userId, target!.id));
  }
  if (bool(a.unlock)) { o.lockedUntil = null; o.failedLogins = 0; await clear("login-lock:" + sha256(target!.email)); }
  if (Object.keys(o).length) await db.update(schema.users).set(o).where(eq(schema.users.id, target!.id));
};

export const adminDeleteUser: Action = async ({ db, user }, a) => {
  requireAdmin(user);
  const uid = str(a.userId, 60);
  if (uid === user.id) fail(400, "Delete your own account from Profile instead.");
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, uid) });
  if (!target) fail(404, "That person wasn't found.");
  if (target!.role === "ADMIN") await lastAdminGuard([uid]);
  await deleteUserCompletely(db, uid, str(a.choice, 5) === "drop" ? "drop" : "keep");
};

// Email it if we can, otherwise give the admin a link to pass on.
export const adminResetLink: Action = async ({ db, user, settings }, a) => {
  requireAdmin(user);
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, str(a.userId, 60)) });
  if (!target || target.disabled) fail(404, "That person can't sign in right now.");
  const t = await createResetToken(target!.id);
  const link = resetLink(t);
  if (settings.email.ok && (await sendMail(target!.email, "Reset your Glimpse password", `${user.name.split(" ")[0]} sent you a link to set a new password on ${settings.name}. It works once, for 1 hour:\n\n${link}\n`, settings))) return { sent: true };
  return { sent: false, link };
};

export const createInviteLink: Action = async ({ db, user }) => {
  requireAdmin(user);
  const t = token(24);
  await db.insert(schema.invites).values({ id: id("i_"), tokenHash: sha256(t), tokenEnc: encrypt(t), email: null, invitedBy: user.id, projectId: null, status: "pending", expiresAt: new Date(Date.now() + 7 * 86400e3) });
  return { link: env.appUrl + "/invite/" + t };
};

export const inviteLink: Action = async ({ db, user }, a) => {
  const inv = await db.query.invites.findFirst({ where: eq(schema.invites.id, str(a.inviteId, 60)) });
  if (!inv || (inv.invitedBy !== user.id && user.role !== "ADMIN")) fail(404, "That invite wasn't found.");
  const t = decrypt(inv!.tokenEnc);
  if (!t || inv!.status !== "pending") fail(400, "That invite can't be copied any more. Revoke it and make a new one.");
  return { link: env.appUrl + "/invite/" + t };
};

export const approveInvite: Action = async ({ db, user, settings }, a) => {
  requireAdmin(user);
  const inv = await db.query.invites.findFirst({ where: eq(schema.invites.id, str(a.inviteId, 60)) });
  if (!inv || inv.status !== "needs") fail(404, "That request isn't waiting any more.");
  await db.update(schema.invites).set({ status: "pending", expiresAt: new Date(Date.now() + 7 * 86400e3) }).where(eq(schema.invites.id, inv!.id));
  const p = inv!.projectId ? await db.query.projects.findFirst({ where: eq(schema.projects.id, inv!.projectId) }) : null;
  const by = await db.query.users.findFirst({ where: eq(schema.users.id, inv!.invitedBy) });
  await notify(db, inv!.invitedBy, { type: "INFO", title: `Your invite to ${inv!.email} was approved`, body: p ? `They'll get an email to join ${p.name}` : "" });
  const link = env.appUrl + "/invite/" + decrypt(inv!.tokenEnc);
  const emailed = settings.email.ok && inv!.email ? (await sendInviteEmail({ email: inv!.email, link }, by?.name || user.name, p?.name || null, settings), true) : false;
  return { emailed, link: emailed ? null : link };
};

export const revokeInvite: Action = async ({ db, user }, a) => {
  const inv = await db.query.invites.findFirst({ where: eq(schema.invites.id, str(a.inviteId, 60)) });
  if (!inv || (inv.invitedBy !== user.id && user.role !== "ADMIN")) fail(404, "That invite wasn't found.");
  if (inv!.status === "needs" && inv!.invitedBy !== user.id) await notify(db, inv!.invitedBy, { type: "INFO", title: `Your invite to ${inv!.email} wasn't approved`, body: "Ask the admin if you think it should be." });
  await db.update(schema.invites).set({ status: inv!.status === "needs" ? "declined" : "revoked" }).where(eq(schema.invites.id, inv!.id));
  await db.delete(schema.members).where(eq(schema.members.inviteId, inv!.id));
};

export const contactAdmin: Action = async ({ db, user }) => {
  await notifyAdmins(db, { type: "INFO", title: `${user.name.split(" ")[0]} wants to get in touch`, body: `Sent from their Settings page · ${user.email}` }, user.id);
};

// ---------- Server settings ----------
const QUOTAS = [0, 1, 5, 10, 25];
export const setServer: Action = async ({ user }, a) => {
  requireAdmin(user);
  await saveSettings((s) => {
    if (typeof a.name === "string") s.name = a.name.trim().slice(0, 60) || "Home Server";
    if (typeof a.tz === "string") { try { new Intl.DateTimeFormat("en", { timeZone: a.tz }); s.tz = a.tz; } catch { /* ignore */ } }
    if (typeof a.userInvites === "boolean") s.userInvites = a.userInvites;
    if (typeof a.perDay === "number") s.perDay = Math.round(num(a.perDay, 1, 20, 5));
    if (typeof a.defaultQuota === "number" && QUOTAS.includes(a.defaultQuota)) s.defaultQuota = a.defaultQuota;
    if (typeof a.concurrency === "number") s.concurrency = Math.round(num(a.concurrency, 1, 4, 1));
    if (a.maxRes === "720" || a.maxRes === "1080" || a.maxRes === "4k") s.maxRes = a.maxRes;
    if (a.mashQuality === "smaller" || a.mashQuality === "high" || a.mashQuality === "best") s.mashQuality = a.mashQuality;
    if (a.playback === "720" || a.playback === "1080") s.playback = a.playback;
    if (typeof a.musicUploads === "boolean") s.musicUploads = a.musicUploads;
    if (typeof a.loudness === "boolean") s.loudness = a.loudness;
    if (typeof a.trackSize === "number" && [25, 50, 100].includes(a.trackSize)) s.trackSize = a.trackSize;
    if (a.formats && typeof a.formats === "object") {
      const f = a.formats as Record<string, unknown>;
      const next = { MP3: f.MP3 === true, M4A: f.M4A === true, WAV: f.WAV === true, FLAC: f.FLAC === true };
      if (Object.values(next).some(Boolean)) s.formats = next;
    }
    if (a.loginBg === "drift" || a.loginBg === "still") s.loginBg = a.loginBg;
    if (typeof a.lockAfter === "number") s.lockAfter = Math.round(num(a.lockAfter, 3, 10, 5));
    if (a.backup && typeof a.backup === "object") {
      const b = a.backup as Record<string, unknown>;
      if (b.schedule === "daily" || b.schedule === "weekly" || b.schedule === "off") s.backup.schedule = b.schedule;
      if (typeof b.keep === "number" && [3, 7, 14, 30].includes(b.keep)) s.backup.keep = b.keep;
    }
  });
};

export const setSso: Action = async ({ user }, a) => {
  requireAdmin(user);
  const env_ = ssoFromEnv();
  await saveSettings((s) => {
    if (typeof a.on === "boolean" && !env_) s.sso.on = a.on;
    if (typeof a.issuer === "string" && !env_) s.sso.issuer = a.issuer.trim().slice(0, 500);
    if (typeof a.clientId === "string" && !env_) s.sso.clientId = a.clientId.trim().slice(0, 300);
    if (typeof a.tested === "boolean") s.sso.tested = a.tested;
    if (typeof a.label === "string") s.sso.label = a.label.slice(0, 24);
    if (a.newAccounts === "invite" || a.newAccounts === "group") s.sso.newAccounts = a.newAccounts;
    if (typeof a.group === "string") s.sso.group = a.group.trim().slice(0, 100);
    if (typeof a.adminGroup === "string") s.sso.adminGroup = a.adminGroup.trim().slice(0, 100);
    if (typeof a.idpLogout === "boolean") s.sso.idpLogout = a.idpLogout;
    if (typeof a.passwordLogin === "boolean") s.sso.passwordLogin = a.passwordLogin;
    if (!s.sso.on) s.sso.passwordLogin = true;
  });
  if (a.passwordLogin === false) {
    if (!user.ssoLinked) { await saveSettings((s) => { s.sso.passwordLogin = true; }); fail(400, "Sign in with SSO once first, so your own account is linked."); }
  }
};

export const testSso: Action = async ({ user, settings }, a) => {
  requireAdmin(user);
  const issuer = ssoFromEnv() ? settings.sso.issuer : str(a.issuer, 500).trim();
  const clientId = ssoFromEnv() ? settings.sso.clientId : str(a.clientId, 300).trim();
  const secret = str(a.secret, 500) || (settings.sso.secretEnc ? decrypt(settings.sso.secretEnc) : null) || process.env.OIDC_CLIENT_SECRET || "";
  if (!/^https?:\/\/\S+$/.test(issuer)) fail(400, "The issuer URL should be the full address from your provider, starting with https://");
  if (!clientId || !secret) fail(400, "Fill in the client ID and secret from your provider.");
  let found: string;
  try { found = await testProvider(issuer, clientId, secret); } catch (e) { return fail(400, "Couldn't reach the provider: " + (e as Error).message); }
  await saveSettings((s) => { if (!ssoFromEnv()) { s.sso.issuer = issuer; s.sso.clientId = clientId; if (a.secret) s.sso.secretEnc = encrypt(str(a.secret, 500)); } s.sso.tested = true; });
  return { issuer: found };
};

export const setImmich: Action = async ({ user }, a) => {
  requireAdmin(user);
  await saveSettings((s) => {
    if (typeof a.on === "boolean") s.immich.on = a.on;
    if (typeof a.url === "string") s.immich.url = a.url.trim().slice(0, 300);
    if (typeof a.tested === "boolean") s.immich.tested = a.tested;
  });
};
export const testImmich: Action = async ({ user }, a) => {
  requireAdmin(user);
  const url = str(a.url, 300).trim();
  if (!/^https?:\/\/\S+$/.test(url)) fail(400, "Enter the full address, starting with http:// or https://");
  let version: string;
  try { version = await pingImmich(url); } catch (e) { return fail(400, "Couldn't reach Immich at " + url + ". " + (e as Error).message); }
  await saveSettings((s) => { s.immich.url = url; s.immich.tested = true; });
  return { version };
};

export const saveEmail: Action = async ({ user, settings }, a) => {
  requireAdmin(user);
  const host = str(a.host, 200).trim(), port = str(a.port, 6).trim() || "587", u = str(a.user, 200).trim(), from = str(a.from, 200).trim();
  const pass = str(a.pass, 500) || decrypt(settings.email.passEnc) || "";
  try { await sendWith({ host, port, user: u, pass, from }, user.email, "Glimpse test email", `Email from ${settings.name} is working.`); }
  catch (e) { await saveSettings((s) => { s.email.ok = false; }); return fail(400, "Couldn't send: " + (e as Error).message); }
  await saveSettings((s) => { s.email = { host, port, user: u, from, passEnc: a.pass ? encrypt(str(a.pass, 500)) : s.email.passEnc, ok: true }; });
};

export const backupNow: Action = async ({ user }) => { requireAdmin(user); await enqueue.backupNow(); };

export const dismissRemoval: Action = async ({ db, user }, a) => {
  requireAdmin(user);
  const r = await db.query.removalRequests.findFirst({ where: eq(schema.removalRequests.id, str(a.requestId, 60)) });
  if (!r) return;
  const t = await db.query.tracks.findFirst({ where: eq(schema.tracks.id, r.trackId) });
  await db.update(schema.removalRequests).set({ status: "dismissed" }).where(eq(schema.removalRequests.id, r.id));
  await notify(db, r.userId, { type: "INFO", title: `Your request to remove ${t?.title ?? "a track"} was dismissed`, body: "The track stays in the library." });
};

export const adminCancelRender: Action = async ({ db, user }, a) => {
  requireAdmin(user);
  const m = await db.query.mashes.findFirst({ where: eq(schema.mashes.id, str(a.mashId, 60)) });
  if (!m) return;
  await db.delete(schema.mashes).where(eq(schema.mashes.id, m.id));
  if (m.ownerId !== user.id) await notify(db, m.ownerId, { type: "INFO", title: `“${m.title}” was cancelled`, body: "The admin stopped this render. You can start it again from Mash." });
};

