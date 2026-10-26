import { handle, requireFileUser } from "@/server/http";
import { previewFont, known } from "@/server/fonts";
import { getSettings } from "@/server/settings";
export const dynamic = "force-dynamic";

const name = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };

// Just enough of a font to write its own name, for the picker's list.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ family: string }> }) => {
  await requireFileUser(req);
  const family = name((await ctx.params).family);
  if (!known(family)) return new Response("Not found", { status: 404 });
  const s = await getSettings();
  let buf: Buffer | null = null;
  try { buf = await previewFont(family, s.googleFonts); } catch { buf = null; }
  if (!buf) return new Response("Not available", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "font/ttf", "Cache-Control": "private, max-age=604800" } });
});
