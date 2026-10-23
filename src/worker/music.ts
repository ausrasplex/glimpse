// Music tracks: duration, loudness, tempo guess and a normalised AAC copy for mashes and previews.
import { join } from "node:path";
import { rm, stat } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../server/db";
import { downloadTo, putFile, keys } from "../server/storage";
import { getSettings } from "../server/settings";
import { ffmpeg, probe, run, runBuffer } from "./ff";
import { tmpDir } from "./media";
import { estimateBpm } from "../shared/bpm";
import { peaksFrom } from "../shared/peaks";

// Waveform of the whole track, from 8 kHz mono samples of the original (the loudness-matched copy flattens it).
async function measurePeaks(file: string): Promise<number[] | null> {
  try {
    const buf = await runBuffer("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
    const p = peaksFrom(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)));
    return p.length ? p : null;
  } catch { return null; }
}

// Tracks added before waveforms existed get one, once, when the worker starts.
export async function backfillPeaks() {
  const list = await db.select().from(schema.tracks).where(and(eq(schema.tracks.status, "ready"), isNull(schema.tracks.peaks)));
  for (const t of list) {
    const key = t.key || t.playKey;
    if (!key) continue;
    const dir = await tmpDir("peaks-" + t.id);
    try {
      const f = join(dir, "audio" + ((key.match(/\.[a-z0-9]+$/i) || [".m4a"])[0]));
      await downloadTo(key, f);
      const peaks = await measurePeaks(f);
      if (peaks) await db.update(schema.tracks).set({ peaks }).where(eq(schema.tracks.id, t.id));
    } catch (e) { console.error("[peaks]", t.id, (e as Error).message); }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
}

export async function processTrack(trackId: string) {
  const t = await db.query.tracks.findFirst({ where: eq(schema.tracks.id, trackId) });
  if (!t || !t.key) return;
  const s = await getSettings();
  const dir = await tmpDir("track-" + trackId);
  try {
    const src = join(dir, "original" + ((t.key.match(/\.[a-z0-9]+$/i) || [""])[0]));
    await downloadTo(t.key, src);
    const p = await probe(src);
    // Integrated loudness (EBU R128).
    let lufs: number | null = null;
    try {
      const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", src, "-af", "ebur128", "-f", "null", "-"], { timeoutMs: 10 * 60e3 });
      const m = /I:\s+(-?[\d.]+) LUFS/g; let last: RegExpExecArray | null = null, x; while ((x = m.exec(stderr))) last = x;
      if (last) lufs = Math.round(Number(last[1]) * 10) / 10;
    } catch { lufs = null; }
    // Tempo from up to 60s of mono audio, skipping any intro.
    let bpm: number | null = null;
    try {
      const off = p.duration > 90 ? 30 : 0;
      const buf = await runBuffer("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(off), "-t", "60", "-i", src, "-ac", "1", "-ar", "11025", "-f", "s16le", "-"]);
      bpm = estimateBpm(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)), 11025);
    } catch { bpm = null; }
    const play = join(dir, "play.m4a");
    const af = s.loudness ? ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11"] : [];
    await ffmpeg(["-i", src, "-vn", ...af, "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", play]);
    const playKey = keys.trackPlay(trackId);
    await putFile(playKey, play, "audio/mp4");
    const extra = (await stat(play)).size;
    const peaks = await measurePeaks(src);
    await db.update(schema.tracks).set({
      status: "ready", duration: Math.round(p.duration * 10) / 10, lufs: s.loudness ? -14 : lufs, playKey,
      detectedBpm: bpm, bpm: t.bpm || bpm, size: t.size + extra, peaks
    }).where(eq(schema.tracks.id, trackId));
  } catch (e) {
    console.error("[track]", trackId, (e as Error).message);
    await db.update(schema.tracks).set({ status: "failed" }).where(eq(schema.tracks.id, trackId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
