// Mash rules shared by the app (preview) and the worker (render).
export type Orient = "portrait" | "landscape" | "square";
export type Shape = Orient;
export const AR: Record<Orient, number> = { portrait: 9 / 16, landscape: 16 / 9, square: 1 };
export const OUTPUT: Record<string, Record<Shape, [number, number]>> = {
  "720": { portrait: [720, 1280], landscape: [1280, 720], square: [720, 720] },
  "1080": { portrait: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] },
  "4k": { portrait: [2160, 3840], landscape: [3840, 2160], square: [2160, 2160] }
};

import type { Stamp, Label } from "./textstyle";
export type { Stamp, Label } from "./textstyle";
export { STAMP_DEFAULT, LABEL_DEFAULT } from "./textstyle";

export type TrackRef = { trackId: string; start: number; fadeIn: number; fadeOut: number };
export type MashSettings = {
  shape: Shape; fill: "blur" | "crop" | "bars"; clipMode: "trimmed" | "cap"; cap: number; stamp: Stamp;
  tracks: TrackRef[]; crossfade: number; whenEnds: "loop" | "fade"; audio: "both" | "music" | "clips"; level: number;
  sync: "off" | "auto" | "fixed"; beats: number; stretch: boolean; musicLabel: boolean;
  /** How the song title looks. Missing on older mashes: the default look. */
  label?: Label;
  /** Output quality preset. Missing on mashes made before presets existed: treated as "high". */
  quality?: Quality;
};

/**
 * Mash quality presets. Video: H.264 CRF (lower = better, bigger). Audio: AAC target bitrate, encoded once in the final mix.
 * FFmpeg's built-in AAC encoder treats the bitrate as a ceiling: dense audio uses all of it, simpler sound (most
 * phone audio and a lot of music) settles around 240 kbps because extra bits wouldn't be audible.
 */
export type Quality = "smaller" | "high" | "best";
export const QUALITIES: readonly Quality[] = ["smaller", "high", "best"];
export const QUALITY: Record<Quality, { crf: number; audioKbps: number; label: string; hint: string }> = {
  smaller: { crf: 23, audioKbps: 192, label: "Smaller", hint: "About a third smaller files" },
  high: { crf: 20, audioKbps: 256, label: "High", hint: "Great for phones, TVs and sharing" },
  best: { crf: 18, audioKbps: 320, label: "Best", hint: "About a third larger files" }
};
export const qualityOf = (q: unknown): Quality => (QUALITIES.includes(q as Quality) ? (q as Quality) : "high");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function stampDate(k: string, format: Stamp["format"]): string {
  const [y, m, d] = k.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (format === "long") return `${d} ${MONTH[m - 1]} ${y}`;
  if (format === "num") return `${d}/${m}/${String(y).slice(2)}`;
  return `${WD[wd]} ${d} ${MON[m - 1]}`;
}
export function stampLines(st: Stamp, date: string, note: string, i: number): [string, string | null] {
  const line1 = st.show === "day" ? `Day ${i + 1}` : stampDate(date, st.format);
  const line2 = st.show === "dateNote" && note ? note : st.show === "day" ? stampDate(date, st.format) : null;
  return [line1, line2];
}

// Beat sync: keep the start, move the end to a beat. May use up to half a beat (max 0.5s) of
// footage outside the trim, if the original has it. Photos can stretch freely.
export function syncedLen(c: { len: number; start: number; end: number; duration: number; photo?: boolean }, beatLen: number, mode: "auto" | "fixed", beats: number, stretch: boolean): number {
  if (c.photo) return mode === "fixed" ? beats * beatLen : Math.max(1, Math.round(c.len / beatLen)) * beatLen;
  const slack = Math.min(0.5 * beatLen, 0.5);
  const spare = Math.max(0, (c.duration || c.end) - c.end) + Math.max(0, c.start);
  const maxLen = c.len + (stretch ? Math.min(slack, spare) : 0);
  if (mode === "fixed") return Math.min(beats * beatLen, maxLen);
  const n = Math.max(1, Math.round(c.len / beatLen));
  let target = n * beatLen;
  if (target > maxLen) target = Math.max(1, Math.floor(maxLen / beatLen)) * beatLen;
  return target > maxLen ? maxLen : target;
}

// Where the extra footage comes from when a clip is lengthened: after the end first, then before the start.
export function extendWindow(start: number, len: number, target: number, duration: number): { start: number; len: number } {
  if (target <= len) return { start, len: target };
  const extra = target - len;
  const after = Math.max(0, duration - (start + len));
  const useAfter = Math.min(extra, after);
  const useBefore = Math.min(extra - useAfter, start);
  return { start: start - useBefore, len: len + useAfter + useBefore };
}

export function segmentLen(c: { len: number; start: number; end: number; duration: number; photo?: boolean }, s: MashSettings, bpm: number | null): number {
  const musicOn = s.audio !== "clips" && s.tracks.length > 0;
  if (musicOn && s.sync !== "off") return syncedLen(c, 60 / (bpm || 96), s.sync, s.beats, s.stretch !== false);
  if (s.clipMode === "cap") return Math.min(s.cap, c.len);
  return c.len;
}
