import { readFile } from "node:fs/promises";
import { handle, requireFileUser } from "@/server/http";
import { ensureFont, known } from "@/server/fonts";
import { getSettings } from "@/server/settings";
export const dynamic = "force-dynamic";

const name = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };

// The full font, for the preview and picker. Downloads it from Google Fonts first if it isn't here yet.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ family: string }> }) => {
  await requireFileUser(req);
  const family = name((await ctx.params).family);
  if (!known(family)) return new Response("Not found", { status: 404 });
  const s = await getSettings();
  let path: string | null = null;
  try { path = await ensureFont(family, s.googleFonts); } catch (e) { console.error("[fonts]", family, (e as Error).message); }
  if (!path) return new Response("Not available", { status: 404 });
  return new Response(new Uint8Array(await readFile(path)), { headers: { "Content-Type": "font/ttf", "Cache-Control": "private, max-age=604800" } });
});
