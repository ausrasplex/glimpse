import React from "react";
import { useApp, live, upload } from "../store.jsx";
import { Icon } from "../icons.jsx";
import { Screen, TopBar, Sheet, Menu, Confirm } from "../ui.jsx";
import * as S from "../sel.js";
import { fmtDur, shortDate, uid } from "../util.js";

const { useState, useEffect, useRef } = React;

function wave(n, seed) { const out = []; for (let i = 0; i < n; i++) out.push(Math.min(1, 0.25 + 0.4 * Math.abs(Math.sin(i * 0.37 + seed)) + 0.3 * Math.abs(Math.sin(i * 1.13 + seed * 2.1)))); return out; }

// Plays a real uploaded file, or pretends for the sample library.
function usePreview() {
  const [playing, setPlaying] = useState(null);
  const [pos, setPos] = useState(0);
  const audio = useRef(null);
  useEffect(() => {
    if (!playing) return;
    const start = Date.now();
    const id = setInterval(() => setPos((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [playing]);
  useEffect(() => () => { if (audio.current) audio.current.pause(); }, []);
  const toggle = (t) => {
    if (audio.current) { audio.current.pause(); audio.current = null; }
    if (playing === t.id) { setPlaying(null); return; }
    setPos(0); setPlaying(t.id);
    const url = (t.liveId && live.audio[t.liveId]) || t.src;
    if (url) { const a = new Audio(url); audio.current = a; const p = a.play(); if (p && p.catch) p.catch(() => {}); a.onended = () => setPlaying(null); }
  };
  return { playing, pos, toggle };
}

function Wave({ t, playing, pos, n, height }) {
  const bars = wave(n || 48, t.bpm / 10 + t.title.length);
  const prog = playing ? Math.min(1, pos / Math.min(30, t.duration)) : 0;
  return (
    <div className="hrow" style={{ gap: 2, height: height || 26 }} aria-hidden="true">
      {bars.map((v, i) => <div key={i} style={{ flex: 1, height: Math.round(v * 100) + "%", borderRadius: 1, background: t.status !== "ready" ? "#2A2825" : playing && i / bars.length < prog ? "var(--accent)" : playing ? "#4A4742" : "var(--line-strong)" }} />)}
    </div>
  );
}

export function MusicLibrary() {
  const { db, act, refresh, nav, me, toast } = useApp();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  const [menu, setMenu] = useState(null);
  const [removal, setRemoval] = useState(null);
  const [reason, setReason] = useState("");
  const [del, setDel] = useState(null);
  const { playing, pos, toggle } = usePreview();
  const admin = S.isAdmin(db, me.id);
  const canUpload = admin || db.server.musicUploads;
  const list = db.tracks.filter((t) => !q || (t.title + " " + t.artist).toLowerCase().indexOf(q.toLowerCase()) >= 0).sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : sort === "bpm" ? a.bpm - b.bpm : sort === "length" ? a.duration - b.duration : b.addedAt - a.addedAt);
  const usedIn = (id) => db.mashes.filter((m) => m.tracks.some((x) => x.trackId === id)).length;
  const openReq = (id) => db.removalRequests.find((r) => r.trackId === id && r.status === "open");
  return (
    <Screen>
      <TopBar title="Music" sub="Shared with everyone on this server" right={canUpload ? <button className="pill" style={{ padding: "9px 14px", fontSize: 13 }} onClick={() => nav.go("musicUpload")}><Icon name="upload" size={14} stroke={2.4} />Upload</button> : null} />
      <div className="pad stack gap10" style={{ paddingTop: 16, flexShrink: 0 }}>
        <div className="hrow gap10" style={{ padding: "11px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}><Icon name="search" size={16} color="var(--faint)" /><input aria-label="Search music" placeholder="Search title or artist" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 14 }} /></div>
        <div className="hrow gap6"><span className="small faint" style={{ marginRight: 2 }}>Sort</span>{[["recent", "Recent"], ["name", "Name"], ["bpm", "BPM"], ["length", "Length"]].map((o) => <button key={o[0]} onClick={() => setSort(o[0])} aria-pressed={sort === o[0]} style={{ padding: "6px 11px", borderRadius: 14, background: sort === o[0] ? "var(--accent-soft)" : "var(--surface)", border: "1px solid " + (sort === o[0] ? "var(--accent)" : "var(--line)"), color: sort === o[0] ? "var(--fg)" : "var(--muted)", fontSize: 12, fontWeight: 600 }}>{o[1]}</button>)}</div>
      </div>
      <div className="scroll pad stack gap8" style={{ paddingTop: 16 }}>
        {list.map((t) => {
          const ready = t.status === "ready";
          const pl = playing === t.id;
          const open = menu === t.id;
          const mine = t.addedBy === me.id;
          const by = S.user(db, t.addedBy);
          const req = openReq(t.id);
          return (
            <div key={t.id} style={{ padding: 12, borderRadius: 14, background: "var(--surface)", border: "1px solid " + (pl || open ? "var(--accent)" : "var(--line)") }}>
              <div className="hrow gap12">
                {ready ? <button onClick={() => toggle(t)} aria-label={(pl ? "Pause " : "Preview ") + t.title} style={{ width: 38, height: 38, flexShrink: 0, borderRadius: "50%", background: pl ? "var(--accent)" : "#2A2825", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: pl ? "var(--accent-ink)" : "var(--fg)" }}><Icon name={pl ? "pause" : "play"} size={14} /></button>
                  : <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: "50%", background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="refresh" size={15} color="var(--muted)" /></span>}
                <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
                  <span className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{t.title}</span>
                  <span className="small muted ellipsis">{ready ? t.artist + " · " + fmtDur(t.duration) : "Analysing tempo and loudness…"}</span>
                  {ready ? <span className="tiny faint ellipsis">Added by {mine ? "You" : by ? S.firstName(by) : "someone"}{req ? " · removal requested" : ""}</span> : null}
                </span>
                {ready ? <span className="tag" style={{ color: "var(--accent)", fontSize: 11 }}>{t.bpm} BPM</span> : null}
                <button className="iconbtn plain sq" style={{ width: 30, height: 30, background: open ? "#2A2825" : "transparent" }} aria-label={"More options for " + t.title} onClick={() => setMenu(open ? null : t.id)}><Icon name="more" size={16} color="var(--muted)" /></button>
              </div>
              <div style={{ marginTop: 10 }}><Wave t={t} playing={pl} pos={pos} /></div>
              {open ? (
                <div style={{ marginTop: 10 }}>
                  <Menu items={[
                    mine || admin ? { label: "Edit details & BPM", icon: "edit", onClick: () => { setMenu(null); nav.go("trackEdit", { trackId: t.id }); } } : null,
                    !mine && !admin ? { label: "Only " + (by ? S.firstName(by) : "the uploader") + " or the admin can edit this track", disabled: true } : null,
                    admin ? { label: "Delete track", icon: "trash", danger: true, onClick: () => { setMenu(null); setDel(t.id); } } : { label: req ? "Removal already requested" : "Request removal", icon: "trash", danger: !req, disabled: !!req, onClick: () => { setMenu(null); setReason(""); setRemoval(t.id); } }
                  ]} />
                </div>
              ) : null}
            </div>
          );
        })}
        {!list.length ? <div className="small faint" style={{ padding: "30px 0", textAlign: "center" }}>{q ? "No tracks match “" + q + "”" : "No music yet. Upload a track to get started."}</div> : null}
        <div className="small" style={{ padding: "10px 0 22px", textAlign: "center", color: "var(--ghost)" }}>Only the admin can delete tracks. Anyone can request a removal.</div>
      </div>
      <Sheet open={!!removal} onClose={() => setRemoval(null)} title="Request removal">
        <div className="stack gap14">
          <span className="small muted" style={{ marginTop: -6 }}>“{removal ? S.track(db, removal).title : ""}” stays available until the admin approves.</span>
          <div className="field"><label className="sec" htmlFor="rm-reason">Reason (optional)</label><textarea id="rm-reason" className="input" rows="3" placeholder="e.g. Wrong song uploaded" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="grid2"><button className="btn sm ghost" onClick={() => setRemoval(null)}>Cancel</button><button className="btn sm" onClick={() => {
            const t = S.track(db, removal);
            act("requestTrackRemoval", { trackId: removal, reason: reason.trim() }).then(() => toast("Removal request sent to the admin")).catch(() => {});
            setRemoval(null);
          }}>Send request</button></div>
        </div>
      </Sheet>
      <Confirm open={!!del} onClose={() => setDel(null)} title={del ? "Delete “" + S.track(db, del).title + "”?" : ""} body={del ? "Used in " + usedIn(del) + (usedIn(del) === 1 ? " mash" : " mashes") + ". Mashes already rendered keep their audio; it just won't be offered for new ones." : ""} confirm="Delete track" danger onConfirm={() => { const t = S.track(db, del); setDel(null); act("deleteTrack", { trackId: t.id }).then(() => toast(t.title + " deleted from the library")).catch(() => {}); }} />
    </Screen>
  );
}

function TempoCard({ bpm, setBpm, detected, minus }) {
  const [taps, setTaps] = useState([]);
  const manual = Math.round(bpm * 10) !== Math.round(detected * 10);
  const tap = () => {
    const now = Date.now();
    const prev = taps.length && now - taps[taps.length - 1] < 2000 ? taps : [];
    const next = prev.concat([now]).slice(-8);
    setTaps(next);
    if (next.length >= 4) setBpm(Math.round(60000 / ((next[next.length - 1] - next[0]) / (next.length - 1))));
  };
  const setv = (v) => { setTaps([]); setBpm(Math.max(30, Math.min(250, Math.round(v * 10) / 10))); };
  return (
    <div className="card stack gap14" style={{ padding: "16px 14px" }}>
      <div className="hrow between">
        <div className="hrow gap10">
          {minus ? <button className="chipbtn" style={{ width: 36, padding: "8px 0" }} aria-label="Decrease BPM" onClick={() => setv(bpm - 1)}>−</button> : null}
          <span className="hrow gap6" style={{ alignItems: "baseline", minWidth: 96, justifyContent: "center" }}><span className="num" style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{Math.round(bpm * 10) / 10}</span><span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>BPM</span></span>
          {minus ? <button className="chipbtn" style={{ width: 36, padding: "8px 0" }} aria-label="Increase BPM" onClick={() => setv(bpm + 1)}>+</button> : null}
        </div>
        <span className={"tag" + (manual ? " accent" : "")} style={{ fontSize: 11, padding: "4px 10px" }}>{manual ? "Set manually" : "Detected"}</span>
      </div>
      <span className="small muted" style={{ lineHeight: 1.4 }}>Sounds too fast or slow? Detection can land on half or double the real tempo.</span>
      <div className="grid3"><button className="chipbtn" onClick={() => setv(bpm / 2)}>÷ 2</button><button className="chipbtn" onClick={() => setv(bpm * 2)}>× 2</button><button className="chipbtn" style={{ color: "var(--muted)" }} onClick={() => setv(detected)}>Use detected</button></div>
      <button onClick={tap} className="stack gap2" style={{ alignItems: "center", padding: 16, borderRadius: 12, background: taps.length ? "var(--accent-soft)" : "transparent", border: "1.5px solid var(--accent)", color: "var(--fg)" }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Tap tempo</span>
        <span className="small muted">{taps.length === 0 ? "Tap along to the beat, 4 or more times" : taps.length < 4 ? "Keep tapping… (" + taps.length + ")" : "Measured from " + taps.length + " taps"}</span>
      </button>
    </div>
  );
}

export function MusicUpload() {
  const { db, act, refresh, nav, me, toast } = useApp();
  const [stage, setStage] = useState("pick");
  const [pct, setPct] = useState(0);
  const [trackId, setTrackId] = useState(null);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [bpm, setBpm] = useState(null);
  const [err, setErr] = useState("");
  const pv = usePreview();
  const ref = useRef(null);
  const allowed = Object.keys(db.server.formats).filter((k) => db.server.formats[k]);
  const t = trackId ? S.track(db, trackId) : null;
  // Once the server has analysed it, show the review step with the detected tempo.
  useEffect(() => {
    if (stage !== "analysing" || !t) return;
    if (t.status === "ready") { setBpm(t.bpm || t.detectedBpm || 96); setStage("review"); }
    if (t.status === "failed") { setErr("That file couldn't be read. Try another one."); setStage("pick"); }
  }, [t && t.status, stage]);
  useEffect(() => {
    if (stage !== "analysing" || !trackId) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [stage, trackId]);
  const onFile = async (f) => {
    setErr("");
    const ext = (f.name.split(".").pop() || "").toUpperCase().replace("AAC", "M4A");
    if (allowed.indexOf(ext) < 0) { setErr("That format isn't allowed on this server. Use " + allowed.join(", ") + "."); return; }
    if (f.size > db.server.trackSize * 1e6) { setErr("That file is " + (f.size / 1e6).toFixed(0) + " MB. The limit here is " + db.server.trackSize + " MB."); return; }
    const base = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    setFile({ name: f.name, size: f.size, format: ext }); setTitle(base); setArtist(""); setStage("uploading"); setPct(0);
    try {
      const r = await upload("/api/upload/track", f, { "X-Title": encodeURIComponent(base) }, setPct);
      setTrackId(r.trackId); setStage("analysing"); refresh();
    } catch (e) { setErr(e.message); setStage("pick"); }
  };
  const add = async () => {
    try { await act("updateTrack", { trackId, title: title.trim() || file.name, artist: artist.trim(), bpm }); } catch (e) { return; }
    toast((title.trim() || file.name) + " added to the shared library");
    nav.back();
  };
  const discard = () => { if (trackId) act("deleteTrack", { trackId }, { quiet: true }).catch(() => {}); setTrackId(null); setStage("pick"); };
  const steps = [["Uploading", stage === "uploading" ? pct : 1], ["Measuring loudness & tempo", stage === "analysing" ? 0.5 : stage === "review" ? 1 : 0]];
  return (
    <Screen>
      <TopBar title="Upload music" sub="Added to the shared library" icon="close" backLabel="Cancel upload" onBack={() => { if (stage === "review") discard(); nav.back(); }} />
      <div className="scroll pad" style={{ paddingTop: 24 }}>
        {stage === "pick" ? (
          <div className="stack gap14">
            <div className="stack gap12" style={{ alignItems: "center", textAlign: "center", padding: "40px 20px", borderRadius: 18, border: "1.5px dashed var(--line-strong)" }}>
              <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="music" size={26} color="var(--accent)" /></span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Choose an audio file</span>
              <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{allowed.join(", ")} · up to {db.server.trackSize} MB</span>
              <button className="pill" style={{ marginTop: 4, fontSize: 14, padding: "11px 22px" }} onClick={() => ref.current && ref.current.click()}>Browse files</button>
              <input ref={ref} type="file" accept="audio/*,.flac,.m4a" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = ""; }} />
            </div>
            {err ? <span className="errtext">{err}</span> : null}
            <span className="small faint" style={{ lineHeight: 1.4 }}>Tempo and loudness are measured automatically after upload. You can adjust the tempo before adding it.</span>
          </div>
        ) : stage !== "review" ? (
          <div className="stack gap16">
            <div className="hrow gap12 card"><Icon name="music" size={18} color="var(--muted)" /><span className="stack gap2"><span style={{ fontSize: 13.5, fontWeight: 600 }}>{file.name}</span><span className="small muted">{(file.size / 1e6).toFixed(1)} MB · {file.format}</span></span></div>
            <div className="stack gap12">
              {steps.map(([l, v]) => { const done = v >= 1, cur = v > 0 && v < 1; return (
                <div key={l} className="hrow gap12">
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: done ? "var(--accent)" : "transparent", border: "2px solid " + (done || cur ? "var(--accent)" : "var(--line-strong)"), display: "flex", alignItems: "center", justifyContent: "center" }}>{done ? <Icon name="check" size={12} stroke={3} color="var(--accent-ink)" /> : null}</span>
                  <span style={{ fontSize: 14, color: done ? "var(--muted)" : cur ? "var(--fg)" : "var(--ghost)", fontWeight: cur ? 700 : 500 }}>{l}{cur && l === "Uploading" ? " · " + Math.round(v * 100) + "%" : cur ? "…" : ""}</span>
                </div>); })}
            </div>
          </div>
        ) : (
          <div className="stack gap22" style={{ gap: 22 }}>
            <div className="card stack gap12">
              <div className="hrow between">
                <span className="stack gap2" style={{ minWidth: 0 }}><span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{file.name}</span><span className="small muted">{fmtDur(t.duration)} · {(file.size / 1e6).toFixed(1)} MB · {file.format}{t.lufs != null ? " · " + t.lufs + " LUFS" : ""}</span></span>
                <button onClick={() => pv.toggle(t)} aria-label="Preview track" style={{ width: 36, height: 36, flexShrink: 0, borderRadius: "50%", background: pv.playing ? "var(--accent)" : "#2A2825", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: pv.playing ? "var(--accent-ink)" : "var(--fg)" }}><Icon name={pv.playing ? "pause" : "play"} size={14} /></button>
              </div>
              <Wave t={{ bpm: t.detectedBpm || 96, title: file.name, duration: t.duration, status: "ready" }} playing={!!pv.playing} pos={pv.pos} n={56} height={40} />
            </div>
            <div className="stack gap10">
              <span className="sec">Details</span>
              <div className="field"><label className="sec" htmlFor="up-title">Title</label><input id="up-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="field"><label className="sec" htmlFor="up-artist">Artist</label><input id="up-artist" className="input" placeholder="Unknown artist" value={artist} onChange={(e) => setArtist(e.target.value)} /></div>
            </div>
            <div className="stack gap10"><span className="sec">Tempo</span><TempoCard bpm={bpm} setBpm={setBpm} detected={t.detectedBpm || 96} /></div>
            <div style={{ height: 4 }} />
          </div>
        )}
      </div>
      {stage === "review" ? (
        <div className="stack gap4" style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
          <button className="btn" onClick={add}>Add to library</button>
          <button className="btn danger-ghost" style={{ color: "var(--muted)", fontSize: 13, padding: 10 }} onClick={discard}>Choose a different file</button>
        </div>
      ) : null}
    </Screen>
  );
}

export function TrackEdit({ params }) {
  const { db, act, refresh, nav, me, toast } = useApp();
  const t = S.track(db, params.trackId);
  const [title, setTitle] = useState(t ? t.title : "");
  const [artist, setArtist] = useState(t ? t.artist : "");
  const [bpm, setBpm] = useState(t ? t.bpm : 96);
  const [del, setDel] = useState(false);
  if (!t) return <Screen><TopBar title="Edit track" /><div className="small faint" style={{ padding: 40, textAlign: "center" }}>This track was deleted.</div></Screen>;
  const admin = S.isAdmin(db, me.id);
  const mine = t.addedBy === me.id;
  const used = db.mashes.filter((m) => m.tracks.some((x) => x.trackId === t.id)).length;
  const by = S.user(db, t.addedBy);
  const rows = [["Length", fmtDur(t.duration)], ["Format", t.format + " · " + (t.size / 1e6).toFixed(1) + " MB"], ["Loudness", t.lufs != null ? t.lufs + " LUFS" : "—"], ["Uploaded by", (mine ? "You" : by ? S.firstName(by) : "—") + " · " + shortDate(t.addedAt)], ["Used in", used + (used === 1 ? " mash" : " mashes")]];
  return (
    <Screen>
      <TopBar title="Edit track" sub={mine ? "You can edit this because you uploaded it" : "You can edit this as the admin"} />
      <div className="scroll pad stack gap22" style={{ paddingTop: 22, gap: 22 }}>
        <div className="stack gap10">
          <span className="sec">Details</span>
          <div className="field"><label className="sec" htmlFor="te-title">Title</label><input id="te-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="field"><label className="sec" htmlFor="te-artist">Artist</label><input id="te-artist" className="input" value={artist} onChange={(e) => setArtist(e.target.value)} /></div>
        </div>
        <div className="stack gap10">
          <span className="sec">Tempo</span>
          <TempoCard bpm={bpm} setBpm={setBpm} detected={t.detectedBpm || t.bpm} minus />
          <span className="small faint" style={{ lineHeight: 1.4 }}>Changing the tempo affects beat sync in new mashes only. Mashes already rendered keep their timing.</span>
        </div>
        <div className="stack gap10">
          <span className="sec">File</span>
          <div className="card list" style={{ padding: "4px 14px" }}>{rows.map((r) => <div key={r[0]} className="hrow between" style={{ padding: "10px 0", fontSize: 13 }}><span className="muted">{r[0]}</span><span style={{ fontWeight: 600 }}>{r[1]}</span></div>)}</div>
        </div>
        <div style={{ height: 4 }} />
      </div>
      <div className="stack gap4" style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <button className="btn" disabled={!title.trim()} onClick={() => { act("updateTrack", { trackId: t.id, title: title.trim(), artist: artist.trim(), bpm }).then(() => { toast("Track saved"); nav.back(); }).catch(() => {}); }}>Save changes</button>
        {admin ? <button className="btn danger-ghost" onClick={() => setDel(true)}>Delete track</button> : <button className="btn danger-ghost" disabled={db.removalRequests.some((r) => r.trackId === t.id && r.status === "open")} onClick={() => { act("requestTrackRemoval", { trackId: t.id, reason: "" }).then(() => { toast("Removal request sent to the admin"); nav.back(); }).catch(() => {}); }}>{db.removalRequests.some((r) => r.trackId === t.id && r.status === "open") ? "Removal requested" : "Request removal"}</button>}
      </div>
      <Confirm open={del} onClose={() => setDel(false)} title={"Delete “" + t.title + "”?"} body={"Used in " + used + (used === 1 ? " mash" : " mashes") + ". Mashes already rendered keep their audio."} confirm="Delete track" danger onConfirm={() => { act("deleteTrack", { trackId: t.id }).then(() => { toast(t.title + " deleted"); nav.back(); }).catch(() => {}); }} />
    </Screen>
  );
}
