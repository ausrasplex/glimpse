// Mash rendering: one encoded segment per clip, joined, then the music bed mixed in.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg } from "./ff";
import type { Shape } from "../shared/mash";
import { stampLines } from "../shared/mash";
import { labelText, type Stamp, type Label } from "../shared/textstyle";
import { renderOverlay, type OverlayItem } from "./overlay";

export const FPS = 30;

export type Segment = {
  kind: "video" | "photo";
  file: string;          // original video, or the photo's display JPEG
  start: number;         // seconds into the source (videos)
  len: number;           // seconds in the mash
  orient: "portrait" | "landscape" | "square";
  hasAudio: boolean;
  motion?: string | null;
  date: string; note: string;
  musicTitle?: string | null;
  musicArtist?: string | null;
};

/** fonts: the font file for the stamp and the song title, and the fallbacks (Inter first) for characters a font lacks. */
export type RenderOpts = { W: number; H: number; shape: Shape; fill: "blur" | "crop" | "bars"; stamp: Stamp; label: Label; clipAudio: boolean; fonts: { stamp: string; label: string; fallbacks: string[] }; crf: number };

// Filters that turn the input [in] into a W×H frame [fit] according to the fill rule.
export function fitFilter(o: RenderOpts, orient: Segment["orient"], src = "in"): string {
  const { W, H } = o;
  const same = orient === o.shape;
  if (same || o.fill === "crop") return `[${src}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[fit]`;
  if (o.fill === "bars") return `[${src}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[fit]`;
  const blur = Math.max(10, Math.round(Math.min(W, H) / 40));
  return `[${src}]split=2[bga][fga];[bga]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=${blur}:3,eq=brightness=-0.06[bg];[fga]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[fit]`;
}


// The date stamp and song title for one segment, drawn into a transparent PNG. Null when there's no text.
export async function textOverlay(o: RenderOpts, seg: Segment, i: number, dir: string): Promise<string | null> {
  const items: OverlayItem[] = [];
  if (o.stamp.on) { const [l1, l2] = stampLines(o.stamp, seg.date, seg.note, i); items.push({ look: o.stamp, lines: [l1, (l2 || "").slice(0, 60)], fontFile: o.fonts.stamp }); }
  if (seg.musicTitle) items.push({ look: o.label, lines: [labelText(o.label, seg.musicTitle, seg.musicArtist).slice(0, 60)], fontFile: o.fonts.label });
  const out = join(dir, `text${i}.png`);
  return (await renderOverlay(items, o.W, o.H, o.fonts.fallbacks, out)) ? out : null;
}

// Encode one clip or photo into a uniform segment (H.264, W×H, 30 fps, AAC 48k stereo).
export async function renderSegment(o: RenderOpts, seg: Segment, i: number, dir: string, out: string) {
  const overlay = await textOverlay(o, seg, i, dir);
  const frames = Math.max(1, Math.round(seg.len * FPS));
  const dur = (frames / FPS).toFixed(3);
  // The text PNG goes in as the last input; ov is its input number.
  let ov = 2;
  const tail = (label: string) => (overlay ? `[${label}][${ov}:v]overlay=0:0:format=auto,format=yuv420p[v]` : `[${label}]format=yuv420p[v]`);
  let args: string[];
  if (seg.kind === "photo") {
    const z = seg.motion === "out" ? `1.12-0.12*on/${frames}` : seg.motion === "pan" ? "1.14" : seg.motion === "still" ? "1" : `1+0.12*on/${frames}`;
    const x = seg.motion === "pan" ? `(iw-iw/zoom)*on/${frames}` : "iw/2-(iw/zoom/2)";
    const fc = [
      fitFilter(o, seg.orient, "0:v"),
      `[fit]scale=${o.W * 2}:${o.H * 2},zoompan=z='${z}':x='${x}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${o.W}x${o.H}:fps=${FPS}[zp]`,
      tail("zp")
    ].join(";");
    args = ["-i", seg.file, "-f", "lavfi", "-t", dur, "-i", "anullsrc=r=48000:cl=stereo", ...(overlay ? ["-i", overlay] : []), "-filter_complex", fc, "-map", "[v]", "-map", "1:a"];
  } else {
    const useAudio = o.clipAudio && seg.hasAudio;
    if (useAudio) ov = 1;
    const fc = [`[0:v]fps=${FPS}[in]`, fitFilter(o, seg.orient, "in"), tail("fit")].join(";");
    args = ["-ss", seg.start.toFixed(3), "-t", dur, "-i", seg.file];
    if (!useAudio) args.push("-f", "lavfi", "-t", dur, "-i", "anullsrc=r=48000:cl=stereo");
    if (overlay) args.push("-i", overlay);
    args.push("-filter_complex", fc + (useAudio ? ";[0:a]aresample=48000,aformat=channel_layouts=stereo,apad[a]" : ""), "-map", "[v]", "-map", useAudio ? "[a]" : "1:a");
  }
  // Audio stays uncompressed (PCM in a .mov) until the final mix, so it's only AAC-encoded once, at the preset's bitrate.
  args.push("-frames:v", String(frames), "-t", dur, "-c:v", "libx264", "-preset", "veryfast", "-crf", String(o.crf), "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-video_track_timescale", "30000", "-f", "mov", out);
  await ffmpeg(args, 20 * 60e3);
}

export async function concatSegments(files: string[], dir: string, out: string) {
  const list = join(dir, "list.txt");
  await writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-f", "mov", out]);
}

export type BedTrack = { file: string; start: number; fadeIn: number; fadeOut: number; duration: number };

// The tracklist as one audio file: each track from its start point, crossfaded, looped or faded to fit.
export async function buildBed(tracks: BedTrack[], total: number, crossfade: number, whenEnds: "loop" | "fade", dir: string): Promise<string> {
  // Uncompressed WAV between steps; the final mix does the one AAC encode.
  const one = join(dir, "bed1.wav");
  const inputs: string[] = [];
  tracks.forEach((t) => inputs.push("-ss", t.start.toFixed(2), "-i", t.file));
  const parts: string[] = [];
  tracks.forEach((t, i) => {
    const len = Math.max(1, t.duration - t.start);
    const fo = Math.max(0, t.fadeOut);
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo${t.fadeIn > 0 ? `,afade=t=in:d=${t.fadeIn}` : ""}${fo > 0 && i === tracks.length - 1 ? `,afade=t=out:st=${Math.max(0, len - fo).toFixed(2)}:d=${fo}` : ""}[t${i}]`);
  });
  let last = "t0";
  for (let i = 1; i < tracks.length; i++) {
    const d = Math.max(0.01, crossfade);
    parts.push(`[${last}][t${i}]acrossfade=d=${d}:c1=tri:c2=tri[x${i}]`);
    last = `x${i}`;
  }
  await ffmpeg([...inputs, "-filter_complex", parts.join(";"), "-map", `[${last}]`, "-c:a", "pcm_s16le", one]);
  const bedLen = tracks.reduce((a, t) => a + Math.max(1, t.duration - t.start), 0) - Math.max(0, tracks.length - 1) * crossfade;
  const out = join(dir, "bed.wav");
  const fadeAt = Math.max(0, total - 2).toFixed(2);
  if (bedLen < total && whenEnds === "loop") await ffmpeg(["-stream_loop", "-1", "-i", one, "-t", total.toFixed(3), "-af", `afade=t=out:st=${fadeAt}:d=2`, "-c:a", "pcm_s16le", out]);
  else await ffmpeg(["-i", one, "-t", total.toFixed(3), "-af", `apad,atrim=0:${total.toFixed(3)},afade=t=out:st=${fadeAt}:d=2`, "-c:a", "pcm_s16le", out]);
  return out;
}

// Final mux: video copied, audio = clips, music, or both (music under the clips at `level`), AAC-encoded once at `audioKbps`.
export async function mixFinal(video: string, bed: string | null, audio: "both" | "music" | "clips", level: number, audioKbps: number, out: string) {
  const aac = ["-c:a", "aac", "-b:a", `${audioKbps}k`, "-ar", "48000", "-ac", "2"];
  const tail = ["-c:v", "copy", ...aac, "-movflags", "+faststart", out];
  if (!bed || audio === "clips") { await ffmpeg(["-i", video, "-map", "0:v", "-map", "0:a", ...tail]); return; }
  if (audio === "music") { await ffmpeg(["-i", video, "-i", bed, "-map", "0:v", "-map", "1:a", "-shortest", ...tail]); return; }
  const v = Math.max(0, Math.min(1, level / 100)).toFixed(2);
  await ffmpeg(["-i", video, "-i", bed, "-filter_complex", `[1:a]volume=${v}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`, "-map", "0:v", "-map", "[a]", ...tail]);
}
