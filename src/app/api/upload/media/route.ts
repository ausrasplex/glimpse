import { eq } from "drizzle-orm";
import { handle, json, requireUser, checkOrigin } from "@/server/http";
import { db, schema } from "@/server/db";
import { id } from "@/server/ids";
import { keys, deleteKeys } from "@/server/storage";
import { enqueue } from "@/server/queue";
import { checkQuota, streamBodyTo, extOf, fileName, VIDEO_MAX, PHOTO_MAX } from "@/server/uploads";
import { fail, HttpError } from "@/server/core";
import { kindOfFile, sniffKind } from "@/shared/media";
export const dynamic = "force-dynamic";

// Body is the raw file. The worker then makes the playback copy, poster and frame strip.
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const { user } = await requireUser();
  const name = fileName(req);
  const k = kindOfFile(name, req.headers.get("content-type") || "");
  if (!k) fail(415, "That isn't a video or photo Glimpse can use.");
  const { type } = k!;
  let kind = k!.kind;
  await checkQuota(user.id, Number(req.headers.get("content-length") || 0));
  const mid = id("m_");
  const key = keys.mediaOriginal(user.id, mid, extOf(name) || (kind === "photo" ? ".jpg" : ".mp4"));
  await db.insert(schema.media).values({ id: mid, ownerId: user.id, kind, status: "UPLOADING", originalKey: key, fileName: name, mime: type, motion: kind === "photo" ? "in" : null, clipStart: 0, clipEnd: kind === "photo" ? 2 : 1 });
  try {
    // The first bytes decide what the file really is, whatever its name or type says.
    let sniffed: "video" | "photo" | null = null;
    const size = await streamBodyTo(req, key, type, kind === "photo" ? PHOTO_MAX : VIDEO_MAX, (head) => { sniffed = sniffKind(head); if (!sniffed) throw new HttpError(415, "That isn't a video or photo Glimpse can use."); });
    if (sniffed && sniffed !== kind) kind = sniffed;
    await db.update(schema.media).set({ size, status: "PROCESSING", kind, motion: kind === "photo" ? "in" : null, clipEnd: kind === "photo" ? 2 : 1 }).where(eq(schema.media.id, mid));
  } catch (e) {
    await db.delete(schema.media).where(eq(schema.media.id, mid));
    await deleteKeys([key]).catch(() => undefined);
    throw e;
  }
  await enqueue.processMedia(mid);
  return json({ mediaId: mid, kind });
});
