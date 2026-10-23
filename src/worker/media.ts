// Uploaded clips and photos: probe, playback copy, poster, frame strip. Also Immich imports.
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "../server/db";
import { downloadTo, putFile, keys, putStream } from "../server/storage";
import { getSettings } from "../server/settings";
import { decrypt } from "../server/crypto";
import { env } from "../server/env";
import { ffmpeg, probe, orientOf, run } from "./ff";
import { takenDayFrom } from "../shared/dates";

export const STRIP_FRAMES = 20;
export const tmpDir = async (name: string) => { const d = join(env.dataDir, "tmp", name); await mkdir(d, { recursive: true }); return d; };
const size = async (f: string) => (await stat(f)).size;

// When and on which day a photo was taken, from its EXIF. Read from the original: converted copies drop it.
async function photoTaken(file: string, tz: string) {
  try {
    const exifr = (await import("exifr")).default;
    const x = await exifr.parse(file, { pick: ["DateTimeOriginal", "OffsetTimeOriginal", "CreateDate", "OffsetTime"], reviveValues: false }) as Record<string, string> | undefined;
    if (!x) return null;
    const when = x.DateTimeOriginal || x.CreateDate;
    return when ? takenDayFrom(when + (x.OffsetTimeOriginal || x.OffsetTime || ""), tz) : null;
  } catch { return null; }
}
const ownerTz = async (userId: string) => (await db.query.users.findFirst({ where: eq(schema.users.id, userId) }))?.tz || "UTC";

async function setMedia(id: string, o: Partial<typeof schema.media.$inferInsert>) {
  await db.update(schema.media).set(o).where(eq(schema.media.id, id));
}

// Convert HEIC/HEIF to JPEG with libheif's tool when ffmpeg can't read it.
async function readableImage(src: string, dir: string): Promise<string> {
  try { const p = await probe(src); if (p.width > 0) return src; } catch { /* fall through */ }
  const out = join(dir, "converted.jpg");
  // libheif renamed heif-convert to heif-dec; try both.
  try { await run("heif-dec", ["-q", "92", src, out], { timeoutMs: 120e3 }); }
  catch { await run("heif-convert", ["-q", "92", src, out], { timeoutMs: 120e3 }); }
  return out;
}

export async function processMedia(mediaId: string) {
  const m = await db.query.media.findFirst({ where: eq(schema.media.id, mediaId) });
  if (!m || !m.originalKey) return;
  const s = await getSettings();
  const dir = await tmpDir("media-" + mediaId);
  try {
    await setMedia(mediaId, { status: "PROCESSING", progress: 5, error: null });
    const ext = (m.originalKey.match(/\.[a-z0-9]+$/i) || [".bin"])[0];
    const orig = join(dir, "original" + ext);
    await downloadTo(m.originalKey, orig);
    await setMedia(mediaId, { progress: 20 });

    if (m.kind === "photo") {
      const img = await readableImage(orig, dir);
      const p = await probe(img);
      const poster = join(dir, "poster.jpg");
      // Display copy: up to 1920 on the long side, rotation applied.
      await ffmpeg(["-i", img, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'", "-q:v", "3", poster]);
      const pp = await probe(poster);
      const taken = m.takenDay ? null : await photoTaken(orig, await ownerTz(m.ownerId));
      const posterKey = keys.mediaPoster(m.ownerId, m.id);
      await putFile(posterKey, poster, "image/jpeg");
      await setMedia(mediaId, {
        status: "READY", progress: 100, posterKey, derivedSize: await size(poster), width: pp.width || p.width, height: pp.height || p.height,
        orient: orientOf(pp.width || p.width, pp.height || p.height), duration: 10, codec: ext.replace(".", "").toUpperCase(), converted: /heic|heif/i.test(ext),
        ...(taken ? { takenDay: taken.day, takenAt: m.takenAt ?? taken.at } : {})
      });
      return;
    }

    const p = await probe(orig);
    if (!p.vcodec || p.duration <= 0) throw new Error("This file doesn't contain a video Glimpse can read.");
    const short = s.playback === "1080" ? 1080 : 720;
    const playback = join(dir, "playback.mp4");
    // Playback copy: H.264/AAC that every browser plays. ffmpeg applies the rotation tag itself.
    await ffmpeg([
      "-i", orig, "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", `scale='if(gt(iw,ih),-2,min(${short},iw))':'if(gt(iw,ih),min(${short},ih),-2)',format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-profile:v", "high", "-r", "30",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", playback
    ], 60 * 60e3);
    await setMedia(mediaId, { progress: 70 });
    const poster = join(dir, "poster.jpg");
    const at = Math.min(Math.max(0, m.clipStart || p.duration * 0.2), Math.max(0, p.duration - 0.1));
    await ffmpeg(["-ss", at.toFixed(2), "-i", playback, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),-2,480)':'if(gt(iw,ih),480,-2)'", "-q:v", "4", poster]);
    // Frame strip for the trimmer: 20 frames side by side, evenly spread.
    const strip = join(dir, "strip.jpg");
    const fps = Math.max(0.05, STRIP_FRAMES / Math.max(0.5, p.duration));
    await ffmpeg(["-i", playback, "-vf", `fps=${fps.toFixed(4)},scale=-2:120,crop='min(iw,96)':120,tile=${STRIP_FRAMES}x1`, "-frames:v", "1", "-q:v", "5", strip]);
    const pk = keys.mediaPlayback(m.ownerId, m.id), ok = keys.mediaPoster(m.ownerId, m.id), sk = keys.mediaStrip(m.ownerId, m.id);
    await putFile(pk, playback, "video/mp4");
    await putFile(ok, poster, "image/jpeg");
    await putFile(sk, strip, "image/jpeg");
    const taken = m.takenDay ? null : takenDayFrom(p.creation, await ownerTz(m.ownerId));
    await setMedia(mediaId, {
      status: "READY", progress: 100, playbackKey: pk, posterKey: ok, stripKey: sk,
      derivedSize: (await size(playback)) + (await size(poster)) + (await size(strip)),
      width: p.width, height: p.height, orient: orientOf(p.width, p.height), duration: Math.round(p.duration * 10) / 10,
      codec: p.vcodec?.toUpperCase() ?? null, converted: p.vcodec !== "h264",
      ...(taken ? { takenDay: taken.day, takenAt: m.takenAt ?? taken.at } : {})
    });
  } catch (e) {
    console.error("[media]", mediaId, (e as Error).message);
    await setMedia(mediaId, { status: "FAILED", error: "Couldn't process this file. " + (e as Error).message.slice(0, 300) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------- Immich ----------
export async function immichFetch(userId: string, path: string, init?: RequestInit) {
  const s = await getSettings();
  if (!s.immich.on || !s.immich.url) throw new Error("Immich import is turned off.");
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const key = decrypt(u?.immichKeyEnc);
  if (!key) throw new Error("Connect your Immich account in Profile first.");
  const r = await fetch(s.immich.url.replace(/\/$/, "") + path, { ...init, headers: { ...(init?.headers || {}), "x-api-key": key, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Immich answered ${r.status}${r.status === 401 ? " (check the API key)" : ""}`);
  return r;
}

export async function importImmich(mediaId: string, userId: string, assetId: string) {
  const m = await db.query.media.findFirst({ where: eq(schema.media.id, mediaId) });
  if (!m) return;
  try {
    await setMedia(mediaId, { status: "UPLOADING", progress: 5 });
    const info = (await (await immichFetch(userId, `/api/assets/${encodeURIComponent(assetId)}`)).json()) as { type?: string; originalFileName?: string; originalMimeType?: string; fileCreatedAt?: string; localDateTime?: string };
    const name = info.originalFileName || "immich";
    const ext = (name.match(/\.[a-z0-9]+$/i) || [info.type === "IMAGE" ? ".jpg" : ".mp4"])[0].toLowerCase();
    const key = keys.mediaOriginal(userId, mediaId, ext);
    const r = await immichFetch(userId, `/api/assets/${encodeURIComponent(assetId)}/original`, { headers: { Accept: "*/*" } });
    if (!r.body) throw new Error("Immich sent an empty file.");
    const dir = await tmpDir("immich-" + mediaId);
    const tmp = join(dir, "original" + ext);
    await pipeline(Readable.fromWeb(r.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(tmp));
    const bytes = await size(tmp);
    await putFile(key, tmp, info.originalMimeType || "application/octet-stream");
    await rm(dir, { recursive: true, force: true });
    // Immich's localDateTime is the wall-clock time where it was taken (labelled UTC), so its date is the filmed day.
    const taken = info.fileCreatedAt ? new Date(info.fileCreatedAt) : null;
    const local = info.localDateTime ? takenDayFrom(info.localDateTime.replace(/Z$/i, ""), "UTC") : null;
    await setMedia(mediaId, { originalKey: key, size: bytes, fileName: name, mime: info.originalMimeType || null, kind: info.type === "IMAGE" ? "photo" : "video", takenAt: taken && !isNaN(taken.getTime()) ? taken : null, takenDay: local ? local.day : null, status: "PROCESSING", progress: 15 });
    await processMedia(mediaId);
  } catch (e) {
    console.error("[immich]", mediaId, (e as Error).message);
    await setMedia(mediaId, { status: "FAILED", error: "Couldn't copy from Immich. " + (e as Error).message.slice(0, 300) });
  }
}

export { putStream };
