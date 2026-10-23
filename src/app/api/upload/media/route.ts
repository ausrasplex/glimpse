import { eq } from "drizzle-orm";
import { handle, json, requireUser, checkOrigin } from "@/server/http";
import { db, schema } from "@/server/db";
import { id } from "@/server/ids";
import { keys, deleteKeys } from "@/server/storage";
import { enqueue } from "@/server/queue";
import { checkQuota, streamBodyTo, extOf, fileName, VIDEO_MAX, PHOTO_MAX } from "@/server/uploads";
import { fail } from "@/server/core";
export const dynamic = "force-dynamic";

// Body is the raw file. The worker then makes the playback copy, poster and frame strip.
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const { user } = await requireUser();
  const name = fileName(req);
  const type = req.headers.get("content-type") || "application/octet-stream";
  const kind = type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(name) ? "photo" : "video";
  if (kind === "video" && !type.startsWith("video/") && !/\.(mov|mp4|m4v|mkv|webm|avi|3gp|mts)$/i.test(name)) fail(415, "That isn't a video or photo Glimpse can use.");
  await checkQuota(user.id, Number(req.headers.get("content-length") || 0));
  const mid = id("m_");
  const key = keys.mediaOriginal(user.id, mid, extOf(name) || (kind === "photo" ? ".jpg" : ".mp4"));
  await db.insert(schema.media).values({ id: mid, ownerId: user.id, kind, status: "UPLOADING", originalKey: key, fileName: name, mime: type, motion: kind === "photo" ? "in" : null, clipStart: 0, clipEnd: kind === "photo" ? 2 : 1 });
  try {
    const size = await streamBodyTo(req, key, type, kind === "photo" ? PHOTO_MAX : VIDEO_MAX);
    await db.update(schema.media).set({ size, status: "PROCESSING" }).where(eq(schema.media.id, mid));
  } catch (e) {
    await db.delete(schema.media).where(eq(schema.media.id, mid));
    await deleteKeys([key]).catch(() => undefined);
    throw e;
  }
  await enqueue.processMedia(mid);
  return json({ mediaId: mid, kind });
});
