import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { fileSession } from "@/server/session";
import { streamObject, canSeeMedia, canSeeMash } from "@/server/files";
import { sha256 } from "@/server/ids";
export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite");
  const s = await fileSession(req);
  const uid = s?.user.id ?? null;
  const [kind, idv, variant] = path;

  if (kind === "media") {
    if (!uid && !(invite && variant === "poster")) return nf();
    if (!(await canSeeMedia(uid, idv, invite))) return nf();
    const m = await db.query.media.findFirst({ where: eq(schema.media.id, idv) });
    if (!m) return nf();
    if (variant === "poster" && m.posterKey) return streamObject(req, m.posterKey, "image/jpeg");
    if (variant === "strip" && m.stripKey) return streamObject(req, m.stripKey, "image/jpeg");
    if (variant === "playback" && m.playbackKey) return streamObject(req, m.playbackKey, "video/mp4");
    if (variant === "original" && m.originalKey && uid === m.ownerId) return streamObject(req, m.originalKey, m.mime || "application/octet-stream", { download: m.fileName || "original" });
    return nf();
  }
  if (kind === "mash") {
    if (!uid) return nf();
    const m = await canSeeMash(uid, idv);
    if (!m) return nf();
    if (variant === "poster") return m.posterKey ? streamObject(req, m.posterKey, "image/jpeg") : nf();
    if (!m.outputKey) return nf();
    return streamObject(req, m.outputKey, "video/mp4", url.searchParams.get("download") ? { download: m.title + ".mp4" } : {});
  }
  if (kind === "track") {
    if (!uid) return nf();
    const t = await db.query.tracks.findFirst({ where: eq(schema.tracks.id, idv) });
    const key = t?.playKey || t?.key;
    return key ? streamObject(req, key, "audio/mp4") : nf();
  }
  if (kind === "avatar") {
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, idv) });
    if (!u?.avatarKey) return nf();
    if (!uid) {
      const inv = invite ? await db.query.invites.findFirst({ where: eq(schema.invites.tokenHash, sha256(invite)) }) : null;
      if (!inv || inv.invitedBy !== u.id || inv.status !== "pending") return nf();
    }
    return streamObject(req, u.avatarKey, "image/jpeg");
  }
  return nf();
}
