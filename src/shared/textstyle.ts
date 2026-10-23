// How the date stamp and the song title look on a mash. Shared by the app's preview, the server's checks and the
// renderer, so all three agree. Sizes are fractions of the video's short side; boxes are measured from the text.

export type Corner = "tl" | "tr" | "bl" | "br";
export type TextLook = {
  pos: Corner;
  /** Starting point: pill (box behind), plain (shadow only) or bold (capitals, shadow). */
  style: "pill" | "plain" | "bold";
  size: "s" | "m" | "l" | "xl";
  font: string;
  color: string;
  bg: string;
  /** 0 = no box, just a shadow. */
  bgOpacity: number;
  radius: "none" | "s" | "m" | "full";
  pad: "s" | "m" | "l";
};
export type Stamp = TextLook & { on: boolean; show: "date" | "dateNote" | "day"; format: "short" | "long" | "num" };
export type Label = TextLook & { show: "title" | "titleArtist" | "note"; match: boolean };

export const DEFAULT_FONT = "Inter";
export const STAMP_DEFAULT: Stamp = { on: true, show: "date", format: "short", pos: "tr", style: "pill", size: "m", font: DEFAULT_FONT, color: "#FFFFFF", bg: "#000000", bgOpacity: 0.45, radius: "m", pad: "m" };
export const LABEL_DEFAULT: Label = { show: "title", match: false, pos: "bl", style: "pill", size: "s", font: DEFAULT_FONT, color: "#FFFFFF", bg: "#000000", bgOpacity: 0.45, radius: "s", pad: "m" };
export const LOOK_KEYS = ["style", "size", "font", "color", "bg", "bgOpacity", "radius", "pad"] as const;

/** A preset as a starting point: sets the box and leaves font, size and colours alone. */
export function withPreset<T extends TextLook>(t: T, style: TextLook["style"]): T {
  if (style === "pill") return { ...t, style, bgOpacity: t.bgOpacity > 0 ? t.bgOpacity : 0.45, radius: t.radius === "none" ? "m" : t.radius };
  return { ...t, style, bgOpacity: 0 };
}
/** The song title borrowing the date stamp's look (keeps its own position and what it shows). */
export const matched = (label: Label, stamp: Stamp): Label => {
  const out = { ...label } as Record<string, unknown>;
  for (const k of LOOK_KEYS) out[k] = stamp[k];
  return out as Label;
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : d);
const fontName = (v: unknown, d: string) => (typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9 \-]{0,59}$/.test(v.trim()) ? v.trim() : d);
function cleanLook<T extends TextLook>(r: Record<string, unknown>, d: T): TextLook {
  return {
    pos: pick(r.pos, ["tl", "tr", "bl", "br"] as const, d.pos), style: pick(r.style, ["pill", "plain", "bold"] as const, d.style),
    size: pick(r.size, ["s", "m", "l", "xl"] as const, d.size), font: fontName(r.font, d.font), color: hex(r.color, d.color), bg: hex(r.bg, d.bg),
    bgOpacity: typeof r.bgOpacity === "number" && isFinite(r.bgOpacity) ? Math.round(Math.min(1, Math.max(0, r.bgOpacity)) * 100) / 100 : r.style === "plain" || r.style === "bold" ? 0 : d.bgOpacity,
    radius: pick(r.radius, ["none", "s", "m", "full"] as const, d.radius), pad: pick(r.pad, ["s", "m", "l"] as const, d.pad)
  };
}
export function cleanStamp(raw: unknown): Stamp {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { ...cleanLook(r, STAMP_DEFAULT), on: r.on !== false, show: pick(r.show, ["date", "dateNote", "day"] as const, STAMP_DEFAULT.show), format: pick(r.format, ["short", "long", "num"] as const, STAMP_DEFAULT.format) };
}
export function cleanLabel(raw: unknown): Label {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { ...cleanLook(r, LABEL_DEFAULT), show: pick(r.show, ["title", "titleArtist", "note"] as const, LABEL_DEFAULT.show), match: r.match === true };
}

/** What the song title says. */
export function labelText(l: Label, title: string, artist?: string | null): string {
  if (l.show === "titleArtist" && artist) return title + " – " + artist;
  if (l.show === "note") return "♪ " + title;
  return title;
}

// ---------- Geometry ----------
const SIZE = { s: 0.034, m: 0.042, l: 0.054, xl: 0.07 };
const PAD = { s: 0.25, m: 0.42, l: 0.62 };
export type Box = {
  x: number; y: number; w: number; h: number; r: number; padX: number; padY: number;
  lines: { text: string; size: number; weight: number; x: number; baseline: number; alpha: number }[];
  look: TextLook; upper: boolean; shadow: boolean;
};
/** Font size of a look's first line, in pixels, on a video whose short side is `short`. */
export const fontPx = (t: TextLook, short: number) => short * SIZE[t.size] * (t.style === "bold" ? 1.2 : 1);

/**
 * Lay out one text box. `measure(text, px, weight)` gives a line's width in pixels.
 * The box is placed later (see placeBoxes); here x and y are 0.
 */
export function layoutBox(t: TextLook, lines: string[], short: number, measure: (text: string, px: number, weight: number) => number): Box {
  const upper = t.style === "bold";
  const fs = fontPx(t, short), fs2 = fs * 0.82;
  const padX = t.bgOpacity > 0 ? fs * PAD[t.pad] : 0, padY = t.bgOpacity > 0 ? fs * PAD[t.pad] * 0.55 : 0;
  const gap = fs * 0.22;
  const ls = lines.filter(Boolean).slice(0, 2).map((s, i) => ({ text: upper ? s.toUpperCase() : s, size: i ? fs2 : fs, weight: i ? 500 : upper ? 800 : 700 }));
  const widths = ls.map((l) => measure(l.text, l.size, l.weight));
  const w = Math.max(0, ...widths) + padX * 2;
  let y = padY;
  const out = ls.map((l, i) => { const lineH = l.size * 1.2; const base = y + l.size * 0.95; y += lineH + (i < ls.length - 1 ? gap : 0); return { ...l, x: 0, baseline: base, alpha: i ? 0.92 : 1, width: widths[i] }; });
  const h = y + padY;
  const r = t.bgOpacity > 0 ? (t.radius === "full" ? h / 2 : t.radius === "m" ? fs * 0.5 : t.radius === "s" ? fs * 0.22 : 0) : 0;
  const right = t.pos[1] === "r";
  return { x: 0, y: 0, w, h, r, padX, padY, upper, shadow: t.bgOpacity < 0.2, look: t, lines: out.map((l) => ({ text: l.text, size: l.size, weight: l.weight, alpha: l.alpha, baseline: l.baseline, x: right ? w - padX - l.width : padX })) };
}

/** Put boxes in their corners, 5% in from the edges. Two in the same corner stack, the first nearest the edge. */
export function placeBoxes(boxes: Box[], W: number, H: number): Box[] {
  const m = Math.round(Math.min(W, H) * 0.05);
  const used: Record<string, number> = {};
  return boxes.map((b) => {
    const c = b.look.pos, gap = b.lines.length ? b.lines[0].size * 0.4 : 0;
    const off = used[c] || 0;
    used[c] = off + b.h + gap;
    const x = c[1] === "l" ? m : W - m - b.w;
    const y = c[0] === "t" ? m + off : H - m - off - b.h;
    return { ...b, x, y };
  });
}
