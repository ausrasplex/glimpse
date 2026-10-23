import { Readable, Transform } from "node:stream";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { fail, usageBytes } from "./core";
import { putStream } from "./storage";

export const VIDEO_MAX = 4 * 1024 ** 3; // 4 GB
export const PHOTO_MAX = 60 * 1024 ** 2;

export function extOf(name: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || "");
  return m ? "." + m[1].toLowerCase() : "";
}
export function fileName(req: Request) {
  try { return decodeURIComponent(req.headers.get("x-file-name") || "upload").slice(0, 200); } catch { return "upload"; }
}

export async function checkQuota(userId: string, adding: number) {
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u || !u.quotaGb) return;
  const used = await usageBytes(db, userId);
  if (used.total + adding > u.quotaGb * 1e9) fail(413, `You're out of space (${u.quotaGb} GB). Delete old mashes or ask the admin for more.`);
}

// Stream a request body into storage, counting bytes and enforcing a size cap as it goes.
// `check` sees the first 512 bytes before anything is kept and throws to refuse the file.
export async function streamBodyTo(req: Request, key: string, contentType: string, max: number, check?: (head: Buffer) => void): Promise<number> {
  if (!req.body) fail(400, "No file was sent.");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > max) fail(413, `That file is too big. The limit is ${Math.round(max / 1024 ** 2)} MB.`);
  let n = 0;
  let head: Buffer | null = check ? Buffer.alloc(0) : null;
  const checked = (cb: (e?: Error | null, d?: Buffer) => void) => { const h = head!; head = null; try { check!(h); cb(null, h); } catch (e) { cb(e as Error); } };
  const src = Readable.fromWeb(req.body as unknown as import("node:stream/web").ReadableStream);
  const counted = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > max) return cb(new Error("too big"));
      if (!head) return cb(null, chunk);
      head = Buffer.concat([head, chunk]);
      if (head.length >= 512) checked(cb); else cb();
    },
    flush(cb) { if (head) checked(cb); else cb(); }
  });
  src.on("error", (e) => counted.destroy(e));
  src.pipe(counted);
  try { await putStream(key, counted, contentType); }
  catch (e) { if ((e as Error).message === "too big") fail(413, "That file is too big."); throw e; }
  return n;
}
