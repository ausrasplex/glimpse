// Reminders, database backups and clean-up.
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, lt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, schema } from "../server/db";
import { getSettings, saveSettings } from "../server/settings";
import { notify } from "../server/core";
import { sendMail } from "../server/mail";
import { deleteKeys, deletePrefix } from "../server/storage";
import { env } from "../server/env";
import { dayKeyInTz, timeInTz } from "../shared/dates";
import { run } from "./ff";

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export async function runReminders() {
  const s = await getSettings();
  const rs = await db.select().from(schema.reminders).where(eq(schema.reminders.on, true));
  if (!rs.length) return;
  const users = await db.select().from(schema.users).where(inArray(schema.users.id, [...new Set(rs.map((r) => r.userId))]));
  const now = new Date();
  for (const r of rs) {
    const u = users.find((x) => x.id === r.userId);
    if (!u || u.disabled) continue;
    const today = dayKeyInTz(now, u.tz);
    if (r.lastFiredDay === today) continue;
    const { hhmm, weekday } = timeInTz(now, u.tz);
    const days = (r.days as number[]) || [];
    // days[] runs Monday..Sunday in the app.
    if (!days[(weekday + 6) % 7]) continue;
    const late = toMin(hhmm) - toMin(r.time);
    if (late < 0 || late > 60) continue;
    await db.update(schema.reminders).set({ lastFiredDay: today }).where(eq(schema.reminders.id, r.id));
    if (r.rule === "check") {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.entries).where(and(eq(schema.entries.authorId, u.id), eq(schema.entries.date, today)));
      if (n > 0) continue;
    }
    if (r.inapp) await notify(db, u.id, { type: "REMINDER", title: r.message, body: r.rule === "check" ? "Only sent when you haven't filmed yet" : "Daily reminder", link: { route: "capture" } });
    if (r.email && s.email.ok) await sendMail(u.email, r.message, `${r.message}\n\nOpen Glimpse: ${env.appUrl}/capture\n\nYou can change reminders in Profile.`, s);
  }
}

const backupDir = () => join(env.dataDir, "backups");

export async function runBackup(force = false) {
  const s = await getSettings();
  if (!force) {
    if (s.backup.schedule === "off") return;
    const { hhmm, weekday } = timeInTz(new Date(), s.tz);
    const due = hhmm.startsWith("03:") && (s.backup.schedule === "daily" || weekday === 0);
    const last = s.backup.last || 0;
    if (!due || Date.now() - last < 20 * 3600e3) return;
  }
  await mkdir(backupDir(), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = join(backupDir(), `glimpse-${stamp}.dump`);
  await run("pg_dump", ["--format=custom", "--no-owner", "--file", file, env.databaseUrl], { timeoutMs: 30 * 60e3 });
  const size = (await stat(file)).size;
  const all = (await readdir(backupDir())).filter((f) => /^glimpse-.*\.dump$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - s.backup.keep))) await unlink(join(backupDir(), f)).catch(() => undefined);
  await saveSettings((x) => { x.backup.last = Date.now(); x.backup.size = Math.round(size / 1e5) / 10; });
}

export async function cleanup() {
  const day = new Date(Date.now() - 86400e3), two = new Date(Date.now() - 2 * 86400e3);
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  await db.delete(schema.passwordResets).where(lt(schema.passwordResets.expiresAt, day));
  await db.update(schema.invites).set({ status: "expired" }).where(and(eq(schema.invites.status, "pending"), lt(schema.invites.expiresAt, new Date())));
  // Uploads that were never saved as an entry.
  const used = db.select({ id: schema.entries.mediaId }).from(schema.entries);
  const orphans = await db.select().from(schema.media).where(and(lt(schema.media.createdAt, two), notInArray(schema.media.id, used)));
  for (const m of orphans) { await deletePrefix(`media/${m.ownerId}/${m.id}/`); await db.delete(schema.media).where(eq(schema.media.id, m.id)); }
  const stuck = await db.select().from(schema.media).where(and(eq(schema.media.status, "UPLOADING"), lt(schema.media.createdAt, day)));
  for (const m of stuck) await db.update(schema.media).set({ status: "FAILED", error: "The upload didn't finish." }).where(eq(schema.media.id, m.id));
  // Old notifications.
  await db.delete(schema.notifications).where(and(eq(schema.notifications.read, true), lt(schema.notifications.createdAt, new Date(Date.now() - 120 * 86400e3))));
  // Temp files left by a crash.
  try { for (const f of await readdir(join(env.dataDir, "tmp"))) { const p = join(env.dataDir, "tmp", f); if (Date.now() - (await stat(p)).mtimeMs > 6 * 3600e3) await run("rm", ["-rf", p]); } } catch { /* none */ }
  void isNull;
}

export async function deleteObjects(keysList: string[], prefixes: string[]) {
  await deleteKeys(keysList);
  for (const p of prefixes) await deletePrefix(p);
}
