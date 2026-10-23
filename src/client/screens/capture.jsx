import React from "react";
import { useApp, live } from "../store.jsx";
import { resumableUpload, savePending, clearPending, latestPending, uploadState } from "../resumable.js";
import { kindOfFile, ACCEPT, clipMaxOf } from "../../shared/media";
import { filmedDay } from "../filmed.js";
import { Icon } from "../icons.jsx";
import { Screen, TopBar, Steps, ClipView, Thumb, DateSheet, Swatches, Opts, Choice, Redirect } from "../ui.jsx";
import * as S from "../sel.js";
import { todayKey, relDay, dayLabel, fmtSec, GRADS, PALETTE, clamp, uid, hexA } from "../util.js";

const { useState, useEffect, useRef } = React;

// Grab still frames from a local video file, for the filmstrip while the upload runs.
export function grabFrames(url, times, w) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const out = [];
    let i = 0;
    const c = document.createElement("canvas");
    const next = () => {
      if (i >= times.length) { resolve(out); return; }
      try { v.currentTime = Math.min(times[i], Math.max(0, (v.duration || 1) - 0.05)); } catch (e) { resolve(out); }
    };
    v.onloadeddata = () => { const r = (v.videoHeight || 16) / (v.videoWidth || 9); c.width = w || 120; c.height = Math.round((w || 120) * r); next(); };
    v.onseeked = () => {
      try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); out.push(c.toDataURL("image/jpeg", 0.7)); } catch (e) { out.push(null); }
      i++; next();
    };
    v.onerror = () => resolve(out);
    setTimeout(() => resolve(out), 8000);
  });
}

// Frames for the trim strip from the server's 20-frame strip image.
const stripFrames = (url, n) => Array.from({ length: n }, (_, i) => "url(" + url + ") " + (i / (n - 1) * 100).toFixed(3) + "% 0 / " + n * 100 + "% 100% no-repeat");

export const ORIENT_BOX = { portrait: { w: 210, h: 340 }, landscape: { w: 320, h: 180 }, square: { w: 250, h: 250 } };
const orientOf = (w, h) => (!w || !h ? "portrait" : Math.abs(w - h) / Math.max(w, h) < 0.08 ? "square" : w > h ? "landscape" : "portrait");

// Uploads keep running while the person trims. Keyed by the draft's local id.
export const uploads = {};
function startUpload(key, file, type, setDraft, resume) {
  const job = { file, pct: 0, mediaId: null, error: null, uploadId: resume ? resume.uploadId : null };
  const mine = (o) => setDraft((cur) => (cur && cur.liveId === key ? Object.assign({}, cur, o) : cur));
  const up = resumableUpload(file, type, {
    onStart: (st) => {
      job.uploadId = st.uploadId;
      mine({ uploadId: st.uploadId });
      if (!resume) savePending({ uploadId: st.uploadId, mediaId: st.mediaId, file, type, draft: null });
    },
    onProgress: (p) => { job.pct = p; mine({ uploadPct: p }); },
    onWaiting: (w) => mine({ uploadWaiting: w })
  }, resume);
  job.cancel = up.cancel;
  job.promise = up.promise.then((mid) => { job.mediaId = mid; return mid; }).catch((e) => { job.error = e.message; throw e; });
  job.promise.catch(() => {});
  job.promise.then((mid) => mine({ mediaId: mid, uploadPct: 1, uploadWaiting: false }), (e) => mine({ uploadErr: e.message }));
  uploads[key] = job;
  return job;
}
// Stop a draft's upload and forget it (cancelled, or a different file was chosen).
function abandon(d) {
  const job = d && uploads[d.liveId];
  if (job && !job.mediaId && job.cancel) job.cancel();
  const upId = (d && d.uploadId) || (job && job.uploadId);
  if (upId) clearPending(upId);
}

// The day a picked file was filmed: the server's reading once it has one, else the browser's quick guess.
const filmedOf = (db, d) => { const m = d.mediaId ? S.media(db, d.mediaId) : null; return (m && m.takenDay) || d.filmedHint || null; };

// Offers to file the glimpse on the day it was filmed, when that isn't the entry's day. Never changes the date by itself.
const filmedOffer = (db, d) => { const day = filmedOf(db, d); return day && !d.dateChecked && day !== (d.date || todayKey()) && day <= todayKey() ? day : null; };
function FilmedBanner({ d, setDraft, style }) {
  const { db } = useApp();
  const day = filmedOffer(db, d);
  const entry = d.date || todayKey();
  if (!day) return null;
  const set = (o) => setDraft((cur) => Object.assign({}, cur, { dateChecked: true }, o));
  return (
    <div role="status" className="stack gap10" style={{ ...style, padding: 14, borderRadius: 14, background: "radial-gradient(circle at 0% 0%, var(--accent-soft), transparent 70%), var(--surface)", border: "1px solid var(--accent)" }}>
      <span style={{ fontSize: 13.5, lineHeight: 1.4 }}><strong>Filmed on {dayLabel(day)}.</strong> <span className="muted">Save it to that day instead?</span></span>
      <div className="grid2" style={{ gap: 8 }}>
        <button className="chipbtn" style={{ background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)", fontWeight: 700 }} onClick={() => set({ date: day })}>Use {dayLabel(day)}</button>
        <button className="chipbtn" onClick={() => set({})}>Keep {dayLabel(entry)}</button>
      </div>
    </div>
  );
}

// After a reload: offer to carry on with a glimpse whose upload or steps weren't finished. Once per page load.
let offered = false;
export function useResumeOffer() {
  const { draft, setDraft, nav, toast } = useApp();
  useEffect(() => {
    if (offered || draft) return;
    offered = true;
    latestPending().then((rec) => {
      if (!rec) return;
      toast("You have an unfinished glimpse", { label: "Continue", run: () => resumeSaved(rec, setDraft, nav, toast) });
    });
  }, []);
}
async function resumeSaved(rec, setDraft, nav, toast) {
  const d = Object.assign({}, rec.draft, { uploadErr: null, uploadWaiting: false });
  const key = d.liveId || uid("v");
  d.liveId = key;
  if (!d.mediaId && !rec.file) {
    // The file was too big to keep in the browser: only usable if the server already has all of it.
    const st = await uploadState(rec.uploadId);
    if (!st || !st.done) { clearPending(rec.uploadId); toast("That upload can't continue without the file. Choose it again.", null, "warn"); return; }
    d.mediaId = st.mediaId;
  }
  if (d.source === "file" && d.kind === "video") {
    if (rec.file) live.video[key] = URL.createObjectURL(rec.file); else d.source = "server";
  }
  setDraft(d);
  if (!d.mediaId) startUpload(key, rec.file, rec.type, setDraft, { uploadId: rec.uploadId, mediaId: rec.mediaId });
  nav.go("capture");
}

// Server-side steps (upload, Immich copy, playback copy) shown while a file is prepared.
function Preparing({ draft, media }) {
  const up = draft.uploadPct == null ? 1 : draft.uploadPct;
  const proc = media ? (media.status === "READY" ? 1 : (media.progress || 0) / 100) : 0;
  const steps = draft.immichId
    ? [["Copying from Immich", media && media.status !== "UPLOADING" ? 1 : proc], ["Making a playback copy", media && media.status === "PROCESSING" ? proc : media && media.status === "READY" ? 1 : 0]]
    : draft.kind === "photo" ? [["Uploading the photo", up], ["Preparing it for display", up < 1 ? 0 : proc]]
      : [["Uploading the original", up], ["Making a playback copy", up < 1 ? 0 : proc]];
  const failed = (media && media.status === "FAILED") || !!draft.uploadErr;
  return (
    <div className="stack gap20" style={{ padding: "40px 22px" }}>
      <div className="stack gap10" style={{ alignItems: "center", textAlign: "center" }}>
        <span style={{ width: 60, height: 60, borderRadius: "50%", background: failed ? "rgba(224,120,110,0.14)" : "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={failed ? "alert" : draft.immichId ? "image" : "refresh"} size={26} color={failed ? "#F0A49C" : "var(--accent)"} /></span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{failed ? "That file couldn't be used" : "Getting your " + (draft.kind === "photo" ? "photo" : "video") + " ready"}</span>
        <span className="muted ellipsis" style={{ fontSize: 13, maxWidth: 280 }}>{failed ? (draft.uploadErr || media.error) : draft.fileName || ""}</span>
      </div>
      {!failed ? (
        <div className="card flush list">
          {steps.map((st) => {
            const p = Math.max(0, Math.min(1, st[1]));
            return (
              <div key={st[0]} className="stack gap8" style={{ padding: "13px 14px" }}>
                <div className="hrow between"><span style={{ fontSize: 13.5, fontWeight: 600, color: p > 0 ? "var(--fg)" : "var(--faint)" }}>{st[0]}</span><span className="small num" style={{ color: p >= 1 ? "var(--ok)" : "var(--muted)" }}>{p >= 1 ? "Done" : p > 0 ? Math.round(p * 100) + "%" : "Waiting"}</span></div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--line)" }}><div style={{ height: 4, borderRadius: 2, width: p * 100 + "%", background: p >= 1 ? "var(--ok)" : "var(--accent)", transition: "width .3s" }} /></div>
              </div>
            );
          })}
        </div>
      ) : null}
      {draft.uploadWaiting && !draft.uploadErr ? <span className="small" style={{ textAlign: "center", color: "#BDB7AD" }}>Waiting for a connection. The upload continues by itself.</span> : null}
      {!failed && draft.uploadPct != null && draft.uploadPct < 1 ? <span className="small faint" style={{ textAlign: "center" }}>Keep Glimpse open until the upload finishes.</span> : null}
      {!failed && draft.kind !== "photo" ? <span className="small faint" style={{ lineHeight: 1.5, textAlign: "center" }}>This video is in a format some browsers can't play (often iPhone HEVC). Glimpse keeps your original untouched for mashes and makes a small copy that plays anywhere.</span> : null}
    </div>
  );
}

// Shrink a picked photo for an instant preview. Returns null if the browser can't open it (HEIC).
function loadPhoto(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 720, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve({ data: c.toDataURL("image/jpeg", 0.78), w: img.width, h: img.height });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
export const MOTIONS = [{ id: "in", label: "Zoom in" }, { id: "out", label: "Zoom out" }, { id: "pan", label: "Pan" }, { id: "still", label: "Still" }];
export const photoDraft = (o) => Object.assign({ source: "photo", kind: "photo", duration: 10, start: 0, len: 2, motion: "in", orient: "portrait" }, o);

// Take Glimpse opens the camera; Browse files opens the phone's gallery or file picker, limited to videos and photos.
function SourcePicker({ onFile, onPhoto }) {
  const { db, me, nav, toast } = useApp();
  useResumeOffer();
  const cam = useRef(null);
  const ref = useRef(null);
  const im = db.server.immich || {};
  const picked = (f) => {
    const k = kindOfFile(f.name, f.type);
    if (!k) { toast("That isn't a video or photo Glimpse can use.", null, "warn"); return; }
    if (k.kind === "video") onFile(f, k.type); else onPhoto(f, k.type);
  };
  const take = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) picked(f); };
  return (
    <div className="stack gap14" style={{ padding: "26px 20px" }}>
      <div className="stack gap12" style={{ alignItems: "center", textAlign: "center", padding: "34px 20px", borderRadius: 20, border: "1.5px dashed var(--line-strong)" }}>
        <span style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="camera" size={28} color="var(--accent)" /></span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Film a moment</span>
        <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.45, maxWidth: 260 }}>Opens your camera. You'll pick the second you want to keep next.</span>
        <button className="pill" style={{ marginTop: 4 }} onClick={() => cam.current && cam.current.click()}><Icon name="camera" size={15} stroke={2.2} />Take Glimpse</button>
        <input ref={cam} type="file" accept="video/*" capture="environment" hidden onChange={take} />
      </div>
      <div className="stack gap6">
        <button className="btn outline" onClick={() => ref.current && ref.current.click()}><Icon name="image" size={16} />Browse files</button>
        <span className="small faint" style={{ textAlign: "center" }}>Choose a video or photo from your gallery or files.</span>
      </div>
      <input ref={ref} type="file" accept={ACCEPT} hidden onChange={take} />
      {im.on ? <button className="btn outline" onClick={() => { if (!me.immich) { toast("Connect your Immich account in Profile first", { label: "Profile", run: () => nav.go("profile") }); return; } nav.go("immich"); }}><Icon name="image" size={16} />Choose from Immich</button> : null}
    </div>
  );
}

// Filmstrip with a draggable window: grab either end to trim, the middle to slide it.
const MIN_LEN = 0.5;
function TrimStrip({ frames, grad, n, dur, start, len, maxLen, onChange }) {
  const MAX_LEN = maxLen || 10;
  const ref = useRef(null);
  const end = start + len;
  const begin = (mode) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const w = ref.current.getBoundingClientRect().width;
    const x0 = e.clientX, s0 = start, l0 = len;
    const move = (ev) => {
      const dt = (ev.clientX - x0) / w * dur;
      if (mode === "move") onChange({ start: +clamp(s0 + dt, 0, dur - l0).toFixed(1) });
      else if (mode === "start") { const ns = clamp(s0 + dt, Math.max(0, s0 + l0 - MAX_LEN), s0 + l0 - MIN_LEN); onChange({ start: +ns.toFixed(1), len: +(s0 + l0 - ns).toFixed(1) }); }
      else onChange({ len: +clamp(l0 + dt, MIN_LEN, Math.min(MAX_LEN, dur - s0)).toFixed(1) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const key = (mode) => (e) => {
    const step = e.shiftKey ? 1 : 0.1;
    const dir = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    if (!dir) return; e.preventDefault();
    if (mode === "start") { const ns = clamp(start + dir, Math.max(0, end - MAX_LEN), end - MIN_LEN); onChange({ start: +ns.toFixed(1), len: +(end - ns).toFixed(1) }); }
    else onChange({ len: +clamp(len + dir, MIN_LEN, Math.min(MAX_LEN, dur - start)).toFixed(1) });
  };
  const cell = dur / n;
  const handle = (side) => ({ position: "absolute", top: -4, bottom: -4, [side]: -11, width: 22, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "ew-resize", touchAction: "none", zIndex: 2 });
  const grip = <span style={{ width: 12, height: 40, borderRadius: 4, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.45)" }}><span style={{ width: 2, height: 16, borderRadius: 1, background: "var(--accent-ink)", opacity: 0.6 }} /></span>;
  return (
    <div ref={ref} style={{ position: "relative", height: 64, margin: "0 11px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + n + ", minmax(0,1fr))", height: 64, borderRadius: 10, overflow: "hidden" }}>
        {Array.from({ length: n }).map((_, i) => {
          const t0 = i * cell;
          const inSel = t0 + cell > start + 0.001 && t0 < end - 0.001;
          return <button key={i} aria-label={"Jump to " + fmtSec(t0)} onClick={() => onChange({ start: +Math.min(t0, dur - len).toFixed(1) })} style={{ height: 64, border: "none", padding: 0, background: frames[i] || grad, opacity: inSel ? 1 : 0.35 }} />;
        })}
      </div>
      <div onPointerDown={begin("move")} style={{ position: "absolute", top: 0, bottom: 0, left: (start / dur * 100) + "%", width: (len / dur * 100) + "%", border: "3px solid var(--accent)", borderLeftWidth: 0, borderRightWidth: 0, boxSizing: "border-box", cursor: "grab", touchAction: "none" }}>
        <button role="slider" aria-label="Start" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={+start.toFixed(1)} aria-valuetext={fmtSec(start)} onPointerDown={begin("start")} onKeyDown={key("start")} style={handle("left")}>{grip}</button>
        <button role="slider" aria-label="End" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={+end.toFixed(1)} aria-valuetext={fmtSec(end)} onPointerDown={begin("end")} onKeyDown={key("end")} style={handle("right")}>{grip}</button>
      </div>
    </div>
  );
}

export function Trim({ params }) {
  const { db, act, refresh, nav, draft, setDraft, me, toast } = useApp();
  const editing = params.entryId ? S.entry(db, params.entryId) : null;
  const [frames, setFrames] = useState([]);
  const [playing, setPlaying] = useState(true);
  const [scope, setScope] = useState("project");
  const [busy, setBusy] = useState(false);
  const d = draft || {};
  const media = d.mediaId ? S.media(db, d.mediaId) : null;
  const waiting = d.source === "server" && !(media && media.status === "READY" && d.duration);

  // When adjusting an existing entry, start from its clip.
  useEffect(() => {
    if (!editing) return;
    const c = S.clipOf(db, editing);
    setDraft({ source: c.m.kind === "photo" ? "photo" : "server", mediaId: c.m.id, grad: c.m.grad, thumb: c.m.thumb, duration: c.m.duration, start: c.start, len: c.len, editEntryId: editing.id, orient: c.m.orient || "portrait", kind: c.m.kind, motion: c.m.motion });
  }, []);

  // Server-prepared media (converted video, HEIC photo, Immich): pick up its details once it's ready.
  useEffect(() => {
    if (!media || d.source !== "server" || media.status !== "READY" || d.duration) return;
    const dur = media.duration || 10;
    if (media.kind === "photo") setDraft((cur) => Object.assign({}, cur, photoDraft({ mediaId: media.id, thumb: media.thumb, orient: media.orient, grad: media.grad, immichId: cur.immichId, date: cur.date, presetProjectId: cur.presetProjectId, returnTo: cur.returnTo, fileName: cur.fileName })));
    else setDraft((cur) => Object.assign({}, cur, { duration: dur, start: +Math.min(dur * 0.2, Math.max(0, dur - 1)).toFixed(1), len: Math.min(1, dur), orient: media.orient, kind: "video" }));
  }, [media && media.status, d.source]);
  useEffect(() => {
    if (d.source === "server" && d.mediaId && !media) refresh();
  }, [d.mediaId]);

  // Filmstrip: local frames while the upload runs, otherwise the server's strip image.
  useEffect(() => {
    if (!d.source || d.kind === "photo") return;
    if (d.source === "file" && live.video[d.liveId]) {
      const n = 20; const times = []; for (let i = 0; i < n; i++) times.push((i + 0.5) * d.duration / n);
      grabFrames(live.video[d.liveId], times, 60).then((f) => setFrames(f.map((x) => x ? "url(" + x + ") center/cover" : d.grad)));
    } else if (media && media.strip) setFrames(stripFrames(media.strip, 20));
  }, [d.source, d.liveId, media && media.strip]);

  const onFile = (f, type) => {
    abandon(draft);
    const url = URL.createObjectURL(f);
    const key = uid("v");
    live.video[key] = url;
    const base = { date: (draft || {}).date, presetProjectId: (draft || {}).presetProjectId, returnTo: (draft || {}).returnTo };
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.src = url;
    let settled = false;
    const job = startUpload(key, f, type || f.type, setDraft);
    job.promise.then(() => refresh(), () => {});
    let hint = null;
    filmedDay(f, "video").then((day) => { hint = day; if (day) setDraft((cur) => (cur && cur.liveId === key ? Object.assign({}, cur, { filmedHint: day }) : cur)); });
    v.onloadedmetadata = () => {
      if (settled) return; settled = true;
      const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      if (!dur || !v.videoWidth) { v.onerror(); return; }
      setDraft(Object.assign({}, base, { source: "file", liveId: key, kind: "video", grad: GRADS[Math.floor(Math.random() * GRADS.length)], duration: +dur.toFixed(1), start: +Math.min(dur * 0.2, Math.max(0, dur - 1)).toFixed(1), len: Math.min(1, dur), size: f.size, fileName: f.name, orient: orientOf(v.videoWidth, v.videoHeight), uploadPct: job.pct, uploadId: job.uploadId, mediaId: job.mediaId, filmedHint: hint }));
    };
    // The browser can't decode it (often iPhone HEVC): trim once the server has made a playback copy.
    v.onerror = () => {
      settled = true;
      delete live.video[key];
      setDraft(Object.assign({}, base, { source: "server", liveId: key, kind: "video", fileName: f.name, size: f.size, uploadPct: job.pct, uploadId: job.uploadId, mediaId: job.mediaId, filmedHint: hint }));
    };
  };
  const onPhoto = async (f, type) => {
    abandon(draft);
    const key = uid("p");
    const base = { date: (draft || {}).date, presetProjectId: (draft || {}).presetProjectId, returnTo: (draft || {}).returnTo };
    const ph = await loadPhoto(f);
    const job = startUpload(key, f, type || f.type, setDraft);
    job.promise.then(() => refresh(), () => {});
    const up = { uploadPct: job.pct, uploadId: job.uploadId, mediaId: job.mediaId, filmedHint: await filmedDay(f, "photo") };
    if (ph) setDraft(Object.assign({}, base, photoDraft({ liveId: key, grad: GRADS[0], thumb: ph.data, size: f.size, fileName: f.name, orient: orientOf(ph.w, ph.h) }), up));
    else setDraft(Object.assign({}, base, { source: "server", liveId: key, kind: "photo", fileName: f.name, size: f.size }, up));
  };
  const cancel = () => { if (!editing) abandon(d); setDraft(null); nav.back(); };

  if (!d.source && editing) return <Screen />;
  if (waiting) {
    return (
      <Screen>
        <TopBar title={d.kind === "photo" ? "Photo glimpse" : "Pick the moment"} sub="New entry · Step 1 of 3" icon="close" backLabel="Cancel new entry" onBack={cancel} />
        <Steps n={1} of={3} />
        <div className="scroll"><Preparing draft={d} media={media} />{!editing ? <FilmedBanner d={d} setDraft={setDraft} style={{ margin: "0 22px 22px" }} /> : null}</div>
        {media && media.status === "FAILED" || d.uploadErr ? <div style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))" }}><button className="btn outline" onClick={() => { abandon(d); setDraft({ date: d.date, presetProjectId: d.presetProjectId, returnTo: d.returnTo }); }}>Choose something else</button></div> : null}
      </Screen>
    );
  }
  if (!d.source) {
    return (
      <Screen>
        <TopBar title="Pick the moment" sub="New entry · Step 1 of 3" icon="close" backLabel="Cancel new entry" onBack={cancel} />
        <Steps n={1} of={3} />
        <div className="scroll"><SourcePicker onFile={onFile} onPhoto={onPhoto} /></div>
      </Screen>
    );
  }

  const dur = d.duration;
  const start = clamp(d.start, 0, Math.max(0, dur - 0.5));
  const len = clamp(d.len, 0.5, Math.max(0.5, dur - start));
  const end = +(start + len).toFixed(1);
  const set = (o) => setDraft(Object.assign({}, d, o));
  const n = 20;
  const cell = dur / n;
  const isPhoto = d.kind === "photo";
  const m = isPhoto ? { kind: "photo", motion: d.motion, thumb: d.thumb || (media && media.thumb), grad: d.grad }
    : { grad: frames.length ? frames[Math.min(n - 1, Math.floor(start / cell))] : d.grad, liveId: d.source === "file" ? d.liveId : null, src: media ? media.src : null, thumb: null };
  const othersClip = editing && editing.authorId !== me.id;
  const upPct = d.uploadPct == null ? null : d.uploadPct;

  const next = async () => {
    if (editing) {
      setBusy(true);
      try {
        if (isPhoto) { await act("savePhoto", { entryId: editing.id, len: +len.toFixed(1), motion: d.motion }); toast("Photo glimpse updated"); }
        else {
          await act("saveTrim", { entryId: editing.id, start: +start.toFixed(1), end, scope: othersClip ? "project" : scope });
          toast(scope === "project" || othersClip ? "Trim saved for " + S.project(db, editing.projectId).name + " only" : "Trim saved everywhere this clip is used");
        }
        setDraft(null); nav.back();
      } catch (e) { /* toast shown */ } finally { setBusy(false); }
      return;
    }
    let thumb = d.thumb || (media && media.thumb) || null;
    if (d.source === "file" && live.video[d.liveId]) { const f = await grabFrames(live.video[d.liveId], [start + 0.05], 180); thumb = f[0] || thumb; }
    setDraft(Object.assign({}, d, { start: +start.toFixed(1), len: +len.toFixed(1), thumb }));
    nav.go("captureProjects");
  };

  return (
    <Screen>
      <TopBar title={editing ? (isPhoto ? "Photo glimpse" : "Adjust trim") : isPhoto ? "Photo glimpse" : "Pick the moment"} sub={editing ? S.project(db, editing.projectId).name + " · " + relDay(editing.date) : "New entry · Step 1 of 3"} icon={editing ? "back" : "close"} backLabel={editing ? "Back" : "Cancel new entry"} onBack={cancel} />
      {!editing ? <Steps n={1} of={3} /> : null}
      <div className="scroll">
        <div style={{ display: "flex", justifyContent: "center", padding: "20px 0 0" }}>
          <ClipView m={m} start={start} end={end} playing={playing} loop style={{ width: ORIENT_BOX[d.orient || "portrait"].w, height: ORIENT_BOX[d.orient || "portrait"].h, maxWidth: "calc(100vw - 40px)", borderRadius: 18 }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent 45%)", pointerEvents: "none" }} />
            <span className="hrow gap6" style={{ position: "absolute", top: 12, left: 12, padding: "3px 9px", borderRadius: 12, background: "rgba(0,0,0,0.5)", fontSize: 11, fontWeight: 600 }}><Icon name={isPhoto ? "image" : "repeat"} size={11} />{isPhoto ? "Photo · plays as a clip" : "Looping selection"}</span>
            <button aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 52, height: 52, borderRadius: "50%", background: "rgba(0,0,0,0.4)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#F2EFE9", opacity: playing ? 0.35 : 1 }}><Icon name={playing ? "pause" : "play"} size={20} /></button>
            <span className="hrow between num" style={{ position: "absolute", left: 12, right: 12, bottom: 12, fontSize: 12, fontWeight: 700 }}><span>{isPhoto ? "" : fmtSec(start)}</span><span style={{ color: "var(--accent)" }}>{len.toFixed(1)}s</span></span>
          </ClipView>
        </div>
        {!editing && (upPct !== null && upPct < 1 || d.uploadErr || d.immichId || (media && media.converted)) ? (
          <div className="hrow wrap gap6" style={{ justifyContent: "center", marginTop: 12, padding: "0 20px" }}>
            {upPct !== null && upPct < 1 && !d.uploadErr ? <span className="tag" style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "#BDB7AD" }}>{d.uploadWaiting ? "Upload paused · waiting for a connection" : "Uploading · " + Math.round(upPct * 100) + "% · keep Glimpse open"}</span> : null}
            {d.uploadErr ? <span className="tag" style={{ background: "rgba(224,120,110,0.12)", border: "1px solid rgba(224,120,110,0.4)", color: "#F0A49C" }}>Upload failed · {d.uploadErr}</span> : null}
            {d.immichId ? <span className="tag" style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "#BDB7AD" }}>From Immich{d.date ? " · " + relDay(d.date) : ""}</span> : null}
            {media && media.converted && !isPhoto ? <span className="tag" style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "#BDB7AD" }}>Playback copy · {media.converted} original kept for mashes</span> : null}
          </div>
        ) : null}
        {!editing && filmedOf(db, d) ? <span className="small faint" style={{ display: "block", textAlign: "center", marginTop: 10 }}>Filmed {dayLabel(filmedOf(db, d))}</span> : null}
        {!editing ? <FilmedBanner d={d} setDraft={setDraft} style={{ margin: "14px 20px 0" }} /> : null}
        {isPhoto ? (
          <div className="pad stack gap20" style={{ paddingTop: 22 }}>
            <div className="stack gap8"><span className="sec">Length</span><Opts value={+len.toFixed(1)} onChange={(l) => set({ len: l, start: 0 })} options={[1, 2, 3, 5].map((l) => ({ id: l, label: l + "s" }))} /></div>
            <div className="stack gap8"><span className="sec">Movement</span><Opts value={d.motion || "in"} onChange={(v) => set({ motion: v })} options={MOTIONS} /></div>
            <span className="small faint" style={{ lineHeight: 1.45 }}>No video that day? A photo plays as a short clip with gentle movement, so the day still counts toward your streak. In a beat-synced mash, photos stretch to land on the beat.</span>
          </div>
        ) : (
          <div className="pad" style={{ paddingTop: 22 }}>
            <div className="hrow between" style={{ alignItems: "baseline", marginBottom: 10 }}><span className="sec">Drag the ends to trim</span><span className="small muted num">{fmtSec(start)} – {fmtSec(end)} · of {fmtSec(dur)}</span></div>
            <TrimStrip frames={frames} grad={d.grad} n={n} dur={dur} start={start} len={len} maxLen={clipMaxOf(db.server.clipLimit)} onChange={(o) => setDraft((cur) => Object.assign({}, cur, o))} />
            <div className="stack gap8" style={{ marginTop: 16 }}>
              <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Quick length</span><span className="small faint">Keeps your start, moves the end</span></div>
              <Opts value={[1, 2, 3, 5].indexOf(+len.toFixed(1)) >= 0 ? +len.toFixed(1) : null} onChange={(l) => set({ len: Math.min(l, dur), start: Math.min(start, Math.max(0, dur - l)) })} options={[1, 2, 3, 5].map((l) => ({ id: l, label: l + "s", disabled: l > dur }))} />
            </div>
            <span className="small faint" style={{ display: "block", marginTop: 10, lineHeight: 1.4 }}>Drag the start handle to your moment, tap a length, then fine-tune either end if you like. Drag the middle to move the whole selection.</span>
          </div>
        )}
        <div className="pad stack gap10" style={{ paddingTop: 20 }}>
          {isPhoto ? null : editing && !othersClip ? (
            <div className="stack gap8" style={{ marginTop: 6 }}>
              <span className="sec">Apply to</span>
              <Choice active={scope === "project"} onClick={() => setScope("project")} title={"Only " + S.project(db, editing.projectId).name} desc="Other projects keep the clip's own trim" />
              <Choice active={scope === "all"} onClick={() => setScope("all")} title="Everywhere this clip is used" desc="Changes the clip's own trim" />
            </div>
          ) : editing ? <span className="small faint" style={{ lineHeight: 1.4 }}>As the project owner you can trim {S.firstName(S.user(db, editing.authorId))}'s clip for this project only. Their original isn't touched.</span>
            : <span className="small faint" style={{ lineHeight: 1.4 }}>This is the section used in every project unless a project overrides it.</span>}
        </div>
        <div style={{ height: 18 }} />
      </div>
      <div style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <button className="btn" disabled={busy} onClick={next}>{editing ? "Save" : "Next: choose projects"}</button>
        {!editing ? <button className="btn danger-ghost" style={{ marginTop: 4, padding: 10, fontSize: 13 }} onClick={() => { abandon(d); setDraft({ date: d.date, presetProjectId: d.presetProjectId, returnTo: d.returnTo }); }}>{isPhoto ? "Choose something else" : "Choose a different video"}</button> : null}
      </div>
    </Screen>
  );
}

export function PickProjects() {
  const { db, nav, draft, setDraft, me } = useApp();
  const d = draft || {};
  const [dateOpen, setDateOpen] = useState(false);
  const projects = S.sortProjects(S.myProjects(db, me.id));
  // Nothing chosen yet: start from the preset project, or the only project there is.
  const picked = d.projectIds || (d.presetProjectId ? [d.presetProjectId] : projects.length === 1 ? [projects[0].p.id] : []);
  const set = (o) => setDraft(Object.assign({}, d, o));
  const toggle = (id) => set({ projectIds: picked.indexOf(id) >= 0 ? picked.filter((x) => x !== id) : picked.concat([id]) });
  if (!d.source) return <Redirect to="capture" />;
  const date = d.date || todayKey();
  const m = { grad: d.grad, thumb: d.thumb };
  return (
    <Screen>
      <TopBar title="Add to projects" sub="New entry · Step 2 of 3" backLabel="Back to trim" onBack={() => { set({ projectIds: picked }); nav.back(); }} />
      <Steps n={2} of={3} />
      <div className="scroll pad">
        <div className="hrow gap14" style={{ marginTop: 20, padding: 12, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--line)" }}>
          <Thumb m={m} style={{ width: 58, height: 80 }}><span style={{ position: "absolute", left: 5, bottom: 5, padding: "1px 5px", borderRadius: 5, background: "rgba(0,0,0,0.5)", fontSize: 9.5, fontWeight: 700 }}>{d.len.toFixed(1)}s</span></Thumb>
          <div className="stack gap4" style={{ flex: 1, minWidth: 0 }}>
            <span className="small muted">Entry date</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{date === todayKey() ? "Today · " + dayLabel(date) : relDay(date)}</span>
            <span className="small faint num">{d.kind === "photo" ? "Photo · " + d.len + "s · " + (MOTIONS.find((x) => x.id === d.motion) || MOTIONS[0]).label.toLowerCase() : fmtSec(d.start) + " – " + fmtSec(d.start + d.len) + " of a " + Math.round(d.duration) + "s clip"}</span>
          </div>
          <button className="chipbtn" onClick={() => setDateOpen(true)}>Change</button>
        </div>
        <FilmedBanner d={d} setDraft={setDraft} style={{ marginTop: 14 }} />
        <div className="hrow between" style={{ alignItems: "baseline", marginTop: 22, marginBottom: 10 }}>
          <span className="sec">Pick one or more</span>
          <span className="small" style={{ color: picked.length ? "var(--accent)" : "var(--faint)", fontWeight: 600 }}>{picked.length ? picked.length + " selected" : "None selected"}</span>
        </div>
        <div className="grid2">
          {projects.map((x) => {
            const on = picked.indexOf(x.p.id) >= 0;
            return (
              <button key={x.p.id} onClick={() => toggle(x.p.id)} aria-pressed={on} style={{ position: "relative", height: 150, borderRadius: 16, overflow: "hidden", padding: 0, border: "2.5px solid " + (on ? "var(--accent)" : "transparent"), background: x.cover ? (x.cover.thumb ? "url(" + x.cover.thumb + ") center/cover" : x.cover.grad) : "var(--surface)", color: "var(--fg)", textAlign: "left" }}>
                <span className="shade" style={{ opacity: on ? 1 : 0.85 }} />
                <span className={"check" + (on ? " on" : "")} style={{ position: "absolute", top: 10, right: 10 }}>{on ? <Icon name="check" size={13} stroke={3} color="var(--accent-ink)" /> : null}</span>
                {x.shared ? <span className="tag" style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,0.5)", color: "var(--fg)" }}>Shared · {x.members.length}</span> : null}
                <span className="stack gap4" style={{ position: "absolute", left: 12, right: 12, bottom: 12 }}>
                  <span className="ellipsis" style={{ fontSize: 14.5, fontWeight: 700 }}>{x.p.name}</span>
                  <span className="hrow gap6" style={{ fontSize: 11, color: "var(--fg-2)" }}><span className="dot" style={{ background: x.cat.color }} />{x.cat.name}</span>
                </span>
              </button>
            );
          })}
          <button onClick={() => { set({ projectIds: picked }); nav.go("projectEdit", { back: 1 }); }} className="stack gap8" style={{ height: 150, borderRadius: 16, border: "1.5px dashed var(--line-strong)", background: "none", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13, fontWeight: 600 }}><span className="plus"><Icon name="plus" size={16} stroke={2.3} color="var(--muted)" /></span>New project</button>
        </div>
        {!projects.length ? <p className="small faint" style={{ lineHeight: 1.45 }}>You don't have a project yet. Create one to file this glimpse in. You'll come straight back here.</p> : null}
        {picked.length > 1 ? <p className="small faint" style={{ lineHeight: 1.45 }}>One upload, shared by all {picked.length}. It's stored once to save space.</p> : null}
        <div style={{ height: 18 }} />
      </div>
      <div style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <button className="btn" disabled={!picked.length} onClick={() => { set({ projectIds: picked, date }); nav.go("captureNote"); }}>{picked.length ? "Next: note & mood" : "Pick at least one project"}</button>
      </div>
      <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} value={date} onPick={(k) => set({ date: k, projectIds: picked })} note="Filming something you missed? File it on the day it happened." />
    </Screen>
  );
}

// Mood picker shared by new entries and edits. Typed moods get an unused colour automatically.
export function MoodPicker({ ownerId, mood, onMood, custom, onCustom, customColor, onCustomColor }) {
  const { db } = useApp();
  const list = (db.moods[ownerId] || []).filter((m) => !m.hidden);
  const all = db.moods[ownerId] || [];
  const c = (custom || "").trim();
  const existing = c && all.find((m) => m.label.toLowerCase() === c.toLowerCase());
  let hash = 0; for (let i = 0; i < c.length; i++) hash = (hash * 31 + c.toLowerCase().charCodeAt(i)) % 9973;
  const used = all.map((m) => m.color);
  const free = PALETTE.filter((p) => used.indexOf(p.color) < 0);
  const pool = free.length ? free : PALETTE;
  const auto = pool[hash % pool.length].color;
  const color = existing ? existing.color : customColor || auto;
  return (
    <div className="stack gap10">
      <span className="sec">Mood</span>
      <div className="hrow wrap gap8">
        {list.map((m) => {
          const on = !c && mood === m.label;
          return <button key={m.label} className={"mood" + (on ? " on" : "")} aria-pressed={on} onClick={() => { onCustom(""); onMood(on ? null : m.label); }}><span className="dot" style={{ width: 9, height: 9, background: m.color }} />{m.label}</button>;
        })}
      </div>
      <div className="hrow gap10" style={{ padding: "11px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}>
        <Icon name="edit" size={15} color="var(--faint)" />
        <input aria-label="Your own mood" placeholder="Or type your own…" maxLength={20} value={custom || ""} onChange={(e) => { onCustom(e.target.value); onCustomColor(null); }} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 14 }} />
        {c ? <span className="dot" style={{ width: 12, height: 12, background: color }} /> : null}
      </div>
      {c && !existing ? (
        <div className="stack gap10" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line-soft)" }}>
          <span className="small muted">Colour for “{c}”</span>
          <Swatches value={color} onPick={onCustomColor} />
          <span className="small faint">{customColor ? "Your colour" : "Picked automatically from colours you're not using. Tap another to change"} · saved to your moods for next time</span>
        </div>
      ) : c && existing ? <span className="small faint">Already in your moods.</span> : null}
    </div>
  );
}
export function resolveMood(db, ownerId, mood, custom, customColor) {
  const c = (custom || "").trim();
  if (!c) return { mood: mood || null, newColor: null };
  const all = db.moods[ownerId] || [];
  const existing = all.find((m) => m.label.toLowerCase() === c.toLowerCase());
  if (existing) return { mood: existing.label, newColor: null };
  let hash = 0; for (let i = 0; i < c.length; i++) hash = (hash * 31 + c.toLowerCase().charCodeAt(i)) % 9973;
  const used = all.map((m) => m.color);
  const free = PALETTE.filter((p) => used.indexOf(p.color) < 0);
  const pool = free.length ? free : PALETTE;
  return { mood: c, newColor: customColor || pool[hash % pool.length].color };
}

export function NoteMood() {
  const { db, act, nav, draft, setDraft, me, toast } = useApp();
  const d = draft || {};
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(d.note || "");
  const [mood, setMood] = useState(d.mood || null);
  const [custom, setCustom] = useState("");
  const [customColor, setCustomColor] = useState(null);
  if (!d.source || !d.projectIds) return <Redirect to="capture" />;
  const names = d.projectIds.map((id) => S.project(db, id));
  const save = async () => {
    if (saving) return;
    const r = resolveMood(db, me.id, mood, custom, customColor);
    setSaving(true);
    let mid = d.mediaId;
    try {
      if (!mid) {
        const job = uploads[d.liveId];
        if (!job) throw new Error("The upload was lost. Choose the video again.");
        mid = await job.promise;
      }
      await act("saveCapture", { mediaId: mid, start: d.start, len: d.len, motion: d.motion || null, projectIds: d.projectIds, date: d.date || todayKey(), note, mood: r.mood, newMoodColor: r.newColor || null });
    } catch (e) { setSaving(false); if (!e.status) toast(e.message, null, "warn"); return; }
    if (d.uploadId) clearPending(d.uploadId);
    toast("Saved to " + names[0].name + (names.length > 1 ? " + " + (names.length - 1) + " more" : "") + (d.date !== todayKey() ? " · " + relDay(d.date) : ""));
    const back = d.returnTo;
    setDraft(null);
    if (back) nav.backTo(back); else nav.reset("home");
  };
  return (
    <Screen>
      <TopBar title="Note & mood" sub="New entry · Step 3 of 3 · both optional" backLabel="Back to projects" onBack={() => { setDraft(Object.assign({}, d, { note, mood })); nav.back(); }} />
      <Steps n={3} of={3} />
      <div className="scroll pad stack gap20" style={{ paddingTop: 20 }}>
        <FilmedBanner d={d} setDraft={setDraft} />
        <div className="hrow gap14" style={{ alignItems: "stretch" }}>
          <ClipView muted m={{ grad: d.grad, thumb: d.thumb, liveId: d.source === "file" ? d.liveId : null, src: d.mediaId && S.media(db, d.mediaId) ? S.media(db, d.mediaId).src : null, kind: d.kind, motion: d.motion }} start={d.start} end={d.start + d.len} playing loop style={{ width: 110, height: 150, borderRadius: 14 }} />
          <div className="stack gap8" style={{ flex: 1, minWidth: 0 }}>
            <span className="small muted">{dayLabel(d.date || todayKey())} · {d.len.toFixed(1)}s</span>
            <span className="sec" style={{ fontSize: 10.5 }}>Adding to</span>
            <div className="hrow wrap gap6">
              {names.map((p) => { const x = S.myProjects(db, me.id).find((y) => y.p.id === p.id); const col = x ? x.cat.color : "#5BA3A0"; return <span key={p.id} className="tag" style={{ background: hexA(col, 0.15), color: col, fontSize: 11.5, padding: "4px 9px" }}><span className="dot" style={{ width: 6, height: 6, background: col }} />{p.name}</span>; })}
            </div>
            {names.length > 1 ? <span className="small faint" style={{ lineHeight: 1.4 }}>One upload, shared by all. The note and mood are copied to each.</span> : null}
          </div>
        </div>
        <div className="stack gap8">
          <div className="hrow between" style={{ alignItems: "baseline" }}><label className="sec" htmlFor="en-note">Note</label><span className="tiny" style={{ color: "var(--ghost)" }}>{note.length}/280</span></div>
          <textarea id="en-note" className="input" rows="3" maxLength={280} placeholder="What happened today?" value={note} onChange={(e) => setNote(e.target.value)} style={{ fontSize: 16 }} />
        </div>
        <MoodPicker ownerId={me.id} mood={mood} onMood={setMood} custom={custom} onCustom={setCustom} customColor={customColor} onCustomColor={setCustomColor} />
        <div style={{ height: 8 }} />
      </div>
      <div className="stack gap8" style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <button className="btn" disabled={saving} onClick={save}><Icon name="check" size={16} stroke={2.8} />{saving ? (d.mediaId || d.uploadPct == null ? "Saving…" : "Finishing upload · " + Math.round((d.uploadPct || 0) * 100) + "%") : "Save entry"}</button>
        <span className="small faint" style={{ textAlign: "center" }}>Uploads in the background. You can leave this screen.</span>
      </div>
    </Screen>
  );
}
