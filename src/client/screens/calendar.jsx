import React from "react";
import { useApp } from "../store.jsx";
import { Icon } from "../icons.jsx";
import { Screen, Sheet, Thumb, ClipView, PlayBadge, Avatar, Confirm } from "../ui.jsx";
import { MoodPicker, resolveMood } from "./capture.jsx";
import * as S from "../sel.js";
import { download } from "../platform.js";
import { stampDate } from "../../shared/mash";
import { todayKey, addDays, dayKey, parseKey, MONTH, fullDay, dayLabel, relDay, monthDay, fmtSec, hexA, rel } from "../util.js";

const { useState, useMemo, useRef, useEffect } = React;

// Which project the calendar and grid show. Remembered for the session.
let lastProject = null;
function useCurrentProject(params) {
  const { db, me } = useApp();
  const mine = S.sortProjects(S.myProjects(db, me.id));
  let id = params.projectId || lastProject;
  if (!mine.find((x) => x.p.id === id)) id = mine.length ? mine[0].p.id : null;
  lastProject = id;
  return { cur: mine.find((x) => x.p.id === id), mine };
}

function Switcher({ open, onClose, mine, cur, onPick }) {
  const { nav } = useApp();
  const Row = ({ x }) => {
    const active = cur && x.p.id === cur.p.id;
    return (
      <button onClick={() => onPick(x.p.id)} aria-pressed={active} className="hrow gap12" style={{ width: "100%", padding: 8, borderRadius: 12, background: active ? "#211F1C" : "transparent", border: "none", color: "var(--fg)", textAlign: "left" }}>
        <Thumb m={x.cover} style={{ width: 42, height: 42 }} />
        <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontSize: 14.5, fontWeight: 700 }}>{x.p.name}</span>
          <span className="hrow gap6 small muted"><span className="dot" style={{ background: x.cat.color }} />{x.cat.name}{x.cat.daily ? " · " + x.streak + "-day streak" : ""} · {x.count} entries</span>
        </span>
        {active ? <Icon name="check" size={18} stroke={2.6} color="var(--accent)" /> : null}
      </button>
    );
  };
  const pinned = mine.filter((x) => x.m.pinned), rest = mine.filter((x) => !x.m.pinned);
  return (
    <Sheet open={open} onClose={onClose} title="Switch project">
      <div className="stack gap4">
        {pinned.length ? <span className="sec" style={{ padding: "4px 8px" }}>Pinned</span> : null}
        {pinned.map((x) => <Row key={x.p.id} x={x} />)}
        {rest.length ? <span className="sec" style={{ padding: "10px 8px 4px" }}>Recently active</span> : null}
        {rest.map((x) => <Row key={x.p.id} x={x} />)}
        <button className="btn outline sm" style={{ marginTop: 8 }} onClick={() => { onClose(); nav.go("projects"); }}>Manage projects</button>
      </div>
    </Sheet>
  );
}

function Header({ cur, mine, view, onPick }) {
  const { nav } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hrow between" style={{ padding: "22px 20px 14px", alignItems: "flex-start", flexShrink: 0, gap: 12 }}>
        <div className="stack gap6" style={{ minWidth: 0 }}>
          <button onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={"Switch project. Current: " + cur.p.name} className="hrow gap6" style={{ background: "none", border: "none", padding: 0, color: "var(--fg)", minWidth: 0, textAlign: "left" }}>
            <span className="ellipsis" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>{cur.p.name}</span>
            <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: "50%", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="chevD" size={14} stroke={2.4} color="var(--muted)" /></span>
          </button>
          <span className="hrow gap6" style={{ padding: "3px 9px", borderRadius: 20, border: "1px solid " + cur.cat.color, width: "fit-content" }}>
            <span className="dot" style={{ width: 6, height: 6, background: cur.cat.color }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: cur.cat.color }}>{cur.cat.name.toUpperCase()}</span>
          </span>
        </div>
        <div className="hrow gap4" style={{ background: "var(--surface)", borderRadius: 12, padding: 4 }} role="group" aria-label="View">
          <button className="iconbtn sq" aria-label="Calendar view" aria-pressed={view === "calendar"} style={{ background: view === "calendar" ? "#2A2825" : "transparent", color: view === "calendar" ? "var(--fg)" : "var(--faint)" }} onClick={() => view !== "calendar" && nav.replace("calendar", { projectId: cur.p.id })}><Icon name="calendar" size={18} /></button>
          <button className="iconbtn sq" aria-label="Grid view" aria-pressed={view === "grid"} style={{ background: view === "grid" ? "#2A2825" : "transparent", color: view === "grid" ? "var(--fg)" : "var(--faint)" }} onClick={() => view !== "grid" && nav.replace("grid", { projectId: cur.p.id })}><Icon name="grid" size={18} /></button>
        </div>
      </div>
      <Switcher open={open} onClose={() => setOpen(false)} mine={mine} cur={cur} onPick={(id) => { setOpen(false); onPick(id); }} />
    </>
  );
}

function NoProjects() {
  const { nav } = useApp();
  return (
    <Screen tab="calendar">
      <div className="stack gap12" style={{ padding: 40, textAlign: "center", alignItems: "center", flex: 1, justifyContent: "center" }}>
        <span className="h2">No projects yet</span>
        <span className="muted small">Create a project to start filling your calendar.</span>
        <button className="pill" onClick={() => nav.go("projectEdit", {})}>New project</button>
      </div>
    </Screen>
  );
}

export function Calendar({ params }) {
  const { db, nav, me, setDraft } = useApp();
  const { cur, mine } = useCurrentProject(params);
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [day, setDay] = useState(null);
  // The last day tapped keeps its outline after its panel closes.
  const [chosen, setChosen] = useState(null);
  if (!cur) return <NoProjects />;
  const entries = S.projectEntries(db, cur.p.id);
  const byDay = {};
  entries.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  Object.keys(byDay).forEach((k) => byDay[k].sort((a, b) => a.createdAt - b.createdAt));
  const first = new Date(ym.y, ym.m, 1);
  const startPad = first.getDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(ym.y, ym.m, 1 - startPad + i);
    cells.push({ key: dayKey(d), n: d.getDate(), inMonth: d.getMonth() === ym.m });
  }
  const t = todayKey();
  const monthKey = ym.y + "-" + String(ym.m + 1).padStart(2, "0");
  const monthDays = Object.keys(byDay).filter((k) => k.slice(0, 7) === monthKey).length;
  const shift = (n) => setYm((o) => { const d = new Date(o.y, o.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const isCurMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();
  const future = ym.y > now.getFullYear() || (ym.y === now.getFullYear() && ym.m >= now.getMonth());
  return (
    <Screen tab="calendar">
      <Header cur={cur} mine={mine} view="calendar" onPick={(id) => nav.replace("calendar", { projectId: id })} />
      <div className="scroll">
        <div className="hrow between" style={{ padding: "6px 20px 14px" }}>
          <button className="iconbtn plain sq" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="chevL" size={20} color="var(--muted)" /></button>
          <button onClick={() => { setYm({ y: now.getFullYear(), m: now.getMonth() }); }} style={{ background: "none", border: "none", color: "var(--fg)", fontSize: 16, fontWeight: 600 }}>{MONTH[ym.m]} {ym.y}{!isCurMonth ? <span className="tag accent" style={{ marginLeft: 8, verticalAlign: "middle" }}>Today</span> : null}</button>
          <button className="iconbtn plain sq" aria-label="Next month" onClick={() => shift(1)} disabled={future} style={{ opacity: future ? 0.3 : 1 }}><Icon name="chevR" size={20} color="var(--muted)" /></button>
        </div>
        <div className="cal pad" style={{ marginBottom: 8 }}>{["S", "M", "T", "W", "T", "F", "S"].map((l, i) => <div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--faint)", letterSpacing: "0.04em" }}>{l}</div>)}</div>
        <div className="cal pad">
          {cells.map((c) => {
            const es = byDay[c.key] || [];
            const m = es.length ? S.media(db, es[0].mediaId) : null;
            const isFuture = c.key > t;
            const bg = m && c.inMonth ? (m.thumb ? "url(" + m.thumb + ") center/cover" : m.grad) : undefined;
            return (
              <button key={c.key} disabled={isFuture || !c.inMonth} onClick={() => { setChosen(c.key); if (es.length === 1) nav.go("entry", { entryId: es[0].id }); else setDay(c.key); }} aria-label={fullDay(c.key) + (es.length ? ", " + es.length + " clip" + (es.length > 1 ? "s" : "") : "")} className={"day" + (c.inMonth ? "" : " out") + (es.length && c.inMonth ? " has" : "") + (c.key === t ? " today" : "") + (c.key === chosen ? " sel" : "")} style={{ background: bg, opacity: isFuture && c.inMonth ? 0.45 : 1, cursor: isFuture || !c.inMonth ? "default" : "pointer" }}>
                <span className="n">{c.n}</span>
                {es.length > 1 && c.inMonth ? <span className="count">{es.length}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="pad" style={{ marginTop: 18 }}>
          {cur.cat.daily ? (
            <div className="hrow gap12 card">
              <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="flame" size={18} color="var(--accent)" /></span>
              <span className="stack gap2">
                <span style={{ fontSize: 14, fontWeight: 700 }}>{cur.streak ? cur.streak + " day streak" : "No streak yet"}</span>
                <span className="small muted">{cur.streak ? (byDay[t] ? "Today's in. You're on a roll" : "Film something today to keep it going") : "Film today to start one"}{cur.shared ? " · counts anyone's clips" : ""}</span>
              </span>
            </div>
          ) : (
            <div className="hrow gap12 card">
              <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="calendar" size={18} color="var(--muted)" /></span>
              <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 700 }}>{monthDays} {monthDays === 1 ? "day" : "days"} with clips this month</span><span className="small muted">{cur.cat.name} project · no streak to keep</span></span>
            </div>
          )}
        </div>
        <div style={{ height: 16 }} />
      </div>
      <DaySheet day={day} setDay={setDay} cur={cur} byDay={byDay} />
    </Screen>
  );
}

function DaySheet({ day, setDay, cur, byDay }) {
  const { db, nav, me, setDraft } = useApp();
  if (!day) return null;
  const es = byDay[day] || [];
  const t = todayKey();
  const start = S.projectStart(db, cur.p.id);
  const missed = !es.length && cur.cat.daily && day < t && !!start && day >= start;
  const add = () => { setDraft({ date: day, presetProjectId: cur.p.id, returnTo: "calendar" }); setDay(null); nav.go("capture"); };
  return (
    <Sheet open onClose={() => setDay(null)} title={fullDay(day).replace(/ (\d{4})$/, (m, y) => (+y === new Date().getFullYear() ? "" : " " + y))} right={
      <div className="hrow gap6">
        <button className="iconbtn sq" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))} style={{ background: "#1F1E1B", border: "1px solid var(--line)" }}><Icon name="chevL" size={16} /></button>
        <button className="iconbtn sq" aria-label="Next day" disabled={day >= t} onClick={() => setDay(addDays(day, 1))} style={{ background: "#1F1E1B", border: "1px solid var(--line)", opacity: day >= t ? 0.35 : 1 }}><Icon name="chevR" size={16} /></button>
      </div>}>
      <div className="stack gap10">
        <span className="small muted">{cur.p.name} · {es.length ? es.length + (es.length === 1 ? " entry" : " entries") : missed ? "missed day" : "no clips"}</span>
        {es.map((e) => {
          const c = S.clipOf(db, e);
          const author = S.user(db, e.authorId);
          const also = db.entries.filter((x) => x.mediaId === e.mediaId && x.id !== e.id && S.membership(db, x.projectId, me.id)).map((x) => S.project(db, x.projectId).name);
          return (
            <button key={e.id} onClick={() => { setDay(null); nav.go("entry", { entryId: e.id }); }} className="hrow gap14" style={{ alignItems: "flex-start", padding: 12, borderRadius: 16, background: "#1F1E1B", border: "1px solid var(--line)", color: "inherit", textAlign: "left" }}>
              <Thumb m={c.m} style={{ width: 84, height: 112, borderRadius: 11 }}><PlayBadge /><span style={{ position: "absolute", left: 5, bottom: 5, padding: "1px 5px", borderRadius: 5, background: "rgba(0,0,0,0.5)", fontSize: 9.5, fontWeight: 700 }}>{c.len.toFixed(1)}s</span></Thumb>
              <span className="stack gap6" style={{ flex: 1, minWidth: 0 }}>
                <span className="small muted">{new Date(e.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{e.authorId !== me.id ? " · " + S.firstName(author) : ""}</span>
                {e.note ? <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>{e.note}</span> : null}
                {e.mood ? <span className="tag" style={{ fontSize: 11.5, padding: "3px 9px", width: "fit-content", color: "#BDB7AD" }}><span className="dot" style={{ background: S.moodColor(db, e.authorId, e.mood) }} />{e.mood}</span> : null}
                {also.length ? <span className="small faint">Also in {also.join(", ")}</span> : null}
              </span>
            </button>
          );
        })}
        {missed ? <span className="small faint" style={{ padding: "6px 2px", lineHeight: 1.45 }}>Nothing filmed this day. Got a clip from it on your phone? Add it now and it counts toward the streak.</span> : null}
        {day <= t ? <button className="btn dashed" onClick={add}><Icon name="plus" size={15} stroke={2.4} />{es.length ? "Add another clip to this day" : "Add a clip to this day"}</button> : null}
      </div>
    </Sheet>
  );
}

export function Grid({ params }) {
  const { db, nav, me } = useApp();
  const { cur, mine } = useCurrentProject(params);
  const [oldest, setOldest] = useState(false);
  if (!cur) return <NoProjects />;
  const es = S.projectEntries(db, cur.p.id).slice().sort((a, b) => (oldest ? 1 : -1) * ((a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.createdAt - b.createdAt));
  const perDay = {}; es.forEach((e) => { perDay[e.date] = (perDay[e.date] || 0) + 1; });
  return (
    <Screen tab="calendar">
      <Header cur={cur} mine={mine} view="grid" onPick={(id) => nav.replace("grid", { projectId: id })} />
      <div className="hrow between" style={{ padding: "0 20px 14px", flexShrink: 0 }}>
        <span className="muted" style={{ fontSize: 13 }}>{es.length} {es.length === 1 ? "entry" : "entries"}</span>
        <button className="hrow gap4 muted" style={{ background: "none", border: "none", fontSize: 13 }} onClick={() => setOldest(!oldest)}>{oldest ? "Oldest first" : "Newest first"}<Icon name="chevD" size={14} /></button>
      </div>
      <div className="scroll" style={{ padding: "0 2px 2px" }}>
        {!es.length ? <div className="small faint" style={{ padding: 40, textAlign: "center" }}>No clips in {cur.p.name} yet.</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 2 }}>
          {es.map((e) => {
            const m = S.media(db, e.mediaId);
            const mc = S.moodColor(db, e.authorId, e.mood);
            const author = S.user(db, e.authorId);
            return (
              <button key={e.id} onClick={() => nav.go("entry", { entryId: e.id })} aria-label={"Open entry " + fullDay(e.date)} style={{ position: "relative", aspectRatio: "1", border: "none", padding: 0, background: m ? (m.thumb ? "url(" + m.thumb + ") center/cover" : m.grad) : "#222", color: "inherit" }}>
                {mc ? <span style={{ position: "absolute", top: 6, right: 6, width: 9, height: 9, borderRadius: "50%", background: mc, boxShadow: "0 0 0 2px rgba(0,0,0,0.3)" }} /> : null}
                {perDay[e.date] > 1 ? <span style={{ position: "absolute", top: 6, left: 6, padding: "1px 5px", borderRadius: 6, background: "rgba(0,0,0,0.45)", fontSize: 9, fontWeight: 700 }}>{perDay[e.date]}</span> : null}
                {cur.shared ? <span style={{ position: "absolute", right: 6, bottom: 6, width: 18, height: 18, borderRadius: "50%", background: author ? author.color : "#555", border: "2px solid rgba(0,0,0,0.35)", fontSize: 9, fontWeight: 800, color: "#141413", display: "flex", alignItems: "center", justifyContent: "center" }}>{S.initial(author)}</span> : null}
                <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 8px 6px", background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)", textAlign: "left", fontSize: 11, fontWeight: 600 }}>{monthDay(e.date)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}

export function EntryEditSheet({ entry, open, onClose }) {
  const { db, act, toast } = useApp();
  const [note, setNote] = useState(entry.note || "");
  const [mood, setMood] = useState(entry.mood);
  const [custom, setCustom] = useState("");
  const [cc, setCc] = useState(null);
  return (
    <Sheet open={open} onClose={onClose} title="Edit note & mood" right={<button className="link" onClick={async () => {
      const r = resolveMood(db, entry.authorId, mood, custom, cc);
      try { await act("editEntry", { entryId: entry.id, note: note.trim(), mood: r.mood, addMood: !!r.newColor, newMoodColor: r.newColor }); } catch (e) { return; }
      toast("Saved. Other projects keep their own copy"); onClose();
    }} style={{ fontSize: 14, fontWeight: 700 }}>Save</button>}>
      <div className="stack gap16">
        <div className="stack gap8">
          <div className="hrow between"><label className="sec" htmlFor="ed-note">Note</label><span className="tiny" style={{ color: "var(--ghost)" }}>{note.length}/280</span></div>
          <textarea id="ed-note" className="input" rows="3" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <MoodPicker ownerId={entry.authorId} mood={mood} onMood={setMood} custom={custom} onCustom={setCustom} customColor={cc} onCustomColor={setCc} />
        <span className="small faint">Changes apply to this project only.</span>
      </div>
    </Sheet>
  );
}

// The project's clips in order, oldest first, for moving between days.
function neighbours(db, e) {
  const all = S.projectEntries(db, e.projectId).slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.createdAt - y.createdAt));
  const i = all.findIndex((x) => x.id === e.id);
  return { prev: i > 0 ? all[i - 1] : null, next: i >= 0 && i < all.length - 1 ? all[i + 1] : null };
}

// A sideways swipe: left for the next day, right for the day before. Up and down still scroll.
function useSwipe(onPrev, onNext) {
  const at = useRef(null);
  const swiped = useRef(false);
  return {
    style: { touchAction: "pan-y" },
    onPointerDown: (ev) => { at.current = { x: ev.clientX, y: ev.clientY }; swiped.current = false; },
    onPointerUp: (ev) => {
      const p = at.current; at.current = null;
      if (!p) return;
      const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      swiped.current = true;
      if (dx < 0) { if (onNext) onNext(); } else if (onPrev) onPrev();
    },
    onPointerCancel: () => { at.current = null; },
    // A swipe that ends on a button isn't a tap.
    onClickCapture: (ev) => { if (swiped.current) { swiped.current = false; ev.stopPropagation(); ev.preventDefault(); } }
  };
}

const AR = { portrait: 9 / 16, landscape: 16 / 9, square: 1 };

// Full-screen playback with the day and note on the clip, like a mash. Swipe (or use the arrows) for other days.
function Player({ entryId, onClose }) {
  const { db } = useApp();
  const [id, setId] = useState(entryId);
  const [playing, setPlaying] = useState(true);
  const [dir, setDir] = useState(0);
  const area = useRef(null);
  const [room, setRoom] = useState({ w: 390, h: 760 });
  const e = S.entry(db, id) || S.entry(db, entryId);
  const { prev, next } = neighbours(db, e);
  const go = (x, d) => { if (!x) return; setDir(d); setId(x.id); setPlaying(true); };
  const close = () => onClose(e.id);
  const swipe = useSwipe(() => go(prev, -1), () => go(next, 1));
  useEffect(() => {
    const el = area.current;
    const measure = () => { if (el) setRoom({ w: el.clientWidth, h: el.clientHeight }); };
    measure();
    if (!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const key = (ev) => {
      if (ev.key === "Escape") close();
      else if (ev.key === "ArrowLeft") go(prev, -1);
      else if (ev.key === "ArrowRight") go(next, 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const c = S.clipOf(db, e);
  const ar = AR[c.m.orient] || AR.portrait;
  const w = Math.min(room.w, Math.round(room.h * ar)), h = Math.round(w / ar);
  const short = Math.min(w, h);
  const fs = Math.max(13, Math.min(22, Math.round(short * 0.045)));
  const day = stampDate(e.date, "short") + (e.date.slice(0, 4) !== todayKey().slice(0, 4) ? " " + e.date.slice(0, 4) : "");
  const pill = { padding: Math.round(fs * 0.35) + "px " + Math.round(fs * 0.6) + "px", borderRadius: Math.round(fs * 0.45), background: "rgba(0,0,0,0.45)", color: "#FFFFFF", fontSize: fs, fontWeight: 600, lineHeight: 1.3 };
  const edge = Math.round(short * 0.045);
  const side = (label, icon, x, d, pos) => x ? <button className="iconbtn" aria-label={label} onClick={() => go(x, d)} style={Object.assign({ position: "absolute", top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.4)", zIndex: 2 }, pos)}><Icon name={icon} size={18} /></button> : null;
  return (
    <div role="dialog" aria-label={"Playing " + fullDay(e.date)} style={{ position: "absolute", inset: 0, zIndex: 50, background: "#000", display: "flex", flexDirection: "column", animation: "fade 0.15s ease-out" }}>
      <div ref={area} {...swipe} style={Object.assign({ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }, swipe.style)}>
        <div key={e.id} className={dir > 0 ? "from-right" : dir < 0 ? "from-left" : ""} style={{ position: "relative", width: w, height: h }}>
          <ClipView m={c.m} start={c.start} end={c.end} playing={playing} loop={false} onEnded={() => setPlaying(false)} style={{ position: "absolute", inset: 0, borderRadius: 0 }}>
            <span style={Object.assign({ position: "absolute", top: edge, right: edge }, pill)}>{day}</span>
            {e.note ? <span style={Object.assign({ position: "absolute", left: edge, bottom: edge, maxWidth: "78%", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, pill)}>{e.note}</span> : null}
          </ClipView>
          <button aria-label={playing ? "Pause" : "Play again"} onClick={() => setPlaying(!playing)} style={{ position: "absolute", inset: 0, background: "transparent", border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#F2EFE9" }}>
            {!playing ? <span style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="play" size={24} /></span> : null}
          </button>
        </div>
        {side("Previous day", "chevL", prev, -1, { left: 12 })}
        {side("Next day", "chevR", next, 1, { right: 12 })}
      </div>
      <button className="iconbtn" aria-label="Close" onClick={close} style={{ position: "absolute", top: "calc(16px + env(safe-area-inset-top, 0px))", left: 16, background: "rgba(0,0,0,0.45)", zIndex: 3 }}><Icon name="close" size={17} stroke={2.2} /></button>
    </div>
  );
}

export function EntryDetail({ params }) {
  const { db, act, nav, me, toast, setDraft } = useApp();
  const e = S.entry(db, params.entryId);
  const [full, setFull] = useState(false);
  const [sheet, setSheet] = useState(null);
  const near = e ? neighbours(db, e) : {};
  const swipe = useSwipe(near.prev ? () => nav.replace("entry", { entryId: near.prev.id }) : null, near.next ? () => nav.replace("entry", { entryId: near.next.id }) : null);
  if (!e) {
    return <Screen><div className="topbar"><button className="iconbtn" aria-label="Back" onClick={nav.back}><Icon name="back" size={17} /></button></div><div className="small faint" style={{ padding: 40, textAlign: "center" }}>This entry was removed.</div></Screen>;
  }
  const p = S.project(db, e.projectId);
  const c = S.clipOf(db, e);
  const mine = e.authorId === me.id;
  const owner = S.isOwner(db, e.projectId, me.id);
  const author = S.user(db, e.authorId);
  const siblings = db.entries.filter((x) => x.mediaId === e.mediaId && S.membership(db, x.projectId, me.id));
  const myProjects = S.sortProjects(S.myProjects(db, me.id));
  const removeHere = async () => {
    let r;
    try { r = await act("deleteEntry", { entryId: e.id }); } catch (x) { return; }
    nav.back();
    toast("Removed from " + p.name, { label: "Undo", run: () => act("restoreEntry", { restore: r.restore }).catch(() => {}) });
  };
  const deleteAll = async () => {
    try { await act("deleteClipEverywhere", { entryId: e.id }); } catch (x) { return; }
    nav.back(); toast("Clip deleted everywhere");
  };
  const replace = () => { setDraft({ date: e.date, presetProjectId: e.projectId, replaceEntryId: e.id, returnTo: "entry" }); nav.go("capture"); };
  const addToDay = () => { setDraft({ date: e.date, presetProjectId: e.projectId, returnTo: "entry" }); nav.go("capture"); };
  return (
    <Screen>
      <div className="scroll" {...swipe} style={swipe.style}>
        <div style={{ position: "relative", height: 470, flexShrink: 0 }}>
          <ClipView m={c.m} start={c.start} end={c.end} playing={false} style={{ position: "absolute", inset: 0, borderRadius: 0 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.35), transparent 25%, transparent 70%, #121212)", pointerEvents: "none" }} />
          <button className="iconbtn" aria-label="Back" onClick={nav.back} style={{ position: "absolute", top: 20, left: 20, background: "rgba(0,0,0,0.45)" }}><Icon name="back" size={17} stroke={2.2} /></button>
          <button aria-label="Play full screen" onClick={() => setFull(true)} style={{ position: "absolute", top: "46%", left: "50%", transform: "translate(-50%,-50%)", width: 64, height: 64, borderRadius: "50%", background: "rgba(0,0,0,0.4)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#F2EFE9" }}><Icon name="play" size={24} /></button>
          <div className="stack gap6" style={{ position: "absolute", left: 20, right: 20, bottom: 18, pointerEvents: "none" }}>
            <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{fullDay(e.date)} · {new Date(e.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            {e.note ? <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{e.note}</span> : null}
          </div>
        </div>
        <div className="pad stack gap18" style={{ paddingTop: 16 }}>
          <div className="hrow wrap gap8">
            {!mine ? <span className="tag" style={{ fontSize: 12.5, padding: "4px 11px 4px 4px", background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)" }}><Avatar user={author} size={20} ring={false} />Filmed by {S.firstName(author)}</span> : null}
            {e.mood ? <span className="tag" style={{ fontSize: 12.5, padding: "5px 11px", background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)" }}><span className="dot" style={{ width: 8, height: 8, background: S.moodColor(db, e.authorId, e.mood) }} />{e.mood}</span> : null}
            <span className="tag num" style={{ fontSize: 12.5, padding: "5px 11px", background: "var(--surface)", border: "1px solid var(--line)", color: "#BDB7AD" }}>{c.len.toFixed(1)}s · {fmtSec(c.start)} – {fmtSec(c.end)}</span>
          </div>
          <div className="stack gap8">
            <span className="sec">In {siblings.length > 1 ? "these projects" : "this project"}</span>
            <div className="card flush hrow">
              <div className="list" style={{ flex: 1, minWidth: 0 }}>
                {siblings.map((x) => {
                  const xp = S.project(db, x.projectId);
                  const xc = S.clipOf(db, x);
                  return (
                    <button key={x.id} className="row" onClick={() => x.id !== e.id && nav.replace("entry", { entryId: x.id })}>
                      <Thumb m={S.coverOf(db, xp.id)} style={{ width: 34, height: 34, borderRadius: 9 }} />
                      <span className="grow"><span className="t">{xp.name}{x.id === e.id && siblings.length > 1 ? <span className="tag" style={{ marginLeft: 8 }}>Viewing</span> : null}</span><span className="s" style={{ color: x.trim ? "var(--accent)" : undefined }}>{x.trim ? "Custom trim for this project · " + fmtSec(xc.start) + " – " + fmtSec(xc.end) : "Uses the clip's own trim"}</span></span>
                    </button>
                  );
                })}
              </div>
              {mine ? <button className="chipbtn hrow gap4" aria-label="Change projects" onClick={() => setSheet("projects")} style={{ margin: "0 14px 0 4px", flexShrink: 0 }}><Icon name="layers" size={14} />Change</button> : null}
            </div>
          </div>
          {mine || owner ? (
            <div className="grid2">
              {mine ? <button className="btn ghost sm" onClick={() => setSheet("edit")}><Icon name="edit" size={15} />Edit note</button> : null}
              <button className="btn ghost sm" onClick={() => nav.go("capture", { entryId: e.id })}><Icon name="scissors" size={15} />Adjust trim</button>
              {mine ? <button className="btn ghost sm" onClick={replace}><Icon name="repeat" size={15} />Replace video</button> : null}
              {mine ? <button className="btn ghost sm" onClick={() => download("/api/files/media/" + e.mediaId + "/original")}><Icon name="download" size={15} />Download</button> : null}
            </div>
          ) : <span className="small faint" style={{ lineHeight: 1.45 }}>Only {S.firstName(author)} or the project owner can change this clip.</span>}
          {!mine && owner ? <span className="small faint" style={{ lineHeight: 1.45 }}>Owner tools apply to {p.name} only. {S.firstName(author)}'s original clip and other projects aren't touched. The note and mood can only be edited by {S.firstName(author)}.</span> : null}
          <div className={mine || owner ? "grid2" : ""}>
            <button className="btn dashed" onClick={addToDay} aria-label="Add another clip to this day"><Icon name="plus" size={15} stroke={2.4} />Add a clip</button>
            {mine || owner ? <button className="btn danger-ghost" onClick={removeHere} aria-label={siblings.length > 1 || !mine ? "Remove from " + p.name + " only" : "Delete this entry"} style={{ padding: 12, fontSize: 13.5, border: "1.5px solid rgba(224,120,110,0.4)" }}><Icon name="trash" size={15} />{siblings.length > 1 || !mine ? "Remove here" : "Delete"}</button> : null}
          </div>
          {mine && siblings.length > 1 ? <button className="btn danger-ghost sm" onClick={() => setSheet("delete")}><Icon name="trash" size={15} />Delete everywhere</button> : null}
          <div style={{ height: 20 }} />
        </div>
      </div>
      {full ? <Player entryId={e.id} onClose={(id) => { setFull(false); if (id !== e.id) nav.replace("entry", { entryId: id }); }} /> : null}
      {sheet === "edit" ? <EntryEditSheet entry={e} open onClose={() => setSheet(null)} /> : null}
      <Sheet open={sheet === "projects"} onClose={() => setSheet(null)} title="Change projects">
        <div className="stack gap8">
          <span className="small muted">Tick where this clip should appear. It's still one upload.</span>
          {myProjects.map((x) => {
            const has = db.entries.find((y) => y.mediaId === e.mediaId && y.projectId === x.p.id);
            return (
              <button key={x.p.id} className="hrow gap12" onClick={() => {
                const cur = db.entries.filter((y) => y.mediaId === e.mediaId && y.authorId === me.id).map((y) => y.projectId);
                const want = has ? cur.filter((pid) => pid !== x.p.id) : cur.concat([x.p.id]);
                if (!want.length) { toast("A clip must stay in at least one project"); return; }
                act("setEntryProjects", { entryId: e.id, projectIds: want }).then(() => { if (has && has.id === e.id) nav.back(); }).catch(() => {});
              }} style={{ padding: "10px 12px", borderRadius: 12, background: has ? "#211F1C" : "var(--surface)", border: "1.5px solid " + (has ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left" }}>
                <Thumb m={x.cover} style={{ width: 36, height: 36, borderRadius: 9 }} />
                <span className="grow stack gap2" style={{ flex: 1 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{x.p.name}</span><span className="small muted">{x.cat.name}</span></span>
                <span className={"check" + (has ? " on" : "")} style={{ borderColor: has ? undefined : "var(--line-strong)" }}>{has ? <Icon name="check" size={12} stroke={3} color="var(--accent-ink)" /> : null}</span>
              </button>
            );
          })}
          <span className="small faint">A clip must stay in at least one project.</span>
        </div>
      </Sheet>
      <Confirm open={sheet === "delete"} onClose={() => setSheet(null)} title="Delete this clip everywhere?" body={"It's removed from " + siblings.length + " projects and the upload is deleted. This can't be undone."} confirm="Delete everywhere" danger onConfirm={deleteAll} />
    </Screen>
  );
}
