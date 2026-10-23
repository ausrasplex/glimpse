// A quick guess at the day a picked file was filmed, read in the browser before the upload finishes.
// Only a hint: the server reads the original properly and its answer wins when it arrives.
// File.lastModified is never used: iPhones hand over a fresh copy, so it's usually "now".
import { takenDayFrom } from "../shared/dates";

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; } };
const read = async (file, at, n) => new Uint8Array(await file.slice(at, at + n).arrayBuffer());
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const type = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

// MP4/MOV: find the moov box, then Apple's local creation date, else the movie header's UTC creation time.
async function videoDay(file) {
  let at = 0;
  for (let guard = 0; guard < 64 && at + 8 <= file.size; guard++) {
    const h = await read(file, at, 16);
    let size = u32(h, 0);
    const kind = type(h, 4);
    if (size === 1) size = u32(h, 8) * 4294967296 + u32(h, 12);
    else if (size === 0) size = file.size - at;
    if (size < 8) return null;
    if (kind === "moov") {
      const moov = await read(file, at, Math.min(size, 24 * 1024 * 1024));
      const text = new TextDecoder("latin1").decode(moov);
      const apple = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:?\d{2})/.exec(text.slice(Math.max(0, text.indexOf("com.apple.quicktime.creationdate"))));
      if (text.indexOf("com.apple.quicktime.creationdate") >= 0 && apple) { const r = takenDayFrom(apple[1], tz()); if (r) return r.day; }
      const i = text.indexOf("mvhd");
      if (i < 0) return null;
      const v = moov[i + 4];
      const secs = v === 1 ? u32(moov, i + 8) * 4294967296 + u32(moov, i + 12) : u32(moov, i + 8);
      if (!secs) return null;
      const r = takenDayFrom(new Date((secs - 2082844800) * 1000).toISOString(), tz());
      return r ? r.day : null;
    }
    at += size;
  }
  return null;
}

async function photoDay(file) {
  const exifr = (await import("exifr")).default;
  const x = await exifr.parse(file, { pick: ["DateTimeOriginal", "OffsetTimeOriginal", "CreateDate", "OffsetTime"], reviveValues: false });
  const when = x && (x.DateTimeOriginal || x.CreateDate);
  const r = when ? takenDayFrom(when + (x.OffsetTimeOriginal || x.OffsetTime || ""), tz()) : null;
  return r ? r.day : null;
}

/** The filmed day ("YYYY-MM-DD") or null. Never throws. */
export async function filmedDay(file, kind) {
  try { return kind === "photo" ? await photoDay(file) : await videoDay(file); } catch (e) { return null; }
}
