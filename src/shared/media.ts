// Which files Glimpse accepts as clips or photos, shared by the picker, the upload routes and the tests.

export const VIDEO_TYPES: Record<string, string> = {
  mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska",
  "3gp": "video/3gpp", avi: "video/x-msvideo", mts: "video/mp2t"
};
export const PHOTO_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif"
};
const PHOTO_MIMES = new Set(Object.values(PHOTO_TYPES));

/**
 * The picker's accept list: media types, plus extensions phones often label wrongly.
 * application/mp4 (still a video container) is there because Android Chrome opens its gallery-style photo picker
 * when every accepted type is image/* or video/*; one other type makes it open the file manager instead.
 */
export const ACCEPT = ["video/*", "image/*", "application/mp4"].concat(Object.keys(VIDEO_TYPES).concat(Object.keys(PHOTO_TYPES)).map((e) => "." + e)).join(",");

const extOf = (name: string) => { const m = /\.([a-z0-9]{1,5})$/i.exec(name || ""); return m ? m[1].toLowerCase() : ""; };

/** Video or photo from the file's type, or from its extension when the type is missing or generic. Null for anything else. */
export function kindOfFile(name: string, type: string): { kind: "video" | "photo"; type: string } | null {
  const t = (type || "").toLowerCase();
  const ext = extOf(name);
  if (t.startsWith("video/")) return { kind: "video", type: t };
  if (t === "application/mp4") return { kind: "video", type: "video/mp4" };
  if (PHOTO_MIMES.has(t)) return { kind: "photo", type: t };
  if (!t || t === "application/octet-stream") {
    if (VIDEO_TYPES[ext]) return { kind: "video", type: VIDEO_TYPES[ext] };
    if (PHOTO_TYPES[ext]) return { kind: "photo", type: PHOTO_TYPES[ext] };
  }
  return null;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...Array.from(b.subarray(at, at + n)));
const PHOTO_BRANDS = new Set(["heic", "heix", "heim", "heis", "mif1", "msf1", "avif"]);
const QT_ATOMS = new Set(["moov", "mdat", "wide", "free", "skip", "pnot"]);

/** What a file really is, from its first bytes (at least 200 to recognise MPEG-TS). Null when it's neither a known video nor photo. */
export function sniffKind(b: Uint8Array): "video" | "photo" | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "photo";
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "photo";
  if (ascii(b, 0, 4) === "RIFF") { const f = ascii(b, 8, 4); return f === "WEBP" ? "photo" : f === "AVI " ? "video" : null; }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video";
  const box = ascii(b, 4, 4);
  if (box === "ftyp") return PHOTO_BRANDS.has(ascii(b, 8, 4)) ? "photo" : "video";
  if (QT_ATOMS.has(box)) return "video";
  // MPEG transport stream: sync byte every 188 bytes, or every 192 with a 4-byte timestamp (.mts / .m2ts).
  if (b.length >= 189 && b[0] === 0x47 && b[188] === 0x47) return "video";
  if (b.length >= 197 && b[4] === 0x47 && b[196] === 0x47) return "video";
  return null;
}

/**
 * Where the short video inside a motion photo starts (Google and Samsung add an MP4 after the picture), or null.
 * Found by its "ftyp" box; the photo's own ftyp (HEIC) at the very start is skipped, as are photo brands.
 */
export function embeddedVideoAt(b: Uint8Array): number | null {
  for (let i = 12; i + 8 <= b.length; i++) {
    if (b[i] !== 0x66 || b[i + 1] !== 0x74 || b[i + 2] !== 0x79 || b[i + 3] !== 0x70) continue;
    const len = ((b[i - 4] << 24) | (b[i - 3] << 16) | (b[i - 2] << 8) | b[i - 1]) >>> 0;
    if (len < 16 || len > 256 || len % 4) continue;
    const brand = ascii(b, i + 4, 4);
    if (!/^[A-Za-z0-9 ]{4}$/.test(brand) || PHOTO_BRANDS.has(brand)) continue;
    return i - 4;
  }
  return null;
}

/** Longest clip a glimpse can keep, in seconds. 10 unless the admin turned on longer clips; max 0 means no limit. */
export const CLIP_MAX_DEFAULT = 10;
export const CLIP_NO_LIMIT = 36000;
export function clipMaxOf(limit?: { on?: boolean; max?: number } | null): number {
  if (!limit || !limit.on) return CLIP_MAX_DEFAULT;
  return limit.max && limit.max > 0 ? Math.max(CLIP_MAX_DEFAULT, Math.min(CLIP_NO_LIMIT, limit.max)) : CLIP_NO_LIMIT;
}
