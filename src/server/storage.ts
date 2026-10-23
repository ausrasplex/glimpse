// File storage for clips, photos, music, mashes and avatars. Two drivers behind one interface:
//   local (default): a folder mapped into the container, e.g. an Unraid share at /media
//   s3: any S3-compatible store (Garage, SeaweedFS, MinIO...)
// Browsers never touch either directly: uploads and playback stream through Glimpse, which checks access.
import { S3Client, GetObjectCommand, DeleteObjectsCommand, HeadBucketCommand, CreateBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, rmdir, stat, statfs, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { env } from "./env";

/** A stored file opened for reading, the same shape for both drivers. */
export type StoredObject = { body: Readable; contentType?: string; contentLength: number; contentRange?: string; etag?: string };
/** Thrown for missing files (404) and impossible ranges (416). */
export class StorageError extends Error { constructor(public status: 404 | 416, msg: string) { super(msg); } }

// ---------------------------------------------------------------- local folder
const root = () => resolve(env.mediaDir);
function localPath(key: string): string {
  // Keys are built by Glimpse (ids only), but never let one escape the media folder.
  if (!key || key.includes("\0")) throw new StorageError(404, "Bad key");
  const p = resolve(root(), key);
  if (p !== root() && !p.startsWith(root() + sep)) throw new StorageError(404, "Bad key");
  return p;
}
const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".gif": "image/gif",
  ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".aac": "audio/aac", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".txt": "text/plain"
};
const typeOf = (key: string) => TYPES[(key.match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase()];

/** Parse a single HTTP byte range against a file size. Returns null for no/ignored range; throws 416 if unsatisfiable. */
export function parseRange(range: string | undefined, size: number): { start: number; end: number } | null {
  if (!range) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null; // multi-range or junk: send the whole file
  let start: number, end: number;
  if (m[1] === "") { const n = Number(m[2]); if (n === 0) throw new StorageError(416, "Empty suffix range"); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) throw new StorageError(416, "Range not satisfiable");
  return { start, end };
}

// Remove now-empty folders up to the media root, so deleted clips don't leave empty directories behind.
async function pruneDirs(from: string) {
  let d = dirname(from);
  while (d !== root() && d.startsWith(root() + sep)) {
    try { await rmdir(d); } catch { return; }
    d = dirname(d);
  }
}

const local = {
  async ensure() {
    await mkdir(root(), { recursive: true });
    const k = "_health/" + Date.now() + ".txt";
    await local.put(k, Buffer.from("ok"));
    const o = await local.get(k);
    o.body.destroy();
    await local.del([k]);
  },
  async put(key: string, body: Readable | Buffer) {
    const p = localPath(key);
    await mkdir(dirname(p), { recursive: true });
    // Write to a temp name and rename, so a half-written file is never served or rendered.
    const tmp = `${p}.part-${randomBytes(4).toString("hex")}`;
    try {
      await pipeline(Buffer.isBuffer(body) ? Readable.from([body]) : body, createWriteStream(tmp));
      await rename(tmp, p);
    } catch (e) { await rm(tmp, { force: true }); throw e; }
  },
  async get(key: string, range?: string): Promise<StoredObject> {
    const p = localPath(key);
    let st;
    try { st = await stat(p); } catch { throw new StorageError(404, "Not found"); }
    if (!st.isFile()) throw new StorageError(404, "Not found");
    const r = parseRange(range, st.size);
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (!r) return { body: createReadStream(p), contentType: typeOf(key), contentLength: st.size, etag };
    return { body: createReadStream(p, { start: r.start, end: r.end }), contentType: typeOf(key), contentLength: r.end - r.start + 1, contentRange: `bytes ${r.start}-${r.end}/${st.size}`, etag };
  },
  async del(keys: string[]) {
    for (const k of keys) { const p = localPath(k); await rm(p, { force: true }); await pruneDirs(p); }
  },
  async delPrefix(prefix: string) {
    // Prefixes are always folders ("media/<owner>/<id>/"), so remove the folder.
    if (!prefix.endsWith("/")) throw new Error("Storage prefixes must end with /");
    const p = localPath(prefix.slice(0, -1));
    await rm(p, { recursive: true, force: true });
    await pruneDirs(p);
  }
};

// ---------------------------------------------------------------- S3
let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    const c = env.s3;
    client = new S3Client({
      endpoint: c.endpoint, region: c.region, forcePathStyle: true,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED"
    });
  }
  return client;
}
const bucket = () => env.s3.bucket;

const remote = {
  async ensure() {
    try { await s3().send(new HeadBucketCommand({ Bucket: bucket() })); }
    catch { await s3().send(new CreateBucketCommand({ Bucket: bucket() })); }
    const k = "_health/" + Date.now() + ".txt";
    await remote.put(k, Buffer.from("ok"), "text/plain");
    const o = await remote.get(k);
    o.body.destroy();
    await remote.del([k]);
  },
  async put(key: string, body: Readable | Buffer, contentType?: string) {
    const up = new Upload({ client: s3(), params: { Bucket: bucket(), Key: key, Body: body, ContentType: contentType }, queueSize: 3, partSize: 8 * 1024 * 1024 });
    await up.done();
  },
  async get(key: string, range?: string): Promise<StoredObject> {
    try {
      const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: range }));
      return { body: r.Body as Readable, contentType: r.ContentType, contentLength: r.ContentLength ?? 0, contentRange: r.ContentRange, etag: r.ETag };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 416) throw new StorageError(416, "Range not satisfiable");
      if (status === 404 || (e as { name?: string }).name === "NoSuchKey") throw new StorageError(404, "Not found");
      throw e;
    }
  },
  async del(list: string[]) {
    for (let i = 0; i < list.length; i += 900) {
      await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: list.slice(i, i + 900).map((Key) => ({ Key })), Quiet: true } }));
    }
  },
  async delPrefix(prefix: string) {
    let token: string | undefined;
    do {
      const r = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
      await remote.del((r.Contents || []).map((o) => o.Key).filter((k): k is string => !!k));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }
};

const driver = () => (env.storage === "s3" ? remote : local);

// ---------------------------------------------------------------- public API (used by app and worker)
/** Create the folder/bucket if needed and prove we can write, read and delete. */
export const ensureStorage = () => driver().ensure();
export const putStream = (key: string, body: Readable | Buffer, contentType?: string) => driver().put(key, body, contentType);
export const putFile = (key: string, path: string, contentType?: string) => putStream(key, createReadStream(path), contentType);
export const getObject = (key: string, range?: string) => driver().get(key, range);
export async function downloadTo(key: string, path: string) {
  const o = await getObject(key);
  await pipeline(o.body, createWriteStream(path));
}
export async function deleteKeys(keys: (string | null | undefined)[]) {
  const list = keys.filter((k): k is string => !!k);
  if (list.length) await driver().del(list);
}
export const deletePrefix = (prefix: string) => driver().delPrefix(prefix);

/** Where files live, for the setup wizard and Settings. */
export async function storageInfo(): Promise<{ kind: "local" | "s3"; where: string; free: number | null; mounted: boolean | null }> {
  if (env.storage === "s3") return { kind: "s3", where: `${env.s3.endpoint} · bucket ${env.s3.bucket}`, free: null, mounted: null };
  let free: number | null = null;
  try { const st = await statfs(root()); free = st.bavail * st.bsize; } catch { /* folder missing; ensure() reports it */ }
  return { kind: "local", where: root(), free, mounted: await isMountPoint(root()) };
}

/**
 * Is this folder (or a parent other than "/") its own mount? In Docker, an unmapped /media is just part of
 * the container's own disk and would be wiped on the next update. Returns null when we can't tell (not Linux).
 */
export async function isMountPoint(dir: string): Promise<boolean | null> {
  let text: string;
  try { text = await readFile("/proc/self/mountinfo", "utf8"); } catch { return null; }
  const unesc = (s: string) => s.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  const mounts = text.split("\n").map((l) => l.split(" ")[4]).filter(Boolean).map(unesc);
  const target = resolve(dir);
  const best = mounts.filter((m) => m === "/" || target === m || target.startsWith(m.endsWith("/") ? m : m + "/")).sort((a, b) => b.length - a.length)[0];
  return !!best && best !== "/";
}

export const keys = {
  mediaOriginal: (owner: string, id: string, ext: string) => `media/${owner}/${id}/original${ext}`,
  mediaPlayback: (owner: string, id: string) => `media/${owner}/${id}/playback.mp4`,
  mediaPoster: (owner: string, id: string) => `media/${owner}/${id}/poster.jpg`,
  mediaStrip: (owner: string, id: string) => `media/${owner}/${id}/strip.jpg`,
  mediaPrefix: (owner: string, id: string) => `media/${owner}/${id}/`,
  track: (id: string, ext: string) => `tracks/${id}/original${ext}`,
  trackPlay: (id: string) => `tracks/${id}/play.m4a`,
  mash: (id: string) => `mashes/${id}/mash.mp4`,
  mashPoster: (id: string) => `mashes/${id}/poster.jpg`,
  avatar: (userId: string, v: string) => `avatars/${userId}-${v}.jpg`
};
