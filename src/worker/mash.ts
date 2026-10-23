// Turns a queued mash into a video: fetch sources, render segments, join, add music, upload.
import { join } from "node:path";
import { rm, stat } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../server/db";
import { downloadTo, putFile, keys, deleteKeys } from "../server/storage";
import { getSettings } from "../server/settings";
import { notify } from "../server/core";
import { QUALITY, qualityOf, OUTPUT, STAMP_DEFAULT, segmentLen, extendWindow, type MashSettings } from "../shared/mash";
import { ffmpeg, probe, boldFont } from "./ff";
import { tmpDir } from "./media";
import { renderSegment, concatSegments, buildBed, mixFinal, type Segment, type BedTrack } from "./render";

const setMash = (id: string, o: Partial<typeof schema.mashes.$inferInsert>) => db.update(schema.mashes).set(o).where(eq(schema.mashes.id, id));

export async function renderMash(mashId: string) {
  const m = await db.query.mashes.findFirst({ where: eq(schema.mashes.id, mashId) });
  if (!m || m.status === "ready") return;
  const s = await getSettings();
  const st = { shape: "portrait", fill: "blur", clipMode: "trimmed", cap: 1, stamp: STAMP_DEFAULT, tracks: [], crossfade: 2, whenEnds: "loop", audio: "both", level: 40, sync: "off", beats: 1, stretch: true, musicLabel: true, ...(m.settings as Partial<MashSettings>) } as MashSettings;
  const q = QUALITY[qualityOf(st.quality)];
  const dir = await tmpDir("mash-" + mashId);
  try {
    await setMash(mashId, { status: "rendering", progress: 1, error: null });
    const ids = (m.entryIds as string[]) || [];
    const es = ids.length ? await db.select().from(schema.entries).where(inArray(schema.entries.id, ids)) : [];
    const ordered = ids.map((id) => es.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e);
    const mids = [...new Set(ordered.map((e) => e.mediaId))];
    const ms = mids.length ? await db.select().from(schema.media).where(inArray(schema.media.id, mids)) : [];
    const usable = ordered.filter((e) => ms.find((x) => x.id === e.mediaId && x.status === "READY"));
    if (!usable.length) throw new Error("None of the clips in this mash are ready yet.");

    const trackRows = st.tracks.length ? await db.select().from(schema.tracks).where(inArray(schema.tracks.id, st.tracks.map((t) => t.trackId))) : [];
    const tracks = st.tracks.map((t) => ({ ref: t, row: trackRows.find((r) => r.id === t.trackId && r.status === "ready") })).filter((x) => !!x.row);
    const musicOn = st.audio !== "clips" && tracks.length > 0;
    const bpm = tracks[0]?.row?.bpm || null;
    const effective: MashSettings = { ...st, tracks: tracks.map((t) => t.ref) };

    const res = OUTPUT[s.maxRes] || OUTPUT["1080"];
    const [W, H] = res[st.shape] || res.portrait;
    const font = await boldFont();

    // Fetch each source once (originals render best).
    const local: Record<string, { file: string; hasAudio: boolean; duration: number }> = {};
    for (const md of ms) {
      if (!usable.find((e) => e.mediaId === md.id)) continue;
      const key = md.kind === "photo" ? md.posterKey : md.originalKey;
      if (!key) continue;
      const f = join(dir, md.id + (md.kind === "photo" ? ".jpg" : (key.match(/\.[a-z0-9]+$/i) || [".mp4"])[0]));
      await downloadTo(key, f);
      let hasAudio = false, duration = md.duration;
      if (md.kind === "video") { const p = await probe(f); hasAudio = p.hasAudio; duration = p.duration || md.duration; }
      local[md.id] = { file: f, hasAudio, duration };
    }
    await setMash(mashId, { progress: 8 });

    // Track timeline, for the song title shown during each track.
    const titles: { from: number; to: number; title: string }[] = [];
    let tcur = 0;
    for (const t of tracks) { const len = Math.max(1, (t.row!.duration || 0) - t.ref.start); titles.push({ from: tcur, to: tcur + len, title: t.row!.title }); tcur += len - st.crossfade; }

    const segs: Segment[] = [];
    let at = 0;
    for (const e of usable) {
      const md = ms.find((x) => x.id === e.mediaId)!;
      const src = local[md.id];
      if (!src) continue;
      const start = e.trimStart ?? md.clipStart, end = e.trimEnd ?? md.clipEnd;
      const len = Math.max(0.2, end - start);
      const photo = md.kind === "photo";
      const target = segmentLen({ len, start, end, duration: src.duration, photo }, effective, bpm);
      const win = photo ? { start: 0, len: target } : extendWindow(start, len, target, src.duration);
      const cur = musicOn && st.musicLabel !== false ? titles.find((x) => at >= x.from && at < x.to) || (st.whenEnds === "loop" ? titles[0] : null) : null;
      segs.push({ kind: photo ? "photo" : "video", file: src.file, start: win.start, len: Math.max(0.2, Math.min(win.len, target)), orient: md.orient as Segment["orient"], hasAudio: src.hasAudio, motion: md.motion, date: e.date, note: e.note, musicTitle: cur ? cur.title : null });
      at += target;
    }

    const opts = { W, H, shape: st.shape, fill: st.fill, stamp: { ...STAMP_DEFAULT, ...(st.stamp || {}) }, clipAudio: st.audio !== "music", font, crf: q.crf };
    const files: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      const f = join(dir, `seg${String(i).padStart(4, "0")}.mov`);
      await renderSegment(opts, segs[i], i, dir, f);
      files.push(f);
      if (i % 5 === 4 && !(await db.query.mashes.findFirst({ where: eq(schema.mashes.id, mashId), columns: { id: true } }))) { console.log("[mash]", mashId, "cancelled"); return; }
      await setMash(mashId, { progress: Math.round(8 + (i + 1) / segs.length * 80) });
    }
    const joined = join(dir, "joined.mov");
    await concatSegments(files, dir, joined);
    const total = segs.reduce((a, x) => a + Math.round(x.len * 30) / 30, 0);
    let bed: string | null = null;
    if (musicOn) {
      const bt: BedTrack[] = [];
      for (const t of tracks) {
        const f = join(dir, t.row!.id + ".m4a");
        await downloadTo(t.row!.playKey || t.row!.key!, f);
        bt.push({ file: f, start: t.ref.start || 0, fadeIn: t.ref.fadeIn || 0, fadeOut: t.ref.fadeOut || 0, duration: t.row!.duration });
      }
      bed = await buildBed(bt, total, st.crossfade, st.whenEnds, dir);
    }
    await setMash(mashId, { progress: 93 });
    const out = join(dir, "mash.mp4");
    await mixFinal(joined, bed, st.audio, st.level, q.audioKbps, out);
    const poster = join(dir, "poster.jpg");
    await ffmpeg(["-ss", Math.min(0.5, total / 2).toFixed(2), "-i", out, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", poster]);
    const ok = keys.mash(mashId), pk = keys.mashPoster(mashId);
    await putFile(ok, out, "video/mp4");
    await putFile(pk, poster, "image/jpeg");
    const size = (await stat(out)).size + (await stat(poster)).size;
    // The mash may have been deleted while rendering.
    const still = await db.query.mashes.findFirst({ where: eq(schema.mashes.id, mashId) });
    if (!still) { await deleteKeys([ok, pk]); return; }
    await setMash(mashId, { status: "ready", progress: 100, outputKey: ok, posterKey: pk, size, duration: Math.round(total * 10) / 10, finishedAt: new Date() });
    await notify(db, m.ownerId, { type: "MASH_READY", title: `${m.title} is ready`, body: (m.projectName ? m.projectName + " · " : "") + segs.length + " clips", link: { route: "player", params: { mashId } } });
  } catch (e) {
    if (!(await db.query.mashes.findFirst({ where: eq(schema.mashes.id, mashId), columns: { id: true } }))) return;
    console.error("[mash]", mashId, (e as Error).message);
    await setMash(mashId, { status: "failed", error: (e as Error).message.slice(0, 400) });
    await notify(db, m.ownerId, { type: "INFO", title: `“${m.title}” couldn't be rendered`, body: "Try again from Mash. If it keeps failing, ask the admin to check the container log.", link: { route: "player", params: { mashId } } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
