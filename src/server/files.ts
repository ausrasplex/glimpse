// Streaming stored files to the browser, with Range support for video seeking.
import { Readable } from "node:stream";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { getObject, StorageError, type StoredObject } from "./storage";
import { sha256 } from "./ids";

export async function streamObject(req: Request, key: string, contentType: string, opts: { download?: string } = {}): Promise<Response> {
  const range = req.headers.get("range") || undefined;
  let r: StoredObject;
  try { r = await getObject(key, range); }
  catch (e) {
    if (e instanceof StorageError && e.status === 416) return new Response(null, { status: 416 });
    if (!(e instanceof StorageError)) console.error("[files]", key, (e as Error).message);
    return new Response("Not found", { status: 404 });
  }
  const headers = new Headers({ "Content-Type": r.contentType && r.contentType !== "application/octet-stream" ? r.contentType : contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400" });
  headers.set("Content-Length", String(r.contentLength));
  if (r.contentRange) headers.set("Content-Range", r.contentRange);
  if (r.etag) headers.set("ETag", r.etag);
  if (opts.download) headers.set("Content-Disposition", `attachment; filename="${opts.download.replace(/[^\w.\- ]/g, "_")}"`);
  // Stop reading the file if the browser goes away (common while scrubbing video).
  req.signal?.addEventListener("abort", () => r.body.destroy());
  const body = Readable.toWeb(r.body) as unknown as ReadableStream;
  return new Response(body, { status: r.contentRange ? 206 : 200, headers });
}

// Can this person see this media? Owner, an active member of a project that uses it, or someone holding a live invite link to one.
export async function canSeeMedia(userId: string | null, mediaId: string, inviteToken: string | null): Promise<boolean> {
  const m = await db.query.media.findFirst({ where: eq(schema.media.id, mediaId), columns: { ownerId: true } });
  if (!m) return false;
  if (userId && m.ownerId === userId) return true;
  const es = await db.select({ projectId: schema.entries.projectId }).from(schema.entries).where(eq(schema.entries.mediaId, mediaId));
  const pids = [...new Set(es.map((e) => e.projectId))];
  if (!pids.length) return false;
  if (userId) {
    const mem = await db.query.members.findFirst({ where: and(eq(schema.members.userId, userId), inArray(schema.members.projectId, pids), eq(schema.members.status, "ACTIVE")) });
    if (mem) return true;
  }
  if (inviteToken) {
    const inv = await db.query.invites.findFirst({ where: eq(schema.invites.tokenHash, sha256(inviteToken)) });
    if (inv && inv.status === "pending" && inv.expiresAt > new Date() && inv.projectId && pids.includes(inv.projectId)) return true;
  }
  return false;
}

export async function canSeeMash(userId: string, mashId: string) {
  const m = await db.query.mashes.findFirst({ where: eq(schema.mashes.id, mashId) });
  if (!m) return null;
  if (m.ownerId === userId) return m;
  if (!m.shared || !m.projectId) return null;
  const mem = await db.query.members.findFirst({ where: and(eq(schema.members.userId, userId), eq(schema.members.projectId, m.projectId), eq(schema.members.status, "ACTIVE")) });
  return mem ? m : null;
}
