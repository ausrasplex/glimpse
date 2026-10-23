import { statfs, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { redis } from "./queue";
import { ensureStorage, storageInfo } from "./storage";
import { env } from "./env";

type Check = { ok: boolean; detail: string };
const gb = (b: number) => (b / 1e9 >= 1000 ? (b / 1e12).toFixed(1) + " TB" : Math.round(b / 1e9) + " GB");

export async function healthChecks() {
  const checks: Record<string, Check> = {};
  let ffmpeg: string | null = null;
  try { const r = await db.execute(sql`select version() as v`); const v = String((r.rows[0] as { v: string }).v); checks.db = { ok: true, detail: "Connected · " + (v.match(/PostgreSQL [\d.]+/)?.[0] || "PostgreSQL") }; }
  catch (e) { checks.db = { ok: false, detail: "Couldn't connect to PostgreSQL. Check DATABASE_URL (host, port, user, password and database name). " + (e as Error).message }; }
  try { await redis().ping(); checks.redis = { ok: true, detail: "Connected" }; }
  catch (e) { checks.redis = { ok: false, detail: "Couldn't connect to Redis. Check REDIS_URL. " + (e as Error).message }; }
  let storage: Awaited<ReturnType<typeof storageInfo>> | null = null;
  try {
    await ensureStorage();
    storage = await storageInfo();
    if (storage.kind === "s3") checks.s3 = { ok: true, detail: "S3 · bucket " + env.s3.bucket };
    else if (storage.mounted === false) checks.s3 = { ok: false, detail: `Nothing is mapped to ${storage.where}, so files would be lost when the container updates. In the Unraid template, map a share (e.g. /mnt/user/glimpse-media) to ${storage.where}.` };
    else checks.s3 = { ok: true, detail: `Local folder ${storage.where}` + (storage.free != null ? " · " + gb(storage.free) + " free" : "") };
  } catch (e) {
    checks.s3 = env.storage === "s3"
      ? { ok: false, detail: `Couldn't read and write the bucket at ${process.env.S3_ENDPOINT}. Check S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY, and that the key can create and write to "${process.env.S3_BUCKET || "glimpse"}". ${(e as Error).message}` }
      : { ok: false, detail: `Can't write to ${env.mediaDir}. Check the Media path mapping and the PUID/PGID settings. ${(e as Error).message}` };
  }
  try {
    const hb = await redis().get("glimpse:worker");
    const w = hb ? (JSON.parse(hb) as { at: number; ffmpeg: string }) : null;
    if (w && Date.now() - w.at < 60e3) { ffmpeg = w.ffmpeg; checks.worker = { ok: true, detail: w.ffmpeg + " ready" }; }
    else checks.worker = { ok: false, detail: "The render worker isn't running. Check GLIMPSE_WORKER is true and look for errors in the container log." };
  } catch { checks.worker = { ok: false, detail: "Can't check the worker until Redis works." }; }
  let diskFree: string | null = null;
  try {
    await mkdir(env.dataDir, { recursive: true });
    const f = join(env.dataDir, ".write-test");
    await writeFile(f, "ok"); await unlink(f);
    const st = await statfs(env.dataDir);
    diskFree = gb(st.bavail * st.bsize);
    checks.disk = { ok: true, detail: diskFree + " free" };
  } catch (e) { checks.disk = { ok: false, detail: `Can't write to ${env.dataDir}. Check the App data path and the PUID/PGID settings. ${(e as Error).message}` }; }
  return { checks, ffmpeg, diskFree, appUrl: env.appUrl, storage: storage ? { kind: storage.kind, free: storage.free != null ? gb(storage.free) : null } : { kind: env.storage, free: null } };
}
