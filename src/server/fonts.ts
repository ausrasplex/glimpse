// Fonts for the date stamp and song title. A few ship with Glimpse; any other Google Fonts family is downloaded
// once, by the server, into DATA_DIR/fonts, and served to the app from here, so viewers' browsers never contact Google.
import { mkdir, readFile, stat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { env } from "./env";
import catalogue from "../shared/google-fonts.json";

export type Category = "s" | "r" | "d" | "h" | "m";
export const BUNDLED: { family: string; file: string; cat: Category }[] = [
  { family: "Inter", file: "Inter-700.ttf", cat: "s" },
  { family: "Playfair Display", file: "PlayfairDisplay-700.ttf", cat: "r" },
  { family: "JetBrains Mono", file: "JetBrainsMono-700.ttf", cat: "m" },
  { family: "Caveat", file: "Caveat-700.ttf", cat: "h" },
  { family: "Oswald", file: "Oswald-700.ttf", cat: "d" }
];
const CATALOGUE = new Map((catalogue as [string, Category, number][]).map(([f, c, w]) => [f, { cat: c, weight: w }]));
const MAX_FONT = 15 * 1024 * 1024;

const bundledDir = () => join(process.env.APP_DIR || process.cwd(), "fonts");
/** A tiny font with just the music notes ♪ ♫, used when the chosen font and Inter don't have them. */
export const fallbackNotes = () => join(bundledDir(), "NotoMusic-notes.ttf");
const downloadDir = () => join(env.dataDir, "fonts");
const slug = (family: string) => family.replace(/[^A-Za-z0-9]+/g, "-");
const exists = async (p: string) => { try { return (await stat(p)).size > 0; } catch { return false; } };

export const known = (family: string) => CATALOGUE.has(family) || BUNDLED.some((b) => b.family === family);
export const categoryOf = (family: string): Category => BUNDLED.find((b) => b.family === family)?.cat || CATALOGUE.get(family)?.cat || "s";

/** The font's file on this server, or null if it hasn't been downloaded. */
export async function fontPath(family: string): Promise<string | null> {
  const b = BUNDLED.find((x) => x.family === family);
  if (b) return join(bundledDir(), b.file);
  const p = join(downloadDir(), slug(family) + ".ttf");
  return (await exists(p)) ? p : null;
}

// Google's CSS API answers plain clients with TrueType links on fonts.gstatic.com.
async function fetchTtf(cssUrl: string): Promise<Buffer> {
  const css = await (await fetch(cssUrl, { signal: AbortSignal.timeout(15e3) })).text();
  const m = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(css);
  if (!m) throw new Error("Google Fonts didn't return a font file.");
  const r = await fetch(m[1], { signal: AbortSignal.timeout(30e3) });
  if (!r.ok) throw new Error("Google Fonts answered " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_FONT) throw new Error("That font file is too large.");
  return buf;
}
const css = (family: string, extra = "") => "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family).replace(/%20/g, "+") + extra;

const inflight = new Map<string, Promise<string>>();
/** The font's file, downloading it from Google Fonts first if needed (and allowed). */
export async function ensureFont(family: string, allowDownload: boolean): Promise<string | null> {
  const have = await fontPath(family);
  if (have || !allowDownload || !CATALOGUE.has(family)) return have;
  if (!inflight.has(family)) {
    inflight.set(family, (async () => {
      const w = CATALOGUE.get(family)!.weight;
      let buf: Buffer;
      try { buf = await fetchTtf(css(family, ":wght@" + w)); } catch { buf = await fetchTtf(css(family)); }
      await mkdir(downloadDir(), { recursive: true });
      const p = join(downloadDir(), slug(family) + ".ttf"), tmp = p + ".part";
      await writeFile(tmp, buf); await rename(tmp, p);
      return p;
    })().finally(() => inflight.delete(family)));
  }
  return inflight.get(family)!;
}

/** A tiny font holding only the letters of the family's own name, for the picker's list. Cached on disk. */
export async function previewFont(family: string, allowDownload: boolean): Promise<Buffer | null> {
  const full = await fontPath(family);
  if (full) return readFile(full);
  if (!allowDownload || !CATALOGUE.has(family)) return null;
  const p = join(downloadDir(), "preview", slug(family) + ".ttf");
  if (await exists(p)) return readFile(p);
  const buf = await fetchTtf(css(family, ":wght@" + CATALOGUE.get(family)!.weight + "&text=" + encodeURIComponent(family)));
  await mkdir(join(downloadDir(), "preview"), { recursive: true });
  await writeFile(p, buf);
  return buf;
}

/** Fonts with a full file on this server, most used first (by mashes and saved defaults). */
export async function storedFonts(): Promise<{ family: string; cat: Category; uses: number }[]> {
  const fams = BUNDLED.map((b) => b.family);
  try {
    const { readdir } = await import("node:fs/promises");
    for (const f of await readdir(downloadDir())) {
      if (!f.endsWith(".ttf")) continue;
      const name = [...CATALOGUE.keys()].find((k) => slug(k) + ".ttf" === f);
      if (name && !fams.includes(name)) fams.push(name);
    }
  } catch { /* none downloaded yet */ }
  const r = await db.execute(sql`
    select f, count(*)::int as n from (
      select settings->'stamp'->>'font' as f from mashes union all select settings->'label'->>'font' from mashes
      union all select prefs->'stamp'->>'font' from users union all select prefs->'label'->>'font' from users
    ) x where f is not null group by f`);
  const uses = new Map((r.rows as { f: string; n: number }[]).map((x) => [x.f, x.n]));
  return fams.map((family) => ({ family, cat: categoryOf(family), uses: uses.get(family) || 0 })).sort((a, b) => b.uses - a.uses || fams.indexOf(a.family) - fams.indexOf(b.family));
}
