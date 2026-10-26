import { fileSession } from "@/server/session";
import { immich } from "@/server/immich";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await fileSession(req);
  const { id } = await ctx.params;
  if (!s || !/^[\w-]+$/.test(id)) return new Response("Not found", { status: 404 });
  try {
    const r = await immich(s.user.id, `/api/assets/${id}/thumbnail?size=thumbnail`, { headers: { Accept: "image/*" } });
    return new Response(r.body, { headers: { "Content-Type": r.headers.get("content-type") || "image/webp", "Cache-Control": "private, max-age=86400" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
