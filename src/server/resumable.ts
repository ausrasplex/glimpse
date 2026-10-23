// Resumable media uploads: the file arrives in pieces, so an interrupted upload continues where it stopped.
// Pieces collect in DATA_DIR/uploads/<id>.part beside a small <id>.json, then the whole file moves into storage.
import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { env } from "./env";
import { id } from "./ids";
import { keys, putFile, deleteKeys } from "./storage";
import { enqueue } from "./queue";
import { fail } from "./core";
import { checkQuota, extOf, VIDEO_MAX, PHOTO_MAX } from "./uploads";
import { kindOfFile, sniffKind } from "../shared/media";

export const CHUNK = 5 * 1024 ** 2;
const MAX_PIECE = 16 * 1024 ** 2;
type Session = { id: string; userId: string; mediaId: string; kind: "video" | "photo"; type: string; name: string; size: number; key: string; at: number; done?: boolean };

export const uploadsDir = () => join(env.dataDir, "uploads");
const paths = (uid: string) => ({ meta: join(uploadsDir(), uid + ".json"), part: join(uploadsDir(), uid + ".part") });
const received = async (part: string) => { try { return (await stat(part)).size; } catch { return 0; } };

async function load(uid: string, userId: string): Promise<Session> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(uid)) fail(404, "That upload has expired. Choose the file again.");
  let s: Session;
  try { s = JSON.parse(await readFile(paths(uid).meta, "utf8")); } catch { fail(404, "That upload has expired. Choose the file again."); }
  if (s!.userId !== userId) fail(404, "That upload has expired. Choose the file again.");
  return s!;
}

async function discard(s: Session) {
  await rm(paths(s.id).meta, { force: true }); await rm(paths(s.id).part, { force: true });
  await db.delete(schema.media).where(eq(schema.media.id, s.mediaId));
  await deleteKeys([s.key]).catch(() => undefined);
}

export async function startUpload(userId: string, name: string, type: string, size: number) {
  const k = kindOfFile(name, type);
  if (!k) fail(415, "That isn't a video or photo Glimpse can use.");
  const max = k!.kind === "photo" ? PHOTO_MAX : VIDEO_MAX;
  if (!(size > 0)) fail(400, "That file is empty.");
  if (size > max) fail(413, `That file is too big. The limit is ${Math.round(max / 1024 ** 2)} MB.`);
  await checkQuota(userId, size);
  const mid = id("m_");
  const key = keys.mediaOriginal(userId, mid, extOf(name) || (k!.kind === "photo" ? ".jpg" : ".mp4"));
  await db.insert(schema.media).values({ id: mid, ownerId: userId, kind: k!.kind, status: "UPLOADING", originalKey: key, fileName: name, mime: k!.type, motion: k!.kind === "photo" ? "in" : null, clipStart: 0, clipEnd: k!.kind === "photo" ? 2 : 1 });
  const s: Session = { id: randomBytes(18).toString("base64url"), userId, mediaId: mid, kind: k!.kind, type: k!.type, name, size, key, at: Date.now() };
  await mkdir(uploadsDir(), { recursive: true });
  await writeFile(paths(s.id).meta, JSON.stringify(s));
  return { uploadId: s.id, mediaId: mid, kind: s.kind, received: 0, chunk: CHUNK };
}

export async function uploadStatus(userId: string, uid: string) {
  const s = await load(uid, userId);
  if (s.done) return { mediaId: s.mediaId, received: s.size, size: s.size, done: true };
  return { mediaId: s.mediaId, received: await received(paths(uid).part), size: s.size, done: false };
}

// Add one piece at `offset`. A piece for the wrong offset changes nothing and returns where to continue from.
export async function addPiece(userId: string, uid: string, offset: number, piece: Buffer) {
  const s = await load(uid, userId);
  if (s.done) return { mediaId: s.mediaId, received: s.size, done: true, kind: s.kind };
  const p = paths(uid);
  const have = await received(p.part);
  if (offset !== have || !piece.length) return { mediaId: s.mediaId, received: have, done: false };
  if (piece.length > MAX_PIECE || have + piece.length > s.size) fail(413, "That piece doesn't fit the file.");
  if (have === 0) {
    // Check what the file really is before keeping any of it.
    const kind = sniffKind(piece.subarray(0, 512));
    if (!kind) { await discard(s); fail(415, "That isn't a video or photo Glimpse can use."); }
    if (kind !== s.kind) {
      if (kind === "photo" && s.size > PHOTO_MAX) { await discard(s); fail(413, "That file is too big."); }
      s.kind = kind!;
      await writeFile(p.meta, JSON.stringify(s));
      await db.update(schema.media).set({ kind: s.kind, motion: s.kind === "photo" ? "in" : null, clipEnd: s.kind === "photo" ? 2 : 1 }).where(eq(schema.media.id, s.mediaId));
    }
  }
  await appendFile(p.part, piece);
  const now = have + piece.length;
  if (now < s.size) return { mediaId: s.mediaId, received: now, done: false };
  await putFile(s.key, p.part, s.type);
  await db.update(schema.media).set({ size: s.size, status: "PROCESSING" }).where(eq(schema.media.id, s.mediaId));
  // Keep a small marker, so a client that missed this reply learns the upload finished.
  await writeFile(p.meta, JSON.stringify({ ...s, done: true })); await rm(p.part, { force: true });
  await enqueue.processMedia(s.mediaId);
  return { mediaId: s.mediaId, received: now, done: true, kind: s.kind };
}
