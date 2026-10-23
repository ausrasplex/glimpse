import { handle, json, requireUser } from "@/server/http";
import { storedFonts } from "@/server/fonts";
import { getSettings } from "@/server/settings";
export const dynamic = "force-dynamic";

// Fonts already on this server (most used first), and whether others may be downloaded from Google Fonts.
export const GET = handle(async () => {
  await requireUser();
  const s = await getSettings();
  return json({ stored: await storedFonts(), google: s.googleFonts });
});
