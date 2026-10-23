// The Glimpse worker: consumes BullMQ jobs and runs scheduled tasks.
import { Worker, type Job } from "bullmq";
import { redis, Q } from "../server/queue";
import { ensureStorage } from "../server/storage";
import { getSettings } from "../server/settings";
import { db, schema } from "../server/db";
import { eq, or } from "drizzle-orm";
import { processMedia, importImmich } from "./media";
import { processTrack } from "./music";
import { renderMash } from "./mash";
import { runReminders, runBackup, cleanup, deleteObjects } from "./system";
import { ffmpegVersion } from "./ff";
import { enqueue } from "../server/queue";

const log = (...a: unknown[]) => console.log("[worker]", ...a);

async function main() {
  const conn = redis();
  await ensureStorage().catch((e) => log("storage check failed:", (e as Error).message));
  const ff = await ffmpegVersion();
  log("starting ·", ff);

  const media = new Worker(Q.media, async (job: Job) => {
    if (job.name === "immich") return importImmich(job.data.mediaId, job.data.userId, job.data.assetId);
    return processMedia(job.data.mediaId);
  }, { connection: conn, concurrency: 2, lockDuration: 10 * 60e3 });

  const s0 = await getSettings();
  const mash = new Worker(Q.mash, async (job: Job) => renderMash(job.data.mashId), { connection: conn, concurrency: Math.max(1, Math.min(4, s0.concurrency)), lockDuration: 30 * 60e3 });
  const track = new Worker(Q.track, async (job: Job) => processTrack(job.data.trackId), { connection: conn, concurrency: 1, lockDuration: 10 * 60e3 });
  const system = new Worker(Q.system, async (job: Job) => {
    if (job.name === "backup") return runBackup(true);
    if (job.name === "delete") return deleteObjects(job.data.keys || [], job.data.prefixes || []);
  }, { connection: conn, concurrency: 1 });
  for (const w of [media, mash, track, system]) w.on("failed", (j, e) => log("job failed", j?.name, j?.id, e.message));

  // Anything left mid-way by a restart goes back on the queue.
  const stale = await db.select().from(schema.mashes).where(or(eq(schema.mashes.status, "rendering"), eq(schema.mashes.status, "queued")));
  for (const m of stale) await enqueue.renderMash(m.id);
  const staleMedia = await db.select().from(schema.media).where(eq(schema.media.status, "PROCESSING"));
  for (const m of staleMedia) await enqueue.processMedia(m.id);

  const beat = () => conn.set("glimpse:worker", JSON.stringify({ at: Date.now(), ffmpeg: ff }), "EX", 60).catch(() => undefined);
  await beat();
  setInterval(beat, 15e3);
  // Every minute: reminders, scheduled backups, and keep render concurrency in step with Settings.
  setInterval(async () => {
    try { await runReminders(); } catch (e) { log("reminders:", (e as Error).message); }
    try { await runBackup(false); } catch (e) { log("backup:", (e as Error).message); }
    try { const s = await getSettings(); const c = Math.max(1, Math.min(4, s.concurrency)); if (mash.concurrency !== c) mash.concurrency = c; } catch { /* ignore */ }
  }, 60e3);
  setInterval(() => cleanup().catch((e) => log("cleanup:", (e as Error).message)), 3600e3);
  setTimeout(() => cleanup().catch(() => undefined), 30e3);

  const stop = async () => { log("stopping"); await Promise.allSettled([media.close(), mash.close(), track.close(), system.close()]); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}

main().catch((e) => { console.error("[worker] fatal", e); process.exit(1); });
