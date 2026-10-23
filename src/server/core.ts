// Shared server-side helpers: notifications, milestones, new-user basics, access checks.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { id } from "./ids";
import { dayKeyInTz, streakFrom } from "../shared/dates";

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

export type Link = { route: string; params?: Record<string, unknown> } | null;
export async function notify(tx: Tx, userId: string, o: { type: string; title: string; body?: string; link?: Link; action?: unknown }) {
  await tx.insert(schema.notifications).values({ id: id("n_"), userId, type: o.type, title: o.title, body: o.body ?? "", link: o.link ?? null, action: o.action ?? null });
}
export async function notifyAdmins(tx: Tx, o: Parameters<typeof notify>[2], except?: string) {
  const admins = await tx.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, "ADMIN"), eq(schema.users.disabled, false)));
  for (const a of admins) if (a.id !== except) await notify(tx, a.id, o);
}

export const DEFAULT_MOODS = [
  ["Happy", "#E8A33D"], ["Calm", "#5BA3A0"], ["Excited", "#D97757"], ["Grateful", "#9BBF5A"], ["Tired", "#6FA8DC"], ["Proud", "#9B87D6"], ["Meh", "#8C96A3"]
] as const;
export const DEFAULT_PREFS = { accent: "#E8A33D", badge: "dot", milestones: true, fill: "blur", onThisDay: true };

// Everyone starts with Diary + Freestyle categories, a Diary project, default moods and two reminders.
export async function createUserBasics(tx: Tx, userId: string, emailOk: boolean) {
  const diaryCat = id("c_"), freeCat = id("c_");
  await tx.insert(schema.categories).values([
    { id: diaryCat, userId, name: "Diary", color: "#E8A33D", daily: true, isDefault: true, sort: 0 },
    { id: freeCat, userId, name: "Freestyle", color: "#5BA3A0", daily: false, isDefault: true, sort: 1 }
  ]);
  await tx.insert(schema.moods).values(DEFAULT_MOODS.map(([label, color], i) => ({ id: id("md_"), userId, label, color, preset: true, sort: i })));
  const pid = id("p_");
  await tx.insert(schema.projects).values({ id: pid, name: "Diary", ownerId: userId });
  await tx.insert(schema.members).values({ id: id("mb_"), projectId: pid, userId, role: "OWNER", status: "ACTIVE", categoryId: diaryCat, pinned: true, joinedAt: new Date(), lastViewedAt: new Date() });
  await tx.insert(schema.reminders).values([
    { id: id("r_"), userId, time: "08:00", message: "Don't forget today's glimpse!", rule: "always", email: emailOk, inapp: true, on: true },
    { id: id("r_"), userId, time: "17:00", message: "No glimpse yet today, there's still time.", rule: "check", email: false, inapp: true, on: true }
  ]);
  return { diaryCat, freeCat, diaryProject: pid };
}

export async function freestyleCategory(tx: Tx, userId: string): Promise<string | null> {
  const c = await tx.query.categories.findFirst({ where: and(eq(schema.categories.userId, userId), eq(schema.categories.name, "Freestyle")) });
  if (c) return c.id;
  const any = await tx.query.categories.findFirst({ where: eq(schema.categories.userId, userId) });
  return any?.id ?? null;
}

export async function membership(tx: Tx, projectId: string, userId: string) {
  return tx.query.members.findFirst({ where: and(eq(schema.members.projectId, projectId), eq(schema.members.userId, userId), eq(schema.members.status, "ACTIVE")) });
}
export async function requireMember(tx: Tx, projectId: string, userId: string) {
  const m = await membership(tx, projectId, userId);
  if (!m) fail(404, "Project not found");
  return m!;
}
export async function requireOwner(tx: Tx, projectId: string, userId: string) {
  const m = await requireMember(tx, projectId, userId);
  if (m.role !== "OWNER") fail(403, "Only the project owner can do that");
  return m;
}

async function projectStats(tx: Tx, projectId: string, tz: string) {
  const rows = await tx.select({ date: schema.entries.date }).from(schema.entries).where(eq(schema.entries.projectId, projectId));
  const days = new Set(rows.map((r) => r.date));
  return { count: rows.length, streak: streakFrom(days, dayKeyInTz(new Date(), tz)) };
}
export async function snapshot(tx: Tx, projectIds: string[], tz: string) {
  const o: Record<string, { count: number; streak: number }> = {};
  for (const pid of projectIds) o[pid] = await projectStats(tx, pid, tz);
  return o;
}

// After entries are added: streak and count milestones for members who want them.
export async function checkMilestones(tx: Tx, projectId: string, before: { count: number; streak: number }, tz: string) {
  const p = await tx.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!p) return;
  const after = await projectStats(tx, projectId, tz);
  const hits: { title: string; body: string; label: string; range: string; streak: boolean }[] = [];
  for (const t of [50, 100, 250, 500, 1000]) if (before.count < t && after.count >= t) hits.push({ title: `${p.name} hit ${t} glimpses 🎉`, body: "Every one of them is still in there.", label: "Mash them all", range: "all", streak: false });
  for (const t of [7, 30, 100, 365]) if (before.streak < t && after.streak >= t) hits.push({ title: `${t}-day streak in ${p.name} 🔥`, body: t === 7 ? "A full week of glimpses in a row." : `${t} days in a row. Seriously impressive.`, label: t === 7 ? "Mash the week" : "Mash the streak", range: t === 7 ? "week" : t === 30 ? "this" : "year", streak: true });
  if (!hits.length) return;
  const ms = await tx.select({ userId: schema.members.userId, categoryId: schema.members.categoryId }).from(schema.members).where(and(eq(schema.members.projectId, projectId), eq(schema.members.status, "ACTIVE")));
  const userIds = ms.map((m) => m.userId!).filter(Boolean);
  const us = userIds.length ? await tx.select({ id: schema.users.id, prefs: schema.users.prefs }).from(schema.users).where(inArray(schema.users.id, userIds)) : [];
  const catIds = ms.map((m) => m.categoryId!).filter(Boolean);
  const cats = catIds.length ? await tx.select({ id: schema.categories.id, daily: schema.categories.daily }).from(schema.categories).where(inArray(schema.categories.id, catIds)) : [];
  for (const h of hits) for (const m of ms) {
    const u = us.find((x) => x.id === m.userId);
    if (!u || (u.prefs as { milestones?: boolean }).milestones === false) continue;
    if (h.streak && !cats.find((c) => c.id === m.categoryId)?.daily) continue;
    await notify(tx, u.id, { type: "MILESTONE", title: h.title, body: h.body, action: { label: h.label, route: "mash1", params: { projectId, range: h.range } } });
  }
}

// Bytes a person uses: originals + derived copies they own, their ready mashes, music they added.
export async function usageBytes(tx: Tx, userId: string) {
  const [m] = await tx.select({ s: sql<string>`coalesce(sum(${schema.media.size} + ${schema.media.derivedSize}),0)` }).from(schema.media).where(eq(schema.media.ownerId, userId));
  const [ms] = await tx.select({ s: sql<string>`coalesce(sum(${schema.mashes.size}),0)` }).from(schema.mashes).where(eq(schema.mashes.ownerId, userId));
  const [t] = await tx.select({ s: sql<string>`coalesce(sum(${schema.tracks.size}),0)` }).from(schema.tracks).where(eq(schema.tracks.addedBy, userId));
  const clips = Number(m.s), mashes = Number(ms.s), music = Number(t.s);
  return { clips, mashes, music, total: clips + mashes + music };
}

export const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);
