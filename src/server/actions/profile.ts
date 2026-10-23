import { and, eq, ne } from "drizzle-orm";
import { schema } from "../db";
import { id } from "../ids";
import { encrypt } from "../crypto";
import { hashPassword, verifyPassword } from "../crypto";
import { fail } from "../core";
import { str, bool } from "../http";
import { enqueue } from "../queue";
import { signOutOthers, destroySession } from "../session";
import { testImmich } from "../immich";
import { STAMP_DEFAULT } from "../../shared/mash";
import { deleteUserCompletely } from "./people";
import type { Action } from "./types";

const PALETTE = ["#E8A33D", "#D9C04A", "#9BBF5A", "#6CC99B", "#5BA3A0", "#52BCCB", "#6FA8DC", "#7C89E3", "#9B87D6", "#B47AC9", "#E895C2", "#D9768F", "#EB8A72", "#D97757", "#C4A57F", "#8C96A3"];

export const setPrefs: Action = async ({ db, user }, a) => {
  const p = { ...(user.prefs as Record<string, unknown>) };
  if (PALETTE.includes(str(a.accent, 9))) p.accent = a.accent;
  if (a.badge === "dot" || a.badge === "count") p.badge = a.badge;
  if (typeof a.milestones === "boolean") p.milestones = a.milestones;
  if (typeof a.onThisDay === "boolean") p.onThisDay = a.onThisDay;
  if (["blur", "crop", "bars"].includes(str(a.fill, 5))) p.fill = a.fill;
  if (a.stamp && typeof a.stamp === "object") {
    const s = a.stamp as Record<string, unknown>;
    p.stamp = {
      on: s.on !== false, show: ["date", "dateNote", "day"].includes(str(s.show, 9)) ? s.show : STAMP_DEFAULT.show, format: ["short", "long", "num"].includes(str(s.format, 5)) ? s.format : "short",
      pos: ["tl", "tr", "bl", "br"].includes(str(s.pos, 2)) ? s.pos : "tr", style: ["pill", "plain", "bold"].includes(str(s.style, 5)) ? s.style : "pill", size: ["s", "m", "l"].includes(str(s.size, 1)) ? s.size : "m"
    };
  }
  await db.update(schema.users).set({ prefs: p }).where(eq(schema.users.id, user.id));
};

export const updateProfile: Action = async ({ db, user }, a) => {
  const o: Partial<typeof schema.users.$inferInsert> = {};
  if (typeof a.name === "string") { const n = a.name.trim().slice(0, 80); if (!n) fail(400, "Your name can't be empty"); o.name = n; }
  if (typeof a.tz === "string") { try { new Intl.DateTimeFormat("en", { timeZone: a.tz }); o.tz = a.tz; } catch { fail(400, "That timezone isn't recognised."); } }
  if (typeof a.email === "string") {
    const em = a.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) fail(400, "That doesn't look like an email address");
    if (em !== user.email) {
      const taken = await db.query.users.findFirst({ where: and(eq(schema.users.email, em), ne(schema.users.id, user.id)) });
      if (taken) fail(400, "That email can't be used");
      o.email = em;
    }
  }
  if (Object.keys(o).length) await db.update(schema.users).set(o).where(eq(schema.users.id, user.id));
};

export const removeAvatar: Action = async ({ db, user }) => {
  if (user.avatarKey) await enqueue.deleteObjects([user.avatarKey]);
  await db.update(schema.users).set({ avatarKey: null }).where(eq(schema.users.id, user.id));
};

export const changePassword: Action = async ({ db, user }, a) => {
  const pw = str(a.password, 500);
  if (pw.length < 10) fail(400, "Use at least 10 characters.");
  if (user.passwordHash && !(await verifyPassword(str(a.current, 500), user.passwordHash))) fail(400, "That isn't your current password.");
  await db.update(schema.users).set({ passwordHash: await hashPassword(pw) }).where(eq(schema.users.id, user.id));
  if (bool(a.signOutOthers)) await signOutOthers(user.id);
};

export const unlinkSso: Action = async ({ db, user, settings }) => {
  if (!user.passwordHash) fail(400, "Set a password first, so you can still sign in.");
  if (settings.sso.on && !settings.sso.passwordLogin) fail(400, "This server only uses SSO, so unlinking would lock you out.");
  await db.update(schema.users).set({ oidcSub: null, ssoLinked: false }).where(eq(schema.users.id, user.id));
};

export const connectImmich: Action = async ({ db, user, settings }, a) => {
  if (!settings.immich.on) fail(400, "Immich import is turned off.");
  const key = str(a.key, 300).trim();
  if (key.length < 8) fail(400, "That doesn't look like an Immich API key.");
  try { await testImmich(settings.immich.url, key); } catch (e) { fail(400, "Immich didn't accept that key: " + (e as Error).message); }
  await db.update(schema.users).set({ immichKeyEnc: encrypt(key) }).where(eq(schema.users.id, user.id));
};
export const disconnectImmich: Action = async ({ db, user }) => {
  await db.update(schema.users).set({ immichKeyEnc: null }).where(eq(schema.users.id, user.id));
};

// ---------- Reminders ----------
export const saveReminder: Action = async ({ db, user }, a) => {
  const rid = str(a.id, 60);
  const existing = rid ? await db.query.reminders.findFirst({ where: and(eq(schema.reminders.id, rid), eq(schema.reminders.userId, user.id)) }) : null;
  if (rid && !existing) fail(404, "That reminder wasn't found.");
  const o: Partial<typeof schema.reminders.$inferInsert> = {};
  if (typeof a.time === "string") { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)) fail(400, "Bad time."); o.time = a.time; }
  if (typeof a.message === "string") { const m = a.message.trim().slice(0, 120); if (!m) fail(400, "Add a message."); o.message = m; }
  if (a.rule === "always" || a.rule === "check") o.rule = a.rule;
  if (Array.isArray(a.days) && a.days.length === 7) o.days = a.days.map((x) => (x ? 1 : 0));
  for (const k of ["email", "inapp", "on"] as const) if (typeof a[k] === "boolean") o[k] = a[k] as boolean;
  if (existing) await db.update(schema.reminders).set(o).where(eq(schema.reminders.id, existing.id));
  else {
    if (!o.time || !o.message) fail(400, "Add a time and a message.");
    const n = await db.select({ id: schema.reminders.id }).from(schema.reminders).where(eq(schema.reminders.userId, user.id));
    if (n.length >= 20) fail(400, "That's plenty of reminders already.");
    await db.insert(schema.reminders).values({ id: id("r_"), userId: user.id, time: o.time!, message: o.message!, rule: o.rule || "always", days: o.days || [1, 1, 1, 1, 1, 1, 1], email: !!o.email, inapp: o.inapp !== false, on: o.on !== false });
  }
};
export const deleteReminder: Action = async ({ db, user }, a) => {
  await db.delete(schema.reminders).where(and(eq(schema.reminders.id, str(a.id, 60)), eq(schema.reminders.userId, user.id)));
};

// ---------- Moods ----------
export const setMoods: Action = async ({ db, user }, a) => {
  const list = Array.isArray(a.list) ? a.list.slice(0, 40) : [];
  const cur = await db.select().from(schema.moods).where(eq(schema.moods.userId, user.id));
  const seen = new Set<string>();
  await db.transaction(async (tx) => {
    for (let i = 0; i < list.length; i++) {
      const x = (list[i] || {}) as Record<string, unknown>;
      const label = str(x.label, 20).trim();
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      const color = PALETTE.includes(str(x.color, 9)) ? str(x.color, 9) : PALETTE[i % PALETTE.length];
      const ex = cur.find((c) => c.id === x.id);
      if (ex) await tx.update(schema.moods).set({ label: ex.preset ? ex.label : label, color, hidden: bool(x.hidden), sort: i }).where(eq(schema.moods.id, ex.id));
      else await tx.insert(schema.moods).values({ id: id("md_"), userId: user.id, label, color, hidden: bool(x.hidden), sort: i });
    }
    // Moods left out were deleted (presets can only be hidden).
    for (const c of cur) if (!list.find((x) => (x as Record<string, unknown>)?.id === c.id) && !c.preset) await tx.delete(schema.moods).where(eq(schema.moods.id, c.id));
  });
};
export const renameMood: Action = async ({ db, user }, a) => {
  const m = await db.query.moods.findFirst({ where: and(eq(schema.moods.id, str(a.id, 60)), eq(schema.moods.userId, user.id)) });
  if (!m) fail(404, "That mood wasn't found.");
  const label = str(a.label, 20).trim();
  if (!label) fail(400, "Give the mood a name.");
  const clash = await db.query.moods.findFirst({ where: and(eq(schema.moods.userId, user.id), ne(schema.moods.id, m!.id), eq(schema.moods.label, label)) });
  if (clash) fail(400, "You already have a mood called " + label);
  await db.update(schema.moods).set({ label }).where(eq(schema.moods.id, m!.id));
  await db.update(schema.entries).set({ mood: label }).where(and(eq(schema.entries.authorId, user.id), eq(schema.entries.mood, m!.label)));
};

export const deleteMyAccount: Action = async ({ db, user }) => {
  const admins = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, "ADMIN"), eq(schema.users.disabled, false)));
  if (user.role === "ADMIN" && admins.length <= 1) fail(400, "You're the only admin. Make someone else an admin first.");
  await deleteUserCompletely(db, user.id, "drop");
  await destroySession();
};
