// Mash rendering: one encoded segment per clip, joined, then the music bed mixed in.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg } from "./ff";
import type { Stamp, Shape } from "../shared/mash";
import { stampLines } from "../shared/mash";

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
};

export type RenderOpts = { W: number; H: number; shape: Shape; fill: "blur" | "crop" | "bars"; stamp: Stamp; clipAudio: boolean; font: string | null; crf: number };

const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

// Filters that turn the input [in] into a W×H frame [fit] according to the fill rule.
export function fitFilter(o: RenderOpts, orient: Segment["orient"], src = "in"): string {
  const { W, H } = o;
  const same = orient === o.shape;
  if (same || o.fill === "crop") return `[${src}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[fit]`;
  if (o.fill === "bars") return `[${src}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[fit]`;
  const blur = Math.max(10, Math.round(Math.min(W, H) / 40));
  return `[${src}]split=2[bga][fga];[bga]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=${blur}:3,eq=brightness=-0.06[bg];[fga]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[fit]`;
}

// drawtext filters for the date stamp and song title. Text goes through files to avoid escaping.
export async function textFilters(o: RenderOpts, seg: Segment, i: number, dir: string): Promise<string[]> {
  const out: string[] = [];
  if (!o.font) return out;
  const short = Math.min(o.W, o.H);
  const pad = Math.round(short * 0.05);
  const font = `fontfile='${esc(o.font)}'`;
  const st = o.stamp;
  if (st.on) {
    const [l1, l2] = stampLines(st, seg.date, seg.note, i);
    const fs = Math.round(short * ({ s: 0.034, m: 0.042, l: 0.054 }[st.size] || 0.042) * (st.style === "bold" ? 1.25 : 1));
    const fs2 = Math.round(fs * 0.82);
    const t1 = join(dir, `s${i}a.txt`), t2 = join(dir, `s${i}b.txt`);
    await writeFile(t1, st.style === "bold" ? l1.toUpperCase() : l1);
    if (l2) await writeFile(t2, (st.style === "bold" ? l2.toUpperCase() : l2).slice(0, 40));
    const left = st.pos[1] === "l", top = st.pos[0] === "t";
    const box = st.style === "pill" ? `:box=1:boxcolor=black@0.45:boxborderw=${Math.round(fs * 0.35)}` : `:shadowcolor=black@0.7:shadowx=${Math.max(1, Math.round(fs / 14))}:shadowy=${Math.max(1, Math.round(fs / 14))}`;
    const x = left ? `${pad}` : `w-tw-${pad}`;
    const gap = Math.round(fs * (st.style === "pill" ? 0.9 : 0.35));
    const lineH = fs + gap;
    if (top) {
      out.push(`drawtext=${font}:textfile='${esc(t1)}':fontsize=${fs}:fontcolor=white${box}:x=${x}:y=${pad}`);
      if (l2) out.push(`drawtext=${font}:textfile='${esc(t2)}':fontsize=${fs2}:fontcolor=white@0.92${box}:x=${x}:y=${pad + lineH}`);
    } else {
      const y2 = `h-th-${pad}`;
      if (l2) {
        out.push(`drawtext=${font}:textfile='${esc(t2)}':fontsize=${fs2}:fontcolor=white@0.92${box}:x=${x}:y=${y2}`);
        out.push(`drawtext=${font}:textfile='${esc(t1)}':fontsize=${fs}:fontcolor=white${box}:x=${x}:y=h-${pad + fs2 + gap + fs}`);
      } else out.push(`drawtext=${font}:textfile='${esc(t1)}':fontsize=${fs}:fontcolor=white${box}:x=${x}:y=${y2}`);
    }
  }
  if (seg.musicTitle) {
    const fs = Math.round(short * 0.032);
    const tf = join(dir, `m${i}.txt`);
    await writeFile(tf, seg.musicTitle.slice(0, 40));
    const atTop = st.on && st.pos === "bl";
    out.push(`drawtext=${font}:textfile='${esc(tf)}':fontsize=${fs}:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=${Math.round(fs * 0.35)}:x=${pad}:y=${atTop ? pad : `h-th-${pad}`}`);
  }
  return out;
}

// Encode one clip or photo into a uniform segment (H.264, W×H, 30 fps, AAC 48k stereo).
export async function renderSegment(o: RenderOpts, seg: Segment, i: number, dir: string, out: string) {
  const text = await textFilters(o, seg, i, dir);
  const frames = Math.max(1, Math.round(seg.len * FPS));
  const dur = (frames / FPS).toFixed(3);
  const tail = (label: string) => (text.length ? `[${label}]${text.join(",")},format=yuv420p[v]` : `[${label}]format=yuv420p[v]`);
  let args: string[];
  if (seg.kind === "photo") {
    const z = seg.motion === "out" ? `1.12-0.12*on/${frames}` : seg.motion === "pan" ? "1.14" : seg.motion === "still" ? "1" : `1+0.12*on/${frames}`;
    const x = seg.motion === "pan" ? `(iw-iw/zoom)*on/${frames}` : "iw/2-(iw/zoom/2)";
    const fc = [
      fitFilter(o, seg.orient, "0:v"),
      `[fit]scale=${o.W * 2}:${o.H * 2},zoompan=z='${z}':x='${x}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${o.W}x${o.H}:fps=${FPS}[zp]`,
      tail("zp")
    ].join(";");
    args = ["-i", seg.file, "-f", "lavfi", "-t", dur, "-i", "anullsrc=r=48000:cl=stereo", "-filter_complex", fc, "-map", "[v]", "-map", "1:a"];
  } else {
    const fc = [`[0:v]fps=${FPS}[in]`, fitFilter(o, seg.orient, "in"), tail("fit")].join(";");
    const useAudio = o.clipAudio && seg.hasAudio;
    args = ["-ss", seg.start.toFixed(3), "-t", dur, "-i", seg.file];
    if (!useAudio) args.push("-f", "lavfi", "-t", dur, "-i", "anullsrc=r=48000:cl=stereo");
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
