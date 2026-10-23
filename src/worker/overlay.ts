// Draws the date stamp and song title as a transparent PNG the size of the video, for FFmpeg to lay over each clip.
// The layout comes from shared/textstyle.ts (as in the app's preview); text is measured with each font's own metrics,
// and characters a font lacks fall back to Inter, then a small music-note font. Characters none of them has
// (emoji, mostly) are left out rather than drawn as empty boxes.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import opentype from "opentype.js";
import { layoutBox, placeBoxes, type Box, type TextLook } from "../shared/textstyle";

type Face = { buf: Uint8Array; font: opentype.Font; family: string };
const faces = new Map<string, Promise<Face>>();
let ready: Promise<void> | null = null;

function wasmPath() {
  const near = join(__dirname, "resvg.wasm");
  return existsSync(near) ? near : join(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm");
}
const init = () => (ready ??= readFile(wasmPath()).then((b) => initWasm(b)));

function face(path: string): Promise<Face> {
  if (!faces.has(path)) faces.set(path, readFile(path).then((b) => {
    const font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    const n = font.names as unknown as Record<string, Record<string, string>>;
    const family = (n.preferredFamily || n.fontFamily || {}).en || "Inter";
    return { buf: new Uint8Array(b), font, family };
  }));
  return faces.get(path)!;
}

// Width of a line: each character from the first face that has it.
function measure(text: string, px: number, list: Face[], spacing: number): number {
  let w = 0;
  for (const ch of Array.from(text)) {
    const f = list.find((x) => x.font.charToGlyphIndex(ch) > 0) || list[0];
    w += (f.font.getAdvanceWidth(ch, px) || px * 0.5) + spacing * px;
  }
  return w;
}

const drawable = (text: string, list: Face[]) => Array.from(text).filter((ch) => /\s/.test(ch) || list.some((x) => x.font.charToGlyphIndex(ch) > 0)).join("").replace(/\s+/g, " ").trim();
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type OverlayItem = { look: TextLook; lines: string[]; fontFile: string };

/** Render the items (first one nearest its corner) into a W×H PNG at `out`. `fallbacks` are font files for missing characters. False if there's nothing to draw. */
export async function renderOverlay(items: OverlayItem[], W: number, H: number, fallbacks: string[], out: string): Promise<boolean> {
  if (!items.some((x) => x.lines.some(Boolean))) return false;
  await init();
  const backs = await Promise.all(fallbacks.map((p) => face(p)));
  const base = backs[0];
  const short = Math.min(W, H);
  const boxes: { box: Box; faces: Face[] }[] = [];
  for (const it of items) {
    const own = await face(it.fontFile).catch(() => base);
    const list = [own, ...backs.filter((b) => b !== own)];
    const lines = it.lines.map((l) => drawable(l, list));
    if (!lines.some(Boolean)) continue;
    const spacing = it.look.style === "bold" ? 0.04 : 0;
    boxes.push({ box: layoutBox(it.look, lines, short, (t, px) => measure(t, px, list, spacing)), faces: list });
  }
  if (!boxes.length) return false;
  const placed = placeBoxes(boxes.map((b) => b.box), W, H);
  const parts = placed.map((b, i) => {
    const fams = boxes[i].faces.map((f) => `'${xml(f.family)}'`).join(", ");
    const shadow = b.shadow ? ` filter="url(#sh)"` : "";
    const rect = b.look.bgOpacity > 0 ? `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="${b.r.toFixed(1)}" fill="${b.look.bg}" fill-opacity="${b.look.bgOpacity}"/>` : "";
    const texts = b.lines.map((l) => `<text x="${(b.x + l.x).toFixed(1)}" y="${(b.y + l.baseline).toFixed(1)}" font-family="${fams}" font-size="${l.size.toFixed(1)}" font-weight="${l.weight}" fill="${b.look.color}" fill-opacity="${l.alpha}"${b.upper ? ' letter-spacing="' + (l.size * 0.04).toFixed(2) + '"' : ""}${shadow}>${xml(l.text)}</text>`).join("");
    return rect + texts;
  }).join("");
  const blur = Math.max(1, short / 260);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><filter id="sh" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="${(blur * 0.6).toFixed(1)}" stdDeviation="${blur.toFixed(1)}" flood-color="#000" flood-opacity="0.75"/></filter></defs>${parts}</svg>`;
  const fontBuffers = [...new Map(boxes.flatMap((b) => b.faces).map((f) => [f.family, f.buf])).values()];
  const png = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: base.family } }).render().asPng();
  await writeFile(out, png);
  return true;
}
