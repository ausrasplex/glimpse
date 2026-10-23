import { eq } from "drizzle-orm";
import { handle, json, requireUser, checkOrigin } from "@/server/http";
import { db, schema } from "@/server/db";
import { id } from "@/server/ids";
import { keys, deleteKeys } from "@/server/storage";
import { enqueue } from "@/server/queue";
import { getSettings } from "@/server/settings";
import { checkQuota, streamBodyTo, extOf, fileName } from "@/server/uploads";
import { fail } from "@/server/core";
export const dynamic = "force-dynamic";

const FORMAT: Record<string, string> = { ".mp3": "MP3", ".m4a": "M4A", ".aac": "M4A", ".wav": "WAV", ".flac": "FLAC" };

export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const { user } = await requireUser();
  const s = await getSettings();
  if (!s.musicUploads && user.role !== "ADMIN") fail(403, "Only admins can add music on this server.");
  const name = fileName(req);
  const ext = extOf(name);
  const format = FORMAT[ext];
  if (!format || !s.formats[format]) fail(415, "That format isn't allowed here. Use " + Object.keys(s.formats).filter((k) => s.formats[k]).join(", ") + ".");
  await checkQuota(user.id, Number(req.headers.get("content-length") || 0));
  const tid = id("t_");
  const key = keys.track(tid, ext);
  const title = decodeURIComponent(req.headers.get("x-title") || "").slice(0, 120) || name.replace(/\.[^.]+$/, "");
  const artist = decodeURIComponent(req.headers.get("x-artist") || "").slice(0, 120);
  const bpmH = Number(req.headers.get("x-bpm") || 0);
  await db.insert(schema.tracks).values({ id: tid, title, artist, format, key, addedBy: user.id, status: "processing", bpm: bpmH > 30 && bpmH < 260 ? bpmH : null });
  try {
    const size = await streamBodyTo(req, key, req.headers.get("content-type") || "audio/mpeg", s.trackSize * 1e6);
    await db.update(schema.tracks).set({ size }).where(eq(schema.tracks.id, tid));
  } catch (e) {
    await db.delete(schema.tracks).where(eq(schema.tracks.id, tid));
    await deleteKeys([key]).catch(() => undefined);
    throw e;
  }
  await enqueue.processTrack(tid);
  return json({ trackId: tid });
});
