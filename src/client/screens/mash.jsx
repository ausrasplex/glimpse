import React from "react";
import { useApp, live } from "../store.jsx";
import { Icon } from "../icons.jsx";
import { Screen, TopBar, Steps, Sheet, Thumb, ClipView, PlayBadge, Menu, Choice, Opts, Toggle, ToggleRow, Stepper, Section, Confirm, useDragList, move } from "../ui.jsx";
import * as S from "../sel.js";
import { download, haptic } from "../platform.js";
import { QUALITY, OUTPUT, stampDate as shStampDate, stampLines as shStampLines } from "../../shared/mash";
import { STAMP_DEFAULT, LABEL_DEFAULT, cleanStamp, cleanLabel, matched, labelText } from "../../shared/textstyle";
import { TextPreview, TextStyleControls, FontPicker } from "./textstyle.jsx";
import { barsFrom } from "../../shared/peaks";
import { usePreview } from "./music.jsx";
import { MONTH, MON, parseKey, todayKey, addDays, fullDay, dayLabel, monthDay, fmtDur, shortDate, rel, uid, hexA, gb } from "../util.js";

const { useState, useEffect, useLayoutEffect, useRef } = React;

export const SHAPES = {
  portrait: { label: "Portrait", ratio: "9:16", w: 26, h: 46, res: "1080 × 1920", ar: 9 / 16 },
  landscape: { label: "Landscape", ratio: "16:9", w: 50, h: 28, res: "1920 × 1080", ar: 16 / 9 },
  square: { label: "Square", ratio: "1:1", w: 38, h: 38, res: "1080 × 1080", ar: 1 }
};
export const FILLS = { blur: "Blurred fill", crop: "Cropped to fit", bars: "Black bars" };
// Output size for a shape at the server's maximum resolution, e.g. "1920 × 1080".
export const resOf = (db, shape) => { const r = (OUTPUT[db.server.maxRes] || OUTPUT["1080"])[shape] || OUTPUT["1080"].portrait; return r[0] + " × " + r[1]; };
const qualityName = (q) => (QUALITY[q] || QUALITY.high).label + " quality";
const AR = { portrait: 9 / 16, landscape: 16 / 9, square: 1 };
// Where a clip sits inside the mash frame: fills it if the shapes match (or crop is on), otherwise fits inside.
export function clipBox(orient, shape, fill) {
  const ca = AR[orient || "portrait"], ba = AR[shape];
  if (Math.abs(ca - ba) < 0.01 || fill === "crop") return { inset: true };
  return ca > ba ? { w: "100%", h: (ba / ca * 100) + "%" } : { w: (ca / ba * 100) + "%", h: "100%" };
}
// Text on each clip of a mash: the date stamp and the song title.
export const stampOf = (m) => cleanStamp(m.stamp || { on: m.overlay !== false });
export const stampDate = (k, format) => shStampDate(k, format);

// The text a mash puts on clip number i (the date stamp and the song title), and the clip behind it as the mash shows it.
function textScene(db, d, e, i) {
  const st = cleanStamp(d.stamp), lb = cleanLabel(d.label);
  const look = lb.match ? matched(lb, st) : lb;
  const t0 = d.tracks.length ? S.track(db, d.tracks[0].trackId) : null;
  const music = !!t0 && d.audio !== "clips";
  const ent = e || { date: todayKey(), note: "A note from this day" };
  const md = e ? S.media(db, e.mediaId) : null;
  const [l1, l2] = shStampLines(st, ent.date, ent.note || "", i);
  // Behind the text, the clip as the mash will show it: filling the frame, or fitted with a blur or bars around it.
  const pic = md ? (md.thumb ? "url(" + md.thumb + ") center/cover, " + md.grad : md.grad) : "linear-gradient(160deg,#C98A4B,#584E75)";
  const cb = clipBox(md ? md.orient : d.shape, d.shape, d.fill);
  const back = cb.inset ? <div style={{ position: "absolute", inset: 0, background: pic }} /> : (
    <>
      {d.fill === "blur" ? <div style={{ position: "absolute", inset: -12, background: pic, filter: "blur(10px) brightness(0.94)" }} /> : <div style={{ position: "absolute", inset: 0, background: "#000" }} />}
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: cb.w, height: cb.h, background: pic }} />
    </>
  );
  const label = music && d.musicLabel !== false;
  const items = (st.on ? [{ look: st, lines: [l1, l2 || ""] }] : []).concat(label ? [{ look, lines: [labelText(lb, t0.title, t0.artist)] }] : []);
  return { items, back, stamp: st.on, label };
}
const fitIn = (ar, w, h) => { const fw = Math.max(1, Math.min(w, Math.round(h * ar))); return { w: fw, h: Math.round(fw / ar) }; };

// The text preview: a slim bar pinned under the header that drops a full-size, to-scale preview over the settings.
function TextBar({ d, db, picked }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const ar = SHAPES[d.shape].ar;
  const area = useRef(null);
  const panel = useRef(null);
  const [room, setRoom] = useState({ w: 320, h: 560 });
  useEffect(() => {
    const el = area.current;
    if (!open || !el) return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (panel.current) panel.current.focus();
    const esc = (ev) => { if (ev.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    if (!window.ResizeObserver) return () => window.removeEventListener("keydown", esc);
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => { ro.disconnect(); window.removeEventListener("keydown", esc); };
  }, [open]);
  const n = picked.length;
  const i = n ? Math.min(at, n - 1) : 0;
  const scene = textScene(db, d, picked[i], i);
  const thumb = fitIn(ar, 44, 44);
  // The dialog keeps 16px from the sides, 12px of padding, room under the picture for the clip buttons,
  // and a strip of the dimmed page below it to tap.
  const big = fitIn(ar, room.w - 56, room.h - 150);
  const what = scene.stamp && scene.label ? "Date stamp · Song title" : scene.stamp ? "Date stamp" : scene.label ? "Song title" : "No text on the clips";
  return (
    <>
      <div style={{ padding: "0 20px 10px", flexShrink: 0, position: "relative", zIndex: 3 }}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="hrow gap12" style={{ width: "100%", minHeight: 60, padding: "8px 12px 8px 8px", borderRadius: 14, border: "1px solid " + (open ? "var(--accent)" : "var(--line-strong)"), background: "var(--surface)", color: "var(--fg)", textAlign: "left" }}>
          <span style={{ width: 44, height: 44, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><TextPreview items={scene.items} w={thumb.w} h={thumb.h} back={scene.back} quiet radius={4} /></span>
          <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Preview text</span>
            <span className="small muted ellipsis">{SHAPES[d.shape].label} · {what}</span>
          </span>
          <span className="hrow gap4" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>{open ? "Hide" : "Show"}<Icon name="chevD" size={16} stroke={2.4} style={{ transform: open ? "rotate(180deg)" : "none" }} /></span>
        </button>
      </div>
      {open ? (
        <div ref={area} style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 70, zIndex: 2 }}>
          <button aria-label="Close preview" onClick={() => setOpen(false)} style={{ position: "absolute", inset: 0, border: "none", padding: 0, background: "rgba(0,0,0,0.6)" }} />
          <div ref={panel} tabIndex={-1} role="dialog" aria-label="Text preview" className="stack gap12" style={{ position: "absolute", left: 16, right: 16, top: 0, alignItems: "center", padding: 12, borderRadius: 18, background: "var(--bg-deep)", border: "1px solid var(--line-strong)", boxShadow: "0 18px 50px rgba(0,0,0,0.6)", outline: "none" }}>
            <TextPreview items={scene.items} w={big.w} h={big.h} back={scene.back} />
            <div className="hrow between" style={{ width: Math.max(big.w, 220) }}>
              <button className="iconbtn sq" aria-label="Previous clip" disabled={i <= 0} onClick={() => setAt(i - 1)} style={{ opacity: i <= 0 ? 0.35 : 1 }}><Icon name="chevL" size={18} /></button>
              <span className="small muted">{n ? "Clip " + (i + 1) + " of " + n + " · " + monthDay(picked[i].date) : "Sample clip"}</span>
              <button className="iconbtn sq" aria-label="Next clip" disabled={i >= n - 1} onClick={() => setAt(i + 1)} style={{ opacity: i >= n - 1 ? 0.35 : 1 }}><Icon name="chevR" size={18} /></button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// The date stamp and song title settings, with a tab for each.
function TextCard({ d, set, db, me }) {
  const { act, toast } = useApp();
  const [tab, setTab] = useState("stamp");
  const [fontFor, setFontFor] = useState(null);
  const st = cleanStamp(d.stamp), lb = cleanLabel(d.label);
  const putStamp = (o) => set({ stamp: Object.assign({}, st, o) });
  const putLabel = (o) => set({ label: Object.assign({}, lb, o) });
  const pf = S.prefs(db, me.id);
  const isDefault = JSON.stringify(cleanStamp(pf.stamp)) === JSON.stringify(st) && JSON.stringify(cleanLabel(pf.label)) === JSON.stringify(lb);
  const t0 = d.tracks.length ? S.track(db, d.tracks[0].trackId) : null;
  const music = !!t0 && d.audio !== "clips";
  return (
    <div className="card stack gap16">
      <Opts value={tab} onChange={setTab} options={[{ id: "stamp", label: "Date stamp" }, { id: "label", label: "Song title" }]} />
      {tab === "stamp" ? (
        <div className="stack gap16">
          <ToggleRow title="Date stamp" sub={st.on ? "Shown on every clip" : "No date on the clips"} on={st.on} onChange={(v) => putStamp({ on: v })} />
          {st.on ? (
            <>
              <div className="stack gap6"><span className="sec">Show</span><Opts value={st.show} onChange={(v) => putStamp({ show: v })} options={[{ id: "date", label: "Date" }, { id: "dateNote", label: "Date + note" }, { id: "day", label: "Day count" }]} /></div>
              <div className="stack gap6"><span className="sec">Date format</span><Opts value={st.format} onChange={(v) => putStamp({ format: v })} options={[{ id: "short", label: stampDate(todayKey(), "short") }, { id: "long", label: stampDate(todayKey(), "long").replace(/ \d{4}$/, "") + "…" }, { id: "num", label: stampDate(todayKey(), "num") }]} /></div>
              <TextStyleControls look={st} set={(v) => set({ stamp: v })} onFont={() => setFontFor("stamp")} />
            </>
          ) : null}
        </div>
      ) : (
        <div className="stack gap16" style={{ opacity: music ? 1 : 0.55 }}>
          <ToggleRow title="Song title" sub={!t0 ? "Add music below to show its title" : d.audio === "clips" ? "Music is off in Sound below" : d.musicLabel !== false ? "Shown in a corner while each track plays" : "No song title on the video"} on={d.musicLabel !== false} onChange={(v) => set({ musicLabel: v })} />
          {d.musicLabel !== false ? (
            <>
              <div className="stack gap6"><span className="sec">Shows</span><Opts value={lb.show} onChange={(v) => putLabel({ show: v })} options={[{ id: "title", label: "Title" }, { id: "titleArtist", label: "Title – Artist" }, { id: "note", label: "♪ Title" }]} /></div>
              <ToggleRow title="Match date stamp style" sub={lb.match ? "Same font, colours and box as the date stamp" : "Style the song title on its own"} on={lb.match} onChange={(v) => putLabel(v ? { match: true } : Object.assign(matched(lb, st), { match: false }))} />
              {lb.match ? <div className="stack gap6"><span className="sec">Position</span><Opts value={lb.pos} onChange={(v) => putLabel({ pos: v })} options={[{ id: "tl", label: "↖ Top" }, { id: "tr", label: "Top ↗" }, { id: "bl", label: "↙ Bottom" }, { id: "br", label: "Bottom ↘" }]} /></div>
                : <TextStyleControls look={lb} set={(v) => set({ label: Object.assign({}, v, { match: false }) })} onFont={() => setFontFor("label")} />}
              {st.on && lb.pos === st.pos ? <span className="small faint">Both are in the same corner, so they stack: the date stamp nearest the edge.</span> : null}
            </>
          ) : null}
        </div>
      )}
      <button className="chipbtn" disabled={isDefault} style={{ alignSelf: "flex-start", opacity: isDefault ? 0.5 : 1 }} onClick={() => { act("setPrefs", { stamp: st, label: lb }).then(() => toast("Saved as your default text style")).catch(() => {}); }}>{isDefault ? "This is your default" : "Save as my default"}</button>
      <FontPicker open={!!fontFor} onClose={() => setFontFor(null)} value={fontFor === "label" ? lb.font : st.font} onPick={(f) => (fontFor === "label" ? set({ label: Object.assign({}, lb, { font: f, match: false }) }) : putStamp({ font: f }))} />
    </div>
  );
}

const RANGES = [{ id: "week", label: "Past week" }, { id: "this", label: "This month" }, { id: "last", label: "Last month" }, { id: "year", label: "Past year" }, { id: "all", label: "All time" }, { id: "custom", label: "Custom" }];

function rangeText(r) {
  if (r.from === "2000-01-01") return "All time";
  const a = parseKey(r.from), b = parseKey(r.to);
  const same = a.getFullYear() === b.getFullYear();
  return a.getDate() + " " + MON[a.getMonth()] + (same ? "" : " " + a.getFullYear()) + " – " + b.getDate() + " " + MON[b.getMonth()] + " " + b.getFullYear();
}
function defaultTitle(db, d) {
  const p = S.project(db, d.projectId);
  const r = S.rangeFor(d.range, d.custom);
  const who = d.memberId ? " (" + S.firstName(S.user(db, d.memberId)) + ")" : "";
  const base = p ? p.name : "Mash";
  if (d.range === "this" || d.range === "last") { const k = parseKey(r.from); return base + " — " + MONTH[k.getMonth()] + " " + k.getFullYear() + who; }
  if (d.range === "year") return base + " — Past year" + who;
  if (d.range === "week") return base + " — Week of " + monthDay(r.from) + who;
  if (d.range === "all") return base + " — All time" + who;
  return base + " — " + rangeText(r) + who;
}

function initDraft(db, me, params) {
  const base = params.remashOf ? S.mash(db, params.remashOf) : null;
  const mine = S.sortProjects(S.myProjects(db, me.id));
  const pid = params.projectId || (base && base.projectId) || (mine[0] && mine[0].p.id);
  const d = {
    projectId: pid, memberId: params.memberId || (base && base.memberId) || null, range: params.range || (base && base.range) || "this", custom: base && base.custom || null,
    excluded: {}, title: null, shape: "portrait", fill: S.prefs(db, me.id).fill, clipMode: "trimmed", cap: 1, overlay: true, stamp: cleanStamp(S.prefs(db, me.id).stamp || STAMP_DEFAULT), label: cleanLabel(S.prefs(db, me.id).label || LABEL_DEFAULT),
    tracks: [], crossfade: 2, whenEnds: "loop", audio: "both", level: 40, sync: "off", beats: 1, stretch: true, shared: false, remashOf: null, musicLabel: true, quality: db.server.mashQuality || "high"
  };
  if (base) {
    ["shape", "fill", "clipMode", "cap", "overlay", "crossfade", "whenEnds", "audio", "level", "sync", "beats", "shared"].forEach((k) => { d[k] = base[k]; });
    d.stretch = base.stretch !== false;
    d.musicLabel = base.musicLabel !== false;
    d.quality = QUALITY[base.quality] ? base.quality : "high";
    d.stamp = stampOf(base);
    d.label = cleanLabel(base.label || LABEL_DEFAULT);
    d.tracks = JSON.parse(JSON.stringify(base.tracks));
    d.remashOf = base.id; d.title = base.title;
    const r = S.rangeFor(d.range, d.custom);
    S.entriesInRange(db, pid, r.from, r.to, d.memberId).forEach((e) => { if (base.entryIds.indexOf(e.id) < 0) d.excluded[e.id] = true; });
  } else {
    // Picks carry over from the last mash of this project.
    const picks = db.mashPicks[pid] || {};
    Object.keys(picks).forEach((k) => { d.excluded[k] = true; });
  }
  return d;
}

function useDraft(params) {
  const { db, me, mashDraft, setMashDraft } = useApp();
  const fresh = !mashDraft || (params.projectId && params.projectId !== mashDraft.projectId) || (params.remashOf && params.remashOf !== mashDraft.remashOf) || (params.range && params.fromLink);
  const d = fresh ? initDraft(db, me, params) : mashDraft;
  const set = (o) => setMashDraft(Object.assign({}, d, o));
  return [d, set];
}

function selection(db, d) {
  const r = S.rangeFor(d.range, d.custom);
  const all = S.entriesInRange(db, d.projectId, r.from, r.to, d.memberId);
  const picked = all.filter((e) => !d.excluded[e.id]);
  const byDay = {}; all.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  return { r, all, picked, byDay };
}

export function MashStep1({ params }) {
  const { db, nav, me, setMashDraft } = useApp();
  const [d, set] = useDraft(params);
  useEffect(() => { setMashDraft(d); }, []);
  const mine = S.sortProjects(S.myProjects(db, me.id));
  const x = mine.find((y) => y.p.id === d.projectId);
  const { r, all, picked } = selection(db, d);
  const days = new Set(picked.map((e) => e.date)).size;
  const missed = x && x.cat.daily && !d.memberId ? S.missedDays(db, d.projectId, r.from, r.to).length : null;
  const carried = all.filter((e) => d.excluded[e.id]).length;
  const members = x ? x.members.map((m) => S.user(db, m.userId)).filter(Boolean) : [];
  return (
    <Screen>
      <TopBar title={d.remashOf ? "Re-mash" : "New mash"} sub="Step 1 of 3 · What to include" backLabel="Back to Mash" onBack={() => { setMashDraft(null); nav.back(); }} />
      <Steps n={1} of={3} />
      <div className="scroll pad stack gap24" style={{ paddingTop: 22 }}>
        <Section title="Project">
          <div className="stack gap8">
            {mine.map((y) => (
              <Choice key={y.p.id} active={y.p.id === d.projectId} onClick={() => set({ projectId: y.p.id, memberId: null, excluded: Object.assign({}, db.mashPicks[y.p.id] || {}), title: null })} title={y.p.name} desc={y.cat.name + " · " + y.count + " entries" + (y.shared ? " · " + y.members.length + " members" : "")} radio={false}>
                <span className={"radio" + (y.p.id === d.projectId ? " on" : "")} />
              </Choice>
            ))}
          </div>
        </Section>
        {members.length > 1 ? (
          <Section title="Whose clips" right="Mash one person's perspective">
            <div className="hrow wrap gap6">
              {[null].concat(members.map((u) => u.id)).map((id) => {
                const on = d.memberId === id; const u = id && S.user(db, id);
                return <button key={id || "all"} onClick={() => set({ memberId: id, title: null })} aria-pressed={on} className="hrow gap6" style={{ padding: "7px 12px", borderRadius: 18, background: on ? "var(--accent-soft)" : "var(--surface)", border: "1px solid " + (on ? "var(--accent)" : "var(--line)"), color: on ? "var(--fg)" : "var(--muted)", fontSize: 12.5, fontWeight: 600 }}>{u ? <span className="dot" style={{ background: u.color }} /> : null}{u ? (u.id === me.id ? "Mine" : S.firstName(u)) : "Everyone"}</button>;
              })}
            </div>
          </Section>
        ) : null}
        <Section title="Date range" right={rangeText(r)}>
          <div className="hrow wrap gap6">
            {RANGES.map((o) => { const on = o.id === d.range; return <button key={o.id} onClick={() => set({ range: o.id, title: null, custom: o.id === "custom" ? (d.custom || { from: addDays(todayKey(), -30), to: todayKey() }) : d.custom })} aria-pressed={on} style={{ padding: "8px 13px", borderRadius: 18, background: on ? "var(--accent-soft)" : "var(--surface)", border: "1px solid " + (on ? "var(--accent)" : "var(--line)"), color: on ? "var(--fg)" : "var(--muted)", fontSize: 12.5, fontWeight: 600 }}>{o.label}</button>; })}
          </div>
          {d.range === "custom" ? (
            <div className="grid2" style={{ gap: 8 }}>
              <div className="field"><label className="sec" htmlFor="m-from">From</label><input id="m-from" className="input" type="date" max={todayKey()} value={d.custom.from} onChange={(e) => e.target.value && set({ custom: { from: e.target.value, to: d.custom.to }, title: null })} /></div>
              <div className="field"><label className="sec" htmlFor="m-to">To</label><input id="m-to" className="input" type="date" max={todayKey()} value={d.custom.to} onChange={(e) => e.target.value && set({ custom: { from: d.custom.from, to: e.target.value }, title: null })} /></div>
            </div>
          ) : null}
        </Section>
        <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
          <div className="stack gap2"><span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{days}</span><span className="tiny muted">days with clips</span></div>
          <div className="stack gap2"><span className="num" style={{ fontSize: 20, fontWeight: 700 }}>{picked.length}</span><span className="tiny muted">clips</span></div>
          <div className="stack gap2"><span className="num" style={{ fontSize: 20, fontWeight: 700, color: missed ? "#E07B5B" : "var(--faint)" }}>{missed === null ? "—" : missed}</span><span className="tiny muted">{missed === null ? "no streak tracking" : "missed days"}</span></div>
        </div>
        {carried ? <div className="hrow gap10 small muted" style={{ alignItems: "flex-start", lineHeight: 1.4 }}><Icon name="info" size={15} color="var(--faint)" /><span>Starting from your last {x ? x.p.name : ""} mash: {carried} {carried === 1 ? "clip you left out stays" : "clips you left out stay"} unticked.</span></div> : null}
        <div style={{ height: 6 }} />
      </div>
      <div style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <button className="btn" disabled={!all.length} onClick={() => { setMashDraft(d); nav.go("mash2"); }}>{all.length ? "Continue" : "No clips in this range"}</button>
      </div>
    </Screen>
  );
}

export function MashStep2() {
  const { db, nav, me, mashDraft, setMashDraft, setDraft } = useApp();
  const [showAll, setShowAll] = useState(null);
  const [showMissed, setShowMissed] = useState(8);
  if (!mashDraft) return <Screen><TopBar title="Review clips" /></Screen>;
  const d = mashDraft;
  const set = (o) => setMashDraft(Object.assign({}, d, o));
  const x = S.myProjects(db, me.id).find((y) => y.p.id === d.projectId);
  const { r, all, picked, byDay } = selection(db, d);
  const multi = Object.keys(byDay).filter((k) => byDay[k].length > 1).sort();
  const singles = Object.keys(byDay).filter((k) => byDay[k].length === 1).sort();
  const missed = x && x.cat.daily && !d.memberId ? S.missedDays(db, d.projectId, r.from, r.to) : [];
  // The rest start open when there's nothing else to do here; with missed days to fill, they start closed.
  const open = showAll === null ? !missed.length : showAll;
  const toggle = (id) => { const ex = Object.assign({}, d.excluded); if (ex[id]) delete ex[id]; else ex[id] = true; set({ excluded: ex }); };
  const multiClips = multi.reduce((a, k) => a + byDay[k].length, 0);
  const multiPicked = multi.reduce((a, k) => a + byDay[k].filter((e) => !d.excluded[e.id]).length, 0);
  const Tile = ({ e, w }) => {
    const on = !d.excluded[e.id]; const c = S.clipOf(db, e);
    return (
      <button onClick={() => toggle(e.id)} aria-pressed={on} aria-label={(on ? "Leave out " : "Include ") + c.len.toFixed(1) + "s clip from " + fullDay(e.date)} style={{ position: "relative", width: w || 72, height: (w || 72) * 4 / 3, flexShrink: 0, borderRadius: 10, background: c.m.thumb ? "url(" + c.m.thumb + ") center/cover" : c.m.grad, border: "2px solid " + (on ? "var(--accent)" : "var(--line)"), padding: 0, opacity: on ? 1 : 0.4 }}>
        <span style={{ position: "absolute", top: 6, right: 6, width: 20, height: 20, borderRadius: 6, background: on ? "var(--accent)" : "rgba(0,0,0,0.4)", border: "2px solid " + (on ? "var(--accent)" : "var(--muted)"), display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? <Icon name="check" size={12} stroke={3} color="var(--accent-ink)" /> : null}</span>
        <span style={{ position: "absolute", left: 6, bottom: 5, fontSize: 10, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>{c.len.toFixed(1)}s</span>
      </button>
    );
  };
  return (
    <Screen>
      <TopBar title="Review clips" sub={"Step 2 of 3 · " + (x ? x.p.name : "") + " · " + rangeText(r)} backLabel="Back to step 1" />
      <Steps n={2} of={3} />
      <div className="scroll pad stack gap24" style={{ paddingTop: 22 }}>
        {multi.length ? (
          <div className="stack gap10">
            <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Days with more than one clip</span><span className="small muted">{multiPicked} of {multiClips} picked</span></div>
            <span className="small faint" style={{ marginTop: -4 }}>Tap a clip to leave it out. Your picks carry over to re-mashes.</span>
            {multi.map((k) => (
              <div key={k} className="card" style={{ padding: 12 }}>
                <div className="hrow between" style={{ marginBottom: 10 }}><span style={{ fontSize: 13.5, fontWeight: 700 }}>{dayLabel(k)}</span><span className="small muted">{byDay[k].filter((e) => !d.excluded[e.id]).length} of {byDay[k].length} included</span></div>
                <div className="hrow gap8 wrap">{byDay[k].map((e) => <Tile key={e.id} e={e} />)}</div>
              </div>
            ))}
          </div>
        ) : <span className="small faint">Every day in this range has one clip, so there's nothing to choose between.</span>}
        <div className="stack gap10">
          <button onClick={() => setShowAll(!open)} className="hrow between" style={{ background: "none", border: "none", padding: 0, color: "var(--fg)" }}><span className="sec">All other clips · {singles.length}</span><span className="link">{open ? "Hide" : "Show"}</span></button>
          {open ? <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>{singles.map((k) => <div key={k} className="stack gap4"><Tile e={byDay[k][0]} w={74} /><span className="tiny faint">{monthDay(k)}</span></div>)}</div> : null}
        </div>
        {x && x.cat.daily && !d.memberId ? (
          <div className="stack gap10">
            <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Missed days · {missed.length}</span><span className="small faint">Daily projects only</span></div>
            {missed.length ? <span className="small faint" style={{ marginTop: -4 }}>Got a clip from one of these days? Add it before you render.</span> : <span className="small" style={{ color: "var(--ok)" }}>No missed days in this range.</span>}
            {missed.length ? (
              <div className="card flush list">
                {missed.slice(-showMissed).reverse().map((k) => (
                  <div key={k} className="hrow between" style={{ padding: "11px 14px" }}>
                    <div className="hrow gap10"><span style={{ width: 34, height: 34, borderRadius: 9, border: "1.5px dashed var(--line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{parseKey(k).getDate()}</span><span style={{ fontSize: 13.5 }}>{fullDay(k).replace(/ \d{4}$/, "")}</span></div>
                    <button className="chipbtn hrow gap4" style={{ fontWeight: 700, fontSize: 12 }} onClick={() => { setDraft({ date: k, presetProjectId: d.projectId, returnTo: "mash2" }); nav.go("capture"); }}><Icon name="plus" size={12} stroke={2.6} />Add clip</button>
                  </div>
                ))}
              </div>
            ) : null}
            {missed.length > showMissed ? <button className="btn outline sm" onClick={() => setShowMissed(showMissed + 20)}>Show earlier missed days ({missed.length - showMissed})</button> : null}
          </div>
        ) : null}
        <div style={{ height: 6 }} />
      </div>
      <div className="stack gap8" style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <button className="btn" disabled={!picked.length} onClick={() => nav.go("mash3")}>{missed.length ? "Skip missed days & continue" : "Continue"}</button>
        <span className="small faint" style={{ textAlign: "center" }}>{picked.length} clips from {new Set(picked.map((e) => e.date)).size} days will be mashed</span>
      </div>
    </Screen>
  );
}

// Beat sync rule: keep the user's start point, adjust the end to land on a beat.
// With stretch on, a clip may run up to half a beat (max 0.5s) past its trim, using footage
// after the end handle, or before the start if the video ends there. With stretch off it only shortens.
export function syncedLen(c, beatLen, mode, beats, stretch) {
  const slack = Math.min(0.5 * beatLen, 0.5);
  const spare = Math.max(0, (c.m.duration || c.end) - c.end) + Math.max(0, c.start);
  const maxLen = c.len + (stretch ? Math.min(slack, spare) : 0);
  if (mode === "fixed") return Math.min(beats * beatLen, maxLen);
  const n = Math.max(1, Math.round(c.len / beatLen));
  let target = n * beatLen;
  if (target > maxLen) target = Math.max(1, Math.floor(maxLen / beatLen)) * beatLen;
  return target > maxLen ? maxLen : target;
}

function estimate(db, d, picked) {
  const t0 = d.tracks.length ? S.track(db, d.tracks[0].trackId) : null;
  const beatLen = 60 / ((t0 && t0.bpm) || 96);
  const musicOn = d.audio !== "clips" && d.tracks.length;
  const trimmed = picked.reduce((a, e) => a + S.clipOf(db, e).len, 0);
  if (musicOn && d.sync !== "off") return picked.reduce((a, e) => a + syncedLen(S.clipOf(db, e), beatLen, d.sync, d.beats, d.stretch !== false), 0);
  if (d.clipMode === "cap") return picked.reduce((a, e) => a + Math.min(d.cap, S.clipOf(db, e).len), 0);
  return trimmed;
}

export function MusicPicker({ open, onClose, list, onAdd, bpm }) {
  const { db, me, nav } = useApp();
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const pv = usePreview();
  const playing = pv.playing;
  const tracks = db.tracks.filter((t) => t.status === "ready").filter((t) => !q || (t.title + t.artist).toLowerCase().indexOf(q.toLowerCase()) >= 0).filter((t) => f === "all" || (f === "mine" ? t.addedBy === me.id : Math.abs(t.bpm - (bpm || 96)) <= 8));
  return (
    <Sheet open={open} onClose={onClose} title="Add a track" right={<button className="link" style={{ fontSize: 14, fontWeight: 700 }} onClick={onClose}>Done</button>} tall>
      <div className="stack gap12">
        <div className="hrow gap10" style={{ padding: "11px 14px", borderRadius: 12, background: "#1F1E1B", border: "1px solid var(--line)" }}><Icon name="search" size={16} color="var(--faint)" /><input aria-label="Search music" placeholder="Search the shared library" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 14 }} /></div>
        <div className="hrow gap6">{[["all", "All"], ["near", "Near " + Math.round(bpm || 96) + " BPM"], ["mine", "Mine"]].map((o) => <button key={o[0]} onClick={() => setF(o[0])} aria-pressed={f === o[0]} style={{ padding: "6px 11px", borderRadius: 14, background: f === o[0] ? "#2A2825" : "#1F1E1B", border: "1px solid " + (f === o[0] ? "var(--fg)" : "var(--line)"), color: f === o[0] ? "var(--fg)" : "var(--muted)", fontSize: 12, fontWeight: 600 }}>{o[1]}</button>)}</div>
        {tracks.map((t) => {
          const idx = list.indexOf(t.id); const pl = playing === t.id;
          return (
            <div key={t.id} className="hrow gap12" style={{ padding: "10px 12px", borderRadius: 14, background: "#1F1E1B", border: "1px solid " + (pl ? "var(--accent)" : "var(--line)") }}>
              <button onClick={() => pv.toggle(t)} aria-label={(pl ? "Pause " : "Preview ") + t.title} style={{ width: 36, height: 36, flexShrink: 0, borderRadius: "50%", background: pl ? "var(--accent)" : "#2A2825", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: pl ? "var(--accent-ink)" : "var(--fg)" }}><Icon name={pl ? "pause" : "play"} size={14} /></button>
              <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}><span className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{t.title}</span><span className="small muted ellipsis">{t.artist} · {fmtDur(t.duration)} · {t.bpm} BPM</span></span>
              {idx >= 0 ? <span className="tag ok" style={{ fontSize: 12, padding: "7px 11px" }}>✓ #{idx + 1}</span> : <button className="chipbtn" style={{ background: "var(--accent)", color: "var(--accent-ink)", border: "none", fontWeight: 800 }} onClick={() => onAdd(t.id)}>+ Add</button>}
            </div>
          );
        })}
        {!tracks.length ? <span className="small faint" style={{ padding: 20, textAlign: "center" }}>No tracks match.</span> : null}
        <button className="btn dashed" onClick={() => { onClose(); nav.go("musicUpload"); }}><Icon name="upload" size={15} />Upload a new track</button>
      </div>
    </Sheet>
  );
}

export function MashStep3() {
  const { db, act, nav, me, mashDraft, setMashDraft, toast } = useApp();
  const [menu, setMenu] = useState(null);
  const [picker, setPicker] = useState(false);
  const d = mashDraft;
  const dragged = useDragList(d ? d.tracks : [], (a, b) => set({ tracks: move(d.tracks, a, b) }), 96);
  if (!d) return <Screen><TopBar title="Style" /></Screen>;
  function set(o) { setMashDraft(Object.assign({}, d, o)); }
  const x = S.myProjects(db, me.id).find((y) => y.p.id === d.projectId);
  const { picked } = selection(db, d);
  const secs = estimate(db, d, picked);
  const orientCount = { portrait: 0, landscape: 0, square: 0 };
  picked.forEach((e) => { const md = S.media(db, e.mediaId); orientCount[(md && md.orient) || "portrait"]++; });
  const misfit = picked.length - orientCount[d.shape];
  const best = Object.keys(orientCount).sort((a, b) => orientCount[b] - orientCount[a])[0];
  const musicOn = d.audio !== "clips" && d.tracks.length > 0;
  const syncActive = musicOn && d.sync !== "off";
  const t0 = d.tracks.length ? S.track(db, d.tracks[0].trackId) : null;
  const beatLen = 60 / ((t0 && t0.bpm) || 96);
  const title = d.title !== null && d.title !== undefined ? d.title : defaultTitle(db, d);
  let tcur = 0;
  const timeline = d.tracks.map((tr) => { const t = S.track(db, tr.trackId); const avail = (t ? t.duration : 120) - tr.start; const a = tcur; tcur = a + avail - d.crossfade; return { a, b: a + avail, reached: a < secs }; });
  const musicTotal = d.tracks.reduce((acc, tr) => { const t = S.track(db, tr.trackId); return acc + (t ? t.duration : 0) - tr.start; }, 0) - Math.max(0, d.tracks.length - 1) * d.crossfade;
  const seg = (opts, val, key) => <Opts value={val} onChange={(v) => set({ [key]: v })} options={opts} />;
  const [rendering, setRendering] = useState(false);
  const render = async () => {
    if (rendering) return;
    setRendering(true);
    try {
      await act("createMash", {
        projectId: d.projectId, memberId: d.memberId, title: title.trim() || defaultTitle(db, d), defaultTitle: defaultTitle(db, d), range: d.range, custom: d.custom, entryIds: picked.map((e) => e.id), excluded: d.excluded, remashOf: d.remashOf, shared: !!d.shared,
        settings: { shape: d.shape, fill: d.fill, clipMode: d.clipMode, cap: d.cap, stamp: d.stamp, label: d.label, tracks: d.tracks, crossfade: d.crossfade, whenEnds: d.whenEnds, audio: d.audio, level: d.level, sync: d.sync, beats: d.beats, stretch: d.stretch !== false, musicLabel: d.musicLabel !== false, quality: d.quality }
      });
    } catch (e) { setRendering(false); return; }
    haptic("success");
    toast("Rendering “" + (title.trim() || defaultTitle(db, d)) + "”. We'll let you know when it's ready.");
    setMashDraft(null);
    nav.reset("mash");
  };
  return (
    <Screen>
      <TopBar title="Style" sub={"Step 3 of 3 · " + picked.length + " clips"} backLabel="Back to step 2" />
      <Steps n={3} of={3} />
      {/* The preview bar stays pinned with the header and step lines; its dialog covers the settings below it. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <TextBar d={d} db={db} picked={picked} />
      <div className="scroll pad stack gap24" style={{ paddingTop: 12 }}>
        <div className="field">
          <div className="hrow between"><label className="sec" htmlFor="mash-title">Title</label>{d.title !== null && d.title !== undefined && d.title !== defaultTitle(db, d) ? <button className="link" style={{ color: "var(--muted)", fontSize: 11.5 }} onClick={() => set({ title: null })}>Reset to default</button> : null}</div>
          <input id="mash-title" className="input" maxLength={60} value={title} onChange={(e) => set({ title: e.target.value })} style={{ fontWeight: 600 }} />
        </div>
        <Section title="Shape">
          <div className="grid3">
            {Object.keys(SHAPES).map((k) => { const sh = SHAPES[k]; const on = d.shape === k; return (
              <button key={k} onClick={() => set({ shape: k })} aria-pressed={on} className="stack gap8" style={{ alignItems: "center", padding: "14px 6px 10px", borderRadius: 14, background: on ? "#211F1C" : "#1A1917", border: "1.5px solid " + (on ? "var(--accent)" : "var(--line)"), color: "var(--fg)" }}>
                <span style={{ height: 50, display: "flex", alignItems: "center" }}><span style={{ width: sh.w, height: sh.h, borderRadius: 4, border: "2px solid " + (on ? "var(--accent)" : "var(--faint)") }} /></span>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{sh.label}</span><span className="tiny" style={{ color: k === best && picked.length ? "var(--accent)" : "var(--muted)" }}>{k === best && picked.length ? "Most clips" : sh.ratio}</span>
              </button>); })}
          </div>
        </Section>
        <Section title="When a clip doesn't fit" right="Default from your Profile">
          <span className="small" style={{ lineHeight: 1.45, color: misfit ? "#BDB7AD" : "var(--muted)", marginTop: -4 }}>{misfit ? misfit + " of " + picked.length + " clips aren't " + SHAPES[d.shape].label.toLowerCase() + (orientCount.landscape && d.shape !== "landscape" ? " (" + orientCount.landscape + " landscape" + (orientCount.square && d.shape !== "square" ? ", " + orientCount.square + " square" : "") + ")" : "") + "." : "Every clip already matches " + SHAPES[d.shape].label.toLowerCase() + ", so nothing needs filling."}</span>
          <div className="grid3" style={{ gap: 8, opacity: misfit ? 1 : 0.5 }}>
            {[{ id: "blur", t: "Blurred", s: "Soft blur around it" }, { id: "crop", t: "Crop", s: "Zoom in, cut the edges" }, { id: "bars", t: "Bars", s: "Plain black around it" }].map((o) => { const on = d.fill === o.id; const pv = clipBox(d.shape === "portrait" ? "landscape" : "portrait", d.shape, o.id); const sh = SHAPES[d.shape]; return (
              <button key={o.id} onClick={() => set({ fill: o.id })} aria-pressed={on} className="stack gap8" style={{ alignItems: "center", padding: "12px 6px 10px", borderRadius: 14, background: on ? "#211F1C" : "#1A1917", border: "1.5px solid " + (on ? "var(--accent)" : "var(--line)"), color: "var(--fg)" }}>
                <span style={{ height: 50, display: "flex", alignItems: "center" }}><span style={{ position: "relative", width: sh.w, height: sh.h, borderRadius: 4, overflow: "hidden", background: o.id === "bars" ? "#000" : "linear-gradient(180deg,#56788A,#3F5B6B 50%,#56788A)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {o.id === "blur" ? <span style={{ position: "absolute", inset: 0, backdropFilter: "blur(2px)", background: "rgba(40,60,70,0.35)" }} /> : null}
                  <span style={pv.inset ? { position: "absolute", inset: 0, background: "linear-gradient(135deg,#C98A4B,#6B5268)" } : { position: "relative", width: pv.w, height: pv.h, background: "linear-gradient(135deg,#C98A4B,#6B5268)" }} />
                </span></span>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{o.t}</span><span className="tiny muted" style={{ textAlign: "center", lineHeight: 1.3 }}>{o.s}</span>
              </button>); })}
          </div>
        </Section>
        <Section title="Clip length" right={syncActive ? <span style={{ color: "var(--accent)" }}>Beat sync is setting this</span> : null} style={{ opacity: syncActive ? 0.45 : 1 }}>
          <Choice active={d.clipMode === "trimmed"} onClick={() => set({ clipMode: "trimmed" })} title="Use each clip's trimmed length" desc="Whatever you picked at capture" />
          <div className="stack gap12" style={{ padding: "13px 14px", borderRadius: 14, background: d.clipMode === "cap" ? "#211F1C" : "#1A1917", border: "1.5px solid " + (d.clipMode === "cap" ? "var(--accent)" : "var(--line)") }}>
            <button onClick={() => set({ clipMode: "cap" })} className="hrow gap12" style={{ background: "none", border: "none", padding: 0, color: "var(--fg)", textAlign: "left" }}><span className={"radio" + (d.clipMode === "cap" ? " on" : "")} /><span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 600 }}>Cap each clip</span><span className="small muted">Even rhythm, cut from each clip's start</span></span></button>
            <div style={{ paddingLeft: 32 }}><Opts value={d.clipMode === "cap" ? d.cap : null} onChange={(v) => set({ clipMode: "cap", cap: v })} options={[0.5, 1, 2, 3].map((c) => ({ id: c, label: c + "s" }))} /></div>
          </div>
        </Section>
        <Section title="Text"><TextCard d={d} set={set} db={db} me={me} /></Section>
        {x && x.shared ? <div className="card"><ToggleRow title="Share with project" sub={"Everyone in " + x.p.name + " can watch it. Off keeps it private to you."} on={d.shared} onChange={(v) => set({ shared: v })} /></div> : null}

        <div className="stack gap12">
          <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Music · tracklist</span>{d.tracks.length > 1 ? <span className="small faint">Drag ⠿ to reorder</span> : null}</div>
          {d.tracks.map((tr, i) => {
            const t = S.track(db, tr.trackId); if (!t) return null;
            const tl = timeline[i]; const open = menu === i;
            return (
              <div key={tr.trackId + i} style={Object.assign({ borderRadius: 14, background: "var(--surface)", border: "1px solid " + (open ? "var(--accent)" : "var(--line)"), opacity: musicOn ? (tl.reached ? 1 : 0.6) : 0.45 }, dragged.rowStyle(i))}>
                <div className="hrow gap10" style={{ alignItems: "flex-start", padding: "12px 12px 12px 6px" }}>
                  <span {...dragged.handleProps(i)} aria-label={"Drag to reorder " + t.title} style={Object.assign({ width: 22, height: 26, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ghost)" }, dragged.handleProps(i).style)}><Icon name="drag" size={16} /></span>
                  <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>{i + 1}</span>
                  <span className="stack gap6" style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
                    <span className="ellipsis" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{t.title}</span>
                    <span className="hrow wrap gap8"><span className="tag num" style={{ fontSize: 11, padding: "3px 8px", background: tl.reached ? "var(--accent-soft)" : "var(--raised)", color: tl.reached ? "var(--accent)" : "var(--faint)" }}>{tl.reached ? fmtDur(tl.a) + " – " + fmtDur(Math.min(tl.b, secs)) : "Not reached"}</span><span style={{ fontSize: 11.5, fontWeight: 600, color: "#BDB7AD" }}>{t.bpm} BPM</span></span>
                    <span className="small muted">Starts at {fmtDur(tr.start)} · fade in {tr.fadeIn}s, out {tr.fadeOut}s</span>
                  </span>
                  <button className="iconbtn plain sq" style={{ width: 30, height: 30, background: open ? "#2A2825" : "transparent" }} aria-label={"Options for " + t.title} onClick={() => setMenu(open ? null : i)}><Icon name="more" size={16} color="var(--muted)" /></button>
                </div>
                {!tl.reached && musicOn ? <div className="small faint" style={{ padding: "0 14px 12px 64px" }}>The mash ends before this track starts, so it won't be heard.</div> : null}
                {open ? <div style={{ margin: "0 10px 10px" }}><Menu items={[
                  { label: "Start point & fades", icon: "scissors", onClick: () => { setMenu(null); nav.go("trackSection", { index: i }); } },
                  { label: "Move up", icon: "chevR", disabled: i === 0, onClick: () => { set({ tracks: move(d.tracks, i, i - 1) }); setMenu(i - 1); } },
                  { label: "Move down", icon: "chevD", disabled: i === d.tracks.length - 1, onClick: () => { set({ tracks: move(d.tracks, i, i + 1) }); setMenu(i + 1); } },
                  { label: "Remove from tracklist", icon: "trash", danger: true, onClick: () => { set({ tracks: d.tracks.filter((_, j) => j !== i) }); setMenu(null); } }
                ]} /></div> : null}
              </div>
            );
          })}
          {!d.tracks.length ? <div className="small muted" style={{ padding: 14, borderRadius: 14, border: "1.5px dashed var(--line-strong)", textAlign: "center" }}>No music. The mash will use clip sound only.</div> : null}
          <button className="btn dashed" onClick={() => setPicker(true)}><Icon name="music" size={15} />{d.tracks.length ? "Add another track" : "Add music"}</button>
          {d.tracks.length ? (
            <>
              <div className="card hrow between gap12">
                <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 600 }}>Crossfade between tracks</span><span className="small muted">{d.tracks.length > 1 ? (syncActive ? "Switches on a beat" : "Blends one track into the next") : "Used when you add a second track"}</span></span>
                <span className="hrow gap8"><button className="chipbtn" style={{ width: 30, padding: "5px 0" }} aria-label="Shorter crossfade" onClick={() => set({ crossfade: Math.max(0, d.crossfade - 1) })}>−</button><span className="num" style={{ minWidth: 28, textAlign: "center", fontWeight: 700 }}>{d.crossfade}s</span><button className="chipbtn" style={{ width: 30, padding: "5px 0" }} aria-label="Longer crossfade" onClick={() => set({ crossfade: Math.min(8, d.crossfade + 1) })}>+</button></span>
              </div>
              <div className="card stack gap10">
                <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 600 }}>If the music runs out first</span><span className="small muted">Music lasts {fmtDur(musicTotal)}, the mash {fmtDur(secs)}{musicTotal >= secs ? ". Music fades out with the mash." : "."}</span></span>
                {seg([{ id: "loop", label: "Loop tracklist" }, { id: "fade", label: "Fade out" }], d.whenEnds, "whenEnds")}
              </div>
            </>
          ) : null}
        </div>
        <Section title="Sound">
          <div className="card stack gap12">
            {seg([{ id: "both", label: "Both" }, { id: "music", label: "Music only" }, { id: "clips", label: "Clip sound" }], d.audio, "audio")}
            <span className="small muted">{d.audio === "both" ? "Music plays under each clip's own sound." : d.audio === "music" ? "Clips are muted; only the tracklist plays." : "Tracklist is ignored; each clip keeps its own sound."}</span>
            {d.audio === "both" ? <div className="stack gap6"><div className="hrow between" style={{ fontSize: 12.5 }}><label htmlFor="music-level" style={{ fontWeight: 600 }}>Music level under clips</label><span className="num" style={{ fontWeight: 700, color: "var(--accent)" }}>{d.level}%</span></div><input id="music-level" className="range" type="range" min="0" max="100" step="5" value={d.level} onChange={(e) => set({ level: +e.target.value })} /></div> : null}
          </div>
        </Section>
        <Section title="Beat sync" right={musicOn ? "Timed to " + t0.title + " · " + t0.bpm + " BPM" : "Needs a track"} style={{ opacity: musicOn ? 1 : 0.45 }}>
          <div className="card stack gap12">
            {seg([{ id: "off", label: "Off" }, { id: "fixed", label: "Fixed" }, { id: "auto", label: "Rounded" }], d.sync, "sync")}
            <span className="small muted" style={{ lineHeight: 1.4 }}>{d.sync === "off" ? "Cuts follow your clip length setting above." : d.sync === "fixed" ? "Every clip lasts exactly the same number of beats." : "Each clip keeps roughly its trimmed length, rounded to the nearest beat (at least one)."}</span>
            {d.sync !== "off" ? <div style={{ paddingTop: 4, borderTop: "1px solid var(--line-soft)" }}><div style={{ height: 8 }} /><ToggleRow title="Let clips stretch slightly past your trim" sub={d.stretch !== false ? "Up to half a beat (max 0.5s) of extra footage so each cut lands on the beat. Your start point never moves." : "Clips only get shorter to hit the beat. Footage outside your handles is never used."} on={d.stretch !== false} onChange={(v) => set({ stretch: v })} /></div> : null}
            {d.sync === "fixed" ? <Opts value={d.beats} onChange={(v) => set({ beats: v })} options={[{ id: 1, label: "1 beat", sub: beatLen.toFixed(2) + "s" }, { id: 2, label: "2 beats", sub: (beatLen * 2).toFixed(2) + "s" }, { id: 4, label: "1 bar", sub: (beatLen * 4).toFixed(2) + "s" }]} /> : null}
          </div>
        </Section>
        <Section title="Quality" right={d.quality === (db.server.mashQuality || "high") ? "Server default" : null}>
          <div className="card stack gap12">
            <Opts value={d.quality} onChange={(v) => set({ quality: v })} options={Object.keys(QUALITY).map((k) => ({ id: k, label: QUALITY[k].label, sub: QUALITY[k].audioKbps + " kbps" }))} />
            <span className="small muted" style={{ lineHeight: 1.4 }}>{QUALITY[d.quality].hint}. Audio is AAC at up to {QUALITY[d.quality].audioKbps} kbps; simpler sound uses less.</span>
          </div>
        </Section>
        <div style={{ height: 4 }} />
      </div>
      <div className="stack gap10" style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0, borderTop: "1px solid #211F1D" }}>
        <div className="hrow between small muted"><span>Estimated length <strong className="num" style={{ color: "var(--fg)" }}>{fmtDur(secs)}</strong></span><span>{resOf(db, d.shape)} · {QUALITY[d.quality].label}</span></div>
        <button className="btn" disabled={rendering || !picked.length} onClick={render}><Icon name="mash" size={16} />{rendering ? "Starting…" : d.remashOf ? "Render re-mash" : "Render mash"}</button>
      </div>
      </div>
      <MusicPicker open={picker} onClose={() => setPicker(false)} list={d.tracks.map((t) => t.trackId)} bpm={t0 ? t0.bpm : 96} onAdd={(id) => { const t = S.track(db, id); set({ tracks: d.tracks.concat([{ trackId: id, start: 0, fadeIn: d.tracks.length ? 0 : 1, fadeOut: 2 }]) }); toast(t.title + " added as track " + (d.tracks.length + 1)); }} />
    </Screen>
  );
}


export function TrackSection({ params }) {
  const { db, nav, mashDraft, setMashDraft, me } = useApp();
  const pv = usePreview();
  const d = mashDraft;
  const i = params.index || 0;
  const tr = d && d.tracks[i];
  const t = tr && S.track(db, tr.trackId);
  if (!t) return <Screen><TopBar title="Track" /></Screen>;
  const { picked } = selection(db, d);
  const secs = estimate(db, d, picked);
  const dur = t.duration, beat = 60 / t.bpm, offset = 0.18;
  const segLen = Math.min(secs, dur);
  const snap = tr.snap !== false;
  const setTr = (o) => { const tracks = d.tracks.slice(); tracks[i] = Object.assign({}, tr, o); setMashDraft(Object.assign({}, d, { tracks })); };
  const snapT = (x) => (snap ? offset + Math.round((x - offset) / beat) * beat : x);
  const clampT = (x) => Math.max(0, Math.min(Math.max(0, dur - 1), x));
  const start = tr.start, end = Math.min(dur, start + segLen);
  // Preview plays the real track from the chosen start, for as long as it plays in the mash.
  const preview = pv.playing === t.id;
  const ph = preview ? Math.max(0, pv.pos - start) : 0;
  const n = 84, per = dur / n, real = barsFrom(t.peaks, n), bars = real.length ? real : Array.from({ length: n }, () => 0.12);
  const fmt = (x) => { const m = Math.floor(x / 60); const s = x - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
  const W = 320, H = 44, xIn = Math.max(0.001, tr.fadeIn / Math.max(1, segLen)) * W, xOut = W - Math.max(0.001, tr.fadeOut / Math.max(1, segLen)) * W;
  return (
    <Screen>
      <TopBar title={t.title} sub={"Track " + (i + 1) + " · plays " + fmtDur(0) + " – " + fmtDur(segLen) + " of the mash"} />
      <div className="scroll pad stack gap24" style={{ paddingTop: 24 }}>
        <div>
          <div className="hrow between" style={{ alignItems: "baseline", marginBottom: 10 }}><span className="sec">Start from</span><span className="small muted">Tap the waveform</span></div>
          <div style={{ position: "relative" }}>
            <div className="hrow" style={{ gap: 1, height: 72 }}>
              {bars.map((v, k) => { const tt = k * per; const inSel = tt + per > start && tt < end; const fade = inSel && ((tr.fadeIn && tt < start + tr.fadeIn) || (tr.fadeOut && tt > end - tr.fadeOut)); return (
                <button key={k} aria-label={"Start at " + fmt(tt)} onClick={() => { const s2 = clampT(snapT(tt)); setTr({ start: s2 }); if (preview) pv.seek(t, s2, Math.min(dur, s2 + segLen), tr); }} style={{ flex: 1, height: "100%", padding: 0, border: "none", background: "transparent", display: "flex", alignItems: "center" }}><span style={{ width: "100%", height: Math.max(6, Math.round(v * 100)) + "%", borderRadius: 1, background: inSel ? "var(--accent)" : "var(--line-strong)", opacity: fade ? 0.45 : 1 }} /></button>); })}
            </div>
            <div style={{ position: "absolute", top: -6, bottom: -6, left: (start / dur * 100) + "%", width: 2, marginLeft: -1, background: "var(--fg)", pointerEvents: "none" }} />
            {preview ? <div style={{ position: "absolute", top: 0, bottom: 0, left: ((start + ph) / dur * 100) + "%", width: 2, background: "#fff", opacity: 0.7, pointerEvents: "none" }} /> : null}
          </div>
          <div className="hrow between tiny" style={{ marginTop: 8, color: "var(--ghost)" }}>{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{fmtDur(dur * f)}</span>)}</div>
        </div>
        <div className="hrow gap14 card">
          <button aria-label={preview ? "Stop preview" : "Preview section"} onClick={() => (preview ? pv.toggle(t) : pv.seek(t, start, end, tr))} style={{ width: 46, height: 46, flexShrink: 0, borderRadius: "50%", background: "var(--accent)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)" }}><Icon name={preview ? "pause" : "play"} size={18} /></button>
          <span className="stack gap2" style={{ flex: 1 }}><span className="num" style={{ fontSize: 22, fontWeight: 700 }}>From {fmt(start)}</span><span className="small muted">Plays to {fmt(end)} · {snap ? "on beat " + (Math.round((start - offset) / beat) + 1) : "free position"}</span></span>
          <button className="chipbtn" style={{ width: 34, padding: "7px 0" }} aria-label="One beat earlier" onClick={() => setTr({ start: clampT(start - beat) })}>‹</button>
          <button className="chipbtn" style={{ width: 34, padding: "7px 0" }} aria-label="One beat later" onClick={() => setTr({ start: clampT(start + beat) })}>›</button>
        </div>
        <div className="card"><ToggleRow title="Snap start to the beat" sub={t.bpm + " BPM · one beat is " + beat.toFixed(2) + "s"} on={snap} onChange={(v) => setTr({ snap: v, start: v ? clampT(snapT(start)) : start })} /></div>
        <div className="stack gap14">
          <span className="sec">Fades</span>
          <div className="card" style={{ padding: "12px 14px" }}>
            <svg viewBox={"0 0 " + W + " " + H} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true"><polygon points={"0," + H + " " + xIn.toFixed(1) + ",4 " + xOut.toFixed(1) + ",4 " + W + "," + H} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" /></svg>
            <div className="hrow between tiny faint" style={{ marginTop: 6 }}><span>Section start</span><span>Mash end · {fmtDur(segLen)}</span></div>
          </div>
          <div className="stack gap8"><span style={{ fontSize: 13, fontWeight: 600 }}>Fade in</span><Opts value={tr.fadeIn} onChange={(v) => setTr({ fadeIn: v })} options={[0, 1, 2, 3].map((v) => ({ id: v, label: v ? v + "s" : "None" }))} /></div>
          <div className="stack gap8"><span style={{ fontSize: 13, fontWeight: 600 }}>Fade out</span><Opts value={tr.fadeOut} onChange={(v) => setTr({ fadeOut: v })} options={[0, 2, 4, 6].map((v) => ({ id: v, label: v ? v + "s" : "None" }))} /></div>
        </div>
        <div style={{ height: 8 }} />
      </div>
      <div style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}><button className="btn" onClick={nav.back}>Done</button></div>
    </Screen>
  );
}

export function MashLibrary() {
  const { db, act, local, refresh, nav, me, toast, setMashDraft } = useApp();
  const [menu, setMenu] = useState(null);
  const [del, setDel] = useState(null);
  const [stop, setStop] = useState(null);
  const mine = db.mashes.filter((m) => m.ownerId === me.id).sort((a, b) => b.createdAt - a.createdAt);
  const busy = mine.filter((m) => m.status !== "ready");
  const ready = mine.filter((m) => m.status === "ready");
  const myProjectIds = new Set(S.myProjects(db, me.id).map((x) => x.p.id));
  const sharedWithMe = db.mashes.filter((m) => m.ownerId !== me.id && m.shared && m.status === "ready" && myProjectIds.has(m.projectId)).sort((a, b) => b.createdAt - a.createdAt);
  const size = ready.reduce((a, m) => a + S.mashSize(m), 0);
  // Deleted after a short pause, so Undo can still save it.
  const remove = (m) => {
    setMenu(null);
    local((n) => { n.mashes = n.mashes.filter((x) => x.id !== m.id); });
    const t = setTimeout(() => act("deleteMash", { mashId: m.id }, { noRefresh: true }).catch(() => refresh()), 6500);
    toast("Mash deleted", { label: "Undo", run: () => { clearTimeout(t); refresh(); } });
  };
  const Card = ({ m, other }) => {
    const sh = SHAPES[m.shape];
    const open = menu === m.id;
    const first = S.entry(db, m.entryIds[0]);
    const md = first ? S.media(db, first.mediaId) : null;
    const p = S.project(db, m.projectId);
    const by = S.user(db, m.ownerId);
    const tw = m.shape === "landscape" ? 64 : m.shape === "square" ? 50 : 34, th = m.shape === "landscape" ? 36 : m.shape === "square" ? 50 : 60;
    return (
      <div style={{ borderRadius: 16, background: "var(--surface)", border: "1px solid " + (open ? "var(--accent)" : "var(--line)") }}>
        <div className="hrow gap14" style={{ padding: "12px 8px 12px 12px" }}>
          <button onClick={() => nav.go("player", { mashId: m.id })} aria-label={"Play " + m.title} style={{ width: 76, height: 76, flexShrink: 0, borderRadius: 10, background: "#0E0E0D", border: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Thumb m={m.poster ? { thumb: m.poster, grad: "#222" } : md} style={{ width: tw, height: th, borderRadius: 6 }}><PlayBadge size={22} /></Thumb>
          </button>
          <button onClick={() => nav.go("player", { mashId: m.id })} className="stack gap4" style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, color: "inherit", textAlign: "left" }}>
            <span className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{m.title}</span>
            <span className="small" style={{ color: "#BDB7AD" }}>{fmtDur(m.status === "ready" && m.duration ? m.duration : S.mashLength(db, m))} · {sh.label} · {FILLS[m.fill] || "Blurred fill"}</span>
            <span className="hrow gap8 wrap">
              <span className="small faint">{other ? "by " + S.firstName(by) + " · " + (p ? p.name : "") : "Made " + shortDate(m.createdAt)}</span>
              {m.remashOf ? <span className="tag"><Icon name="refresh" size={10} />Re-mashed</span> : null}
              {!other && m.shared ? <span className="tag ok">Shared</span> : null}
            </span>
          </button>
          {!other ? <button className="iconbtn plain sq" style={{ width: 32, height: 32, alignSelf: "flex-start", background: open ? "#2A2825" : "transparent" }} aria-label={"Options for " + m.title} aria-expanded={open} onClick={() => setMenu(open ? null : m.id)}><Icon name="more" size={16} color="var(--muted)" /></button> : null}
        </div>
        {open ? <div style={{ margin: "0 10px 10px" }}><Menu items={[
          { label: "Re-mash", icon: "refresh", onClick: () => { setMenu(null); setMashDraft(null); nav.go("mash1", { remashOf: m.id }); } },
          { label: "Rename", icon: "edit", onClick: () => { setMenu(null); nav.go("player", { mashId: m.id, rename: true }); } },
          { label: "Download", icon: "download", onClick: () => { setMenu(null); toast("The real app saves “" + m.title + "” as an MP4 here"); } },
          p && S.activeMembers(db, p.id).length > 1 ? { label: m.shared ? "Make private" : "Share with " + p.name, icon: "share", onClick: () => { setMenu(null); act("setMashShared", { mashId: m.id, shared: !m.shared }).then(() => toast(m.shared ? "Now private to you" : "Shared with " + p.name)).catch(() => {}); } } : null,
          "-",
          { label: "Delete", icon: "trash", danger: true, onClick: () => { setMenu(null); setDel(m); } }
        ]} /></div> : null}
      </div>
    );
  };
  return (
    <Screen tab="mash">
      <div className="hrow between" style={{ padding: "22px 20px 16px", flexShrink: 0 }}>
        <div className="stack gap2"><span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Mash</span><span className="small muted">{ready.length} saved · {gb(size)}</span></div>
        <div className="hrow gap8">
          <button className="iconbtn" style={{ width: 40, height: 40 }} aria-label="Music library" onClick={() => nav.go("music")}><Icon name="music" size={18} color="var(--muted)" /></button>
          <button className="pill" onClick={() => { setMashDraft(null); nav.go("mash1", {}); }}><Icon name="plus" size={14} stroke={2.6} />New mash</button>
        </div>
      </div>
      <div className="scroll pad stack gap22" style={{ gap: 22 }}>
        {busy.length ? (
          <Section title="Rendering">
            {busy.map((m) => {
              const first = S.entry(db, m.entryIds[0]); const md = first ? S.media(db, first.mediaId) : null;
              const left = Math.max(2, Math.round((100 - m.progress) / 3.5 * 0.5));
              return (
                <div key={m.id} className="hrow gap14 card">
                  <Thumb m={md} style={{ width: 48, height: 76, borderRadius: 9 }}><div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="refresh" size={18} color="var(--fg)" /></div></Thumb>
                  <div className="stack gap6" style={{ flex: 1, minWidth: 0 }}>
                    <span className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{m.title}</span>
                    <div className="bar"><span style={{ width: m.progress + "%" }} /></div>
                    <div className="hrow between small muted"><span className="num">{m.status === "queued" ? "Waiting in queue" : (m.progress < 70 ? "Joining clips… " : m.progress < 92 ? "Adding music… " : "Finishing… ") + Math.round(m.progress) + "%"}</span><span>{m.status === "queued" ? "" : "about " + left + "s left"}</span></div>
                  </div>
                  <button className="iconbtn plain" aria-label={"Cancel " + m.title} onClick={() => setStop(m)}><Icon name="close" size={16} color="var(--muted)" /></button>
                </div>
              );
            })}
          </Section>
        ) : null}
        <Section title="Saved">
          {ready.map((m) => <Card key={m.id} m={m} />)}
          {!ready.length ? <div className="stack gap10" style={{ alignItems: "center", textAlign: "center", padding: "28px 18px", borderRadius: 16, border: "1.5px dashed var(--line-strong)" }}><Icon name="mash" size={26} color="var(--faint)" /><span style={{ fontSize: 14, fontWeight: 700 }}>No mashes yet</span><span className="small muted" style={{ maxWidth: 240, lineHeight: 1.4 }}>Turn a week, a month or a whole project into one short film.</span><button className="pill" onClick={() => { setMashDraft(null); nav.go("mash1", {}); }}>Make your first mash</button></div> : null}
        </Section>
        {sharedWithMe.length ? <Section title="Shared in your projects">{sharedWithMe.map((m) => <Card key={m.id} m={m} other />)}</Section> : null}
        <div style={{ height: 16 }} />
      </div>
      <Confirm open={!!del} onClose={() => setDel(null)} title={del ? "Delete “" + del.title + "”?" : ""} body={del ? "Frees " + Math.round(S.mashSize(del) / 1e6) + " MB. Your clips stay, so you can always render it again." : ""} confirm="Delete" danger onConfirm={() => { const m = del; setDel(null); remove(m); }} />
      <Confirm open={!!stop} onClose={() => setStop(null)} title={stop ? "Cancel “" + stop.title + "”?" : ""} body={stop ? (stop.status === "rendering" ? "It's " + Math.round(stop.progress || 0) + "% done. " : "") + "Your clips and settings aren't lost: you can start the mash again any time." : ""} confirm="Cancel render" cancel="Keep rendering" danger onConfirm={() => { const m = stop; setStop(null); act("deleteMash", { mashId: m.id }).then(() => toast("Render cancelled")).catch(() => {}); }} />
    </Screen>
  );
}

export function MashPlayer({ params }) {
  const { db, act, local, refresh, nav, me, toast, setMashDraft } = useApp();
  const m = S.mash(db, params.mashId);
  const [renaming, setRenaming] = useState(!!params.rename);
  const [draft, setDraft] = useState(m ? m.title : "");
  const [confirm, setConfirm] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const vref = useRef(null);
  if (!m) return <Screen><TopBar title="Mash" /><div className="small faint" style={{ padding: 40, textAlign: "center" }}>This mash was deleted.</div></Screen>;
  const es = m.entryIds.map((id) => S.entry(db, id)).filter(Boolean);
  const mine = m.ownerId === me.id;
  const p = S.project(db, m.projectId);
  const by = S.user(db, m.ownerId);
  const sh = SHAPES[m.shape] || SHAPES.portrait;
  const ready = m.status === "ready" && m.src;
  const total = ready ? m.duration : S.mashLength(db, m);
  const trimmed = draft.trim();
  const box = m.shape === "landscape" ? { w: 330, h: 186 } : m.shape === "square" ? { w: 290, h: 290 } : { w: 236, h: 420 };
  const saveName = async () => {
    if (!trimmed || trimmed === m.title) return;
    const prev = m.title;
    try { await act("renameMash", { mashId: m.id, title: trimmed }); } catch (e) { return; }
    setRenaming(false);
    toast("Renamed to “" + trimmed + "”", { label: "Undo", run: () => act("renameMash", { mashId: m.id, title: prev }).catch(() => {}) });
  };
  const first = es[0], last = es[es.length - 1];
  const play = () => { const v = vref.current; if (!v) return; const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); };
  return (
    <Screen>
      <div className="hrow between" style={{ padding: "20px 20px 12px", flexShrink: 0 }}>
        <button className="iconbtn" aria-label="Back" onClick={nav.back}><Icon name="back" size={17} stroke={2.2} /></button>
        <span className="small muted">{mine ? "Created " + shortDate(m.createdAt) : "Made by " + S.firstName(by) + " · " + rel(m.createdAt)}</span>
      </div>
      <div className="scroll">
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
          <div style={{ position: "relative", width: box.w, height: box.h, maxWidth: "calc(100% - 40px)", borderRadius: 18, overflow: "hidden", background: "#000", opacity: renaming ? 0.45 : 1 }}>
            {ready ? (
              <>
                <video ref={vref} src={m.src} poster={m.poster || undefined} playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                <button aria-label={playing ? "Pause" : "Play"} onClick={() => (playing ? vref.current && vref.current.pause() : play())} style={{ position: "absolute", inset: 0, background: "transparent", border: "none" }}>
                  {!playing ? <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 60, height: 60, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", color: "#F2EFE9" }}><Icon name="play" size={22} /></span> : null}
                </button>
              </>
            ) : (
              <div className="stack gap10" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center", background: m.poster ? "url(" + m.poster + ") center/cover" : "linear-gradient(160deg,#2A2825,#161513)" }}>
                {m.status === "ready" ? (
                  <>
                    <Icon name="alert" size={26} color="#F0A49C" />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>The video file is missing</span>
                    <span className="small muted" style={{ lineHeight: 1.4 }}>It may have been removed from storage. Re-mash to make it again.</span>
                  </>
                ) : m.status === "failed" ? (
                  <>
                    <Icon name="alert" size={26} color="#F0A49C" />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>This mash couldn't be rendered</span>
                    <span className="small muted" style={{ lineHeight: 1.4 }}>{m.error || "Something went wrong."}</span>
                    {mine ? <button className="chipbtn" onClick={() => act("retryMash", { mashId: m.id }).then(() => toast("Trying again")).catch(() => {})}>Try again</button> : null}
                  </>
                ) : (
                  <>
                    <Icon name="mash" size={26} color="var(--accent)" />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{m.status === "queued" ? "Waiting to render" : "Rendering · " + Math.round(m.progress) + "%"}</span>
                    <div style={{ width: "70%", height: 4, borderRadius: 2, background: "var(--line)" }}><div style={{ width: m.progress + "%", height: 4, borderRadius: 2, background: "var(--accent)", transition: "width .4s" }} /></div>
                    <span className="small muted">We'll let you know when it's ready.</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {ready ? (
          <div style={{ padding: "16px 28px 0", opacity: renaming ? 0.45 : 1 }}>
            <div style={{ position: "relative", height: 4, borderRadius: 2, background: "var(--line-soft)", cursor: "pointer" }} onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); const v = vref.current; if (v && total) v.currentTime = (ev.clientX - r.left) / r.width * total; }}>
              <div style={{ width: (total ? Math.min(100, (t / total) * 100) : 0) + "%", height: "100%", borderRadius: 2, background: "var(--accent)" }} />
            </div>
            <div className="hrow between tiny muted num" style={{ marginTop: 8 }}><span>{fmtDur(t)}</span><span>{fmtDur(total)}</span></div>
          </div>
        ) : null}
        <div className="pad stack gap8" style={{ paddingTop: 14 }}>
          {!renaming ? (
            <button onClick={() => mine && setRenaming(true)} aria-label={mine ? "Rename mash" : undefined} className="hrow gap8" style={{ background: "none", border: "none", padding: 0, color: "var(--fg)", textAlign: "left" }}>
              <span style={{ fontSize: 19, fontWeight: 700 }}>{m.title}</span>{mine ? <Icon name="edit" size={15} color="var(--muted)" /> : null}
            </button>
          ) : (
            <div className="stack gap8">
              <div className="hrow between" style={{ alignItems: "baseline" }}><label className="sec" htmlFor="mash-name">Rename mash</label><span className="tiny" style={{ color: draft.length >= 50 ? "var(--accent)" : "var(--ghost)" }}>{draft.length}/60</span></div>
              <div className="hrow gap10" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface)", border: "1.5px solid " + (trimmed ? "var(--accent)" : "var(--danger)") }}>
                <input id="mash-name" autoFocus maxLength={60} value={draft} onChange={(ev) => setDraft(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") saveName(); if (ev.key === "Escape") { setRenaming(false); setDraft(m.title); } }} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 17, fontWeight: 700 }} />
                {draft ? <button aria-label="Clear name" onClick={() => setDraft("")} style={{ width: 22, height: 22, flexShrink: 0, borderRadius: "50%", background: "var(--line-strong)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg)" }}><Icon name="close" size={11} stroke={3} /></button> : null}
              </div>
              <div className="hrow between">
                {!trimmed ? <span className="small" style={{ color: "var(--danger)" }}>Name can't be empty</span> : trimmed !== m.defaultTitle ? <button className="link" style={{ color: "var(--muted)", fontSize: 11.5 }} onClick={() => setDraft(m.defaultTitle)}>Reset to default</button> : <span />}
                <span className="hrow gap8">
                  <button className="chipbtn" onClick={() => { setRenaming(false); setDraft(m.title); }}>Cancel</button>
                  <button className="chipbtn" disabled={!trimmed || trimmed === m.title} onClick={saveName} style={{ background: !trimmed || trimmed === m.title ? "#2A2825" : "var(--accent)", color: !trimmed || trimmed === m.title ? "#6E6962" : "var(--accent-ink)", border: "none", fontWeight: 700 }}>Save</button>
                </span>
              </div>
            </div>
          )}
          <div className="hrow wrap gap6">{[fmtDur(total), sh.label + " " + sh.ratio, FILLS[m.fill] || "Blurred fill", resOf(db, m.shape), qualityName(m.quality), Math.round(S.mashSize(m) / 1e6) + " MB"].map((x) => <span key={x} className="tag" style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "#BDB7AD", fontSize: 11, padding: "3px 9px" }}>{x}</span>)}</div>
          <span className="small muted">{es.length} clips{first ? " · " + rangeText({ from: first.date, to: last.date }) : ""}{m.tracks.length ? " · Music: " + m.tracks.map((tr) => (S.track(db, tr.trackId) || { title: "removed track" }).title).join(", ") : ""}</span>
        </div>
        {mine ? (
          <div className="pad grid4" style={{ paddingTop: 18, gap: 8 }}>
            {[{ l: "Download", i: "download", f: () => { if (ready) download(m.src + (m.src.indexOf("?") >= 0 ? "&" : "?") + "download=1"); else toast("You can download it once it's rendered"); } }, { l: "Re-mash", i: "refresh", f: () => { setMashDraft(null); nav.go("mash1", { remashOf: m.id }); } }, { l: "Rename", i: "edit", f: () => { setRenaming(true); setConfirm(false); } }, { l: "Delete", i: "trash", f: () => { setConfirm(true); setRenaming(false); }, d: true }].map((a) => (
              <button key={a.l} onClick={a.f} className="stack gap6" style={{ alignItems: "center", padding: "12px 0", borderRadius: 14, background: "var(--surface)", border: "1px solid " + (a.l === "Rename" && renaming ? "var(--accent)" : "var(--line)"), color: a.d ? "var(--danger)" : "var(--fg)", fontSize: 12, fontWeight: 600 }}><Icon name={a.i} size={18} color={a.d ? "var(--danger)" : "#BDB7AD"} />{a.l}</button>
            ))}
          </div>
        ) : null}
        {mine && p && S.activeMembers(db, p.id).length > 1 ? <div className="pad" style={{ paddingTop: 12 }}><div className="card"><ToggleRow title={"Share with " + p.name} sub={m.shared ? "Everyone in the project can watch it" : "Only you can see it"} on={m.shared} onChange={(v) => { act("setMashShared", { mashId: m.id, shared: v }).then(() => toast(v ? "Shared with " + p.name : "Now private to you")).catch(() => {}); }} /></div></div> : null}
        {confirm ? (
          <div className="pad" style={{ paddingTop: 12 }}>
            <div className="stack gap12" style={{ padding: 14, borderRadius: 14, background: "rgba(224,120,110,0.08)", border: "1px solid rgba(224,120,110,0.35)" }}>
              <div className="stack gap2"><span style={{ fontSize: 14, fontWeight: 700 }}>Delete this mash?</span><span className="small muted">Frees {Math.round(S.mashSize(m) / 1e6)} MB. Your clips stay, so you can always render it again.</span></div>
              <div className="grid2"><button className="btn sm ghost" onClick={() => setConfirm(false)}>Keep it</button><button className="btn sm danger" onClick={() => { act("deleteMash", { mashId: m.id }).then(() => { toast("Mash deleted"); nav.back(); }).catch(() => {}); }}>Delete</button></div>
            </div>
          </div>
        ) : null}
        <div style={{ height: 26 }} />
      </div>
    </Screen>
  );
}
