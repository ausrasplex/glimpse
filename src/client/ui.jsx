import React from "react";
import * as RD from "@radix-ui/react-dialog";
import * as RS from "@radix-ui/react-switch";
import * as RT from "@radix-ui/react-toast";
import { Icon } from "./icons.jsx";
import { useApp, live } from "./store.jsx";
import * as S from "./sel.js";
import { PALETTE, todayKey, addDays, dayLabel, fullDay, relDay } from "./util.js";

const { useState, useEffect, useRef } = React;

export function Redirect({ to, params }) {
  const { nav } = useApp();
  useEffect(() => { nav.replace(to, params); }, []);
  return null;
}

export function Screen({ children, tab, className, style }) {
  return (
    <div className={"screen screen-enter " + (className || "")} style={style}>
      {children}
      {tab ? <TabBar active={tab} /> : null}
    </div>
  );
}

export function TopBar({ title, sub, onBack, right, backLabel, icon }) {
  const { nav } = useApp();
  return (
    <div className="topbar">
      {onBack !== false ? (
        <button className="iconbtn" aria-label={backLabel || "Back"} onClick={onBack || nav.back}>
          <Icon name={icon || "back"} size={17} stroke={2.2} />
        </button>
      ) : null}
      <div className="titles">
        <span className="title">{title}</span>
        {sub ? <span className="sub">{sub}</span> : null}
      </div>
      {right || null}
    </div>
  );
}

export function Steps({ n, of }) {
  const items = []; for (let i = 0; i < of; i++) items.push(<span key={i} className={i < n ? "on" : ""} />);
  return <div className="steps" style={{ gridTemplateColumns: "repeat(" + of + ", minmax(0,1fr))" }}>{items}</div>;
}

export function TabBar({ active }) {
  const { nav } = useApp();
  const tabs = [
    { id: "home", label: "Home", icon: "home" },
    { id: "calendar", label: "Calendar", icon: "calendar" },
    { id: "mash", label: "Mash", icon: "mash" },
    { id: "settings", label: "Settings", icon: "settings" }
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <button key={t.id} className={"tab" + (active === t.id ? " on" : "")} aria-current={active === t.id ? "page" : undefined} onClick={() => nav.reset(t.id)}>
          <Icon name={t.icon} size={21} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// Bottom sheets, dialogs and confirms run on Radix Dialog: focus trap, Escape, outside tap,
// screen-reader labelling and nested stacking. Rendered in place (no portal) so they stay inside the app column.
// Focus moves to the panel itself rather than its first field, so phones don't pop the keyboard on open.
const SR_ONLY = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 };
const focusPanel = (e) => { e.preventDefault(); if (e.currentTarget && e.currentTarget.focus) e.currentTarget.focus(); };
const closer = (onClose) => (o) => { if (!o && onClose) onClose(); };

// Drag a sheet down to close it: from the handle or title bar any time, or from its content once that's
// scrolled to the top (otherwise the swipe scrolls). Past a third of its height, or a quick flick, closes it;
// otherwise it springs back. The scrim fades as it goes.
function useSheetDrag(onClose) {
  const panel = useRef(null), scrim = useRef(null), body = useRef(null);
  const g = useRef(null);
  const still = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paint = (dy, anim) => {
    const p = panel.current, s = scrim.current;
    if (!p) return;
    const ease = anim && !still() ? "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
    p.style.transition = ease; p.style.transform = dy ? "translateY(" + dy + "px)" : "";
    if (s) { s.style.transition = anim && !still() ? "opacity 0.22s" : "none"; s.style.opacity = String(Math.max(0.15, 1 - dy / Math.max(1, p.offsetHeight))); }
  };
  const begin = (y) => { g.current = { y0: y, dy: 0, h: panel.current ? panel.current.offsetHeight : 1, pts: [[Date.now(), y]] }; };
  const move = (y) => {
    const s = g.current; if (!s) return;
    s.dy = Math.max(0, y - s.y0);
    s.pts.push([Date.now(), y]); if (s.pts.length > 12) s.pts.shift();
    paint(s.dy, false);
  };
  const end = () => {
    const s = g.current; g.current = null; if (!s) return;
    // Speed over the last 100ms up to release, so a drag that pauses before letting go isn't a flick.
    const now = Date.now(), last = s.pts[s.pts.length - 1][1];
    const recent = s.pts.filter((p) => p[0] >= now - 100);
    const speed = recent.length ? (last - recent[0][1]) / Math.max(16, now - recent[0][0]) : 0; // px per ms, downwards
    if (s.dy > s.h / 3 || (speed > 0.4 && s.dy > 24)) {
      paint(s.h, true);
      setTimeout(() => onClose && onClose(), still() ? 0 : 200);
    } else paint(0, true);
  };
  // Handle and title bar: always drag.
  const grip = {
    onPointerDown: (e) => {
      if (e.button !== 0 || (e.target.closest && e.target.closest("button, a, input, textarea, select"))) return;
      e.currentTarget.setPointerCapture(e.pointerId); begin(e.clientY);
    },
    onPointerMove: (e) => { if (g.current) move(e.clientY); },
    onPointerUp: end, onPointerCancel: end,
    style: { touchAction: "none" }
  };
  // Content: a downward swipe drags only when it's already scrolled to the top.
  useEffect(() => {
    const el = body.current; if (!el) return;
    let y0 = null, dragging = false;
    const ts = (e) => { y0 = e.touches[0].clientY; dragging = false; };
    const tm = (e) => {
      if (y0 == null) return;
      const y = e.touches[0].clientY;
      if (!dragging) {
        if (el.scrollTop > 0 || y - y0 < 6) { if (y < y0) y0 = null; return; }
        dragging = true; begin(y);
      }
      e.preventDefault(); move(y);
    };
    const te = () => { if (dragging) end(); y0 = null; dragging = false; };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te); el.addEventListener("touchcancel", te);
    return () => { el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm); el.removeEventListener("touchend", te); el.removeEventListener("touchcancel", te); };
  }, []);
  return { panel, scrim, body, grip };
}

export function Sheet({ open, onClose, title, right, children, tall, label }) {
  if (!open) return null;
  return <SheetPanel onClose={onClose} title={title} right={right} tall={tall} label={label}>{children}</SheetPanel>;
}
function SheetPanel({ onClose, title, right, children, tall, label }) {
  const d = useSheetDrag(onClose);
  return (
    <RD.Root open onOpenChange={closer(onClose)}>
      <div className="overlay">
        <RD.Overlay className="scrim" ref={d.scrim} />
        <RD.Content ref={d.panel} className="sheet" style={tall ? { height: "88%" } : null} aria-describedby={undefined} onOpenAutoFocus={focusPanel}>
          <div className="grab" {...d.grip}><span /></div>
          {title ? (
            <div className="sheet-head" {...d.grip}>
              <RD.Title asChild><span className="sheet-title">{title}</span></RD.Title>
              {right || null}
            </div>
          ) : <div style={{ height: 12, touchAction: "none" }} onPointerDown={d.grip.onPointerDown} onPointerMove={d.grip.onPointerMove} onPointerUp={d.grip.onPointerUp} onPointerCancel={d.grip.onPointerCancel}>{label ? <RD.Title style={SR_ONLY}>{label}</RD.Title> : null}</div>}
          <div ref={d.body} className="sheet-body" style={tall ? { flex: 1 } : null}>{children}</div>
        </RD.Content>
      </div>
    </RD.Root>
  );
}

export function Dialog({ open, onClose, title, body, children }) {
  if (!open) return null;
  return (
    <RD.Root open onOpenChange={closer(onClose)}>
      <div className="dialog-wrap">
        <RD.Overlay className="scrim" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
        <RD.Content className="dialog" role="alertdialog" {...(body ? {} : { "aria-describedby": undefined })} onOpenAutoFocus={focusPanel}>
          <div className="stack gap6">
            <RD.Title asChild><span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span></RD.Title>
            {body ? <RD.Description asChild><span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{body}</span></RD.Description> : null}
          </div>
          {children}
        </RD.Content>
      </div>
    </RD.Root>
  );
}

export function Confirm({ open, onClose, title, body, confirm, onConfirm, danger, children, cancel }) {
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="stack gap14">
        <div className="stack gap6">
          <RD.Title asChild><span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span></RD.Title>
          {body ? <RD.Description asChild><span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{body}</span></RD.Description> : null}
        </div>
        {children}
        <div className="grid2">
          <button className="btn sm ghost" onClick={onClose}>{cancel || "Cancel"}</button>
          <button className={"btn sm" + (danger ? " danger" : "")} onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </Sheet>
  );
}

export function Toggle({ on, onChange, label }) {
  return <RS.Root className={"switch" + (on ? " on" : "")} checked={!!on} onCheckedChange={(v) => onChange(v)} aria-label={label} />;
}

export function ToggleRow({ title, sub, on, onChange }) {
  return (
    <div className="hrow between gap12">
      <span className="stack gap2" style={{ minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {sub ? <span className="small muted" style={{ lineHeight: 1.35 }}>{sub}</span> : null}
      </span>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

export function Seg({ options, value, onChange, small }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={String(o.id)} className={o.id === value ? "on" : ""} aria-pressed={o.id === value} onClick={() => onChange(o.id)} style={small ? { fontSize: 12 } : null}>{o.label}</button>
      ))}
    </div>
  );
}

export function Opts({ options, value, onChange, cols }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(" + (cols || options.length) + ", minmax(0,1fr))", gap: 6 }}>
      {options.map((o) => (
        <button key={String(o.id)} className={"opt" + (o.id === value ? " on" : "")} aria-pressed={o.id === value} onClick={() => onChange(o.id)} disabled={o.disabled} aria-label={o.aria}>
          {o.label}{o.sub ? <span style={{ display: "block", fontSize: 10.5, opacity: 0.75, fontWeight: 600, marginTop: 1 }}>{o.sub}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Choice({ active, onClick, title, desc, children, radio }) {
  return (
    <button onClick={onClick} aria-pressed={active} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 14, background: active ? "#211F1C" : "#1A1917", border: "1.5px solid " + (active ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left", width: "100%" }}>
      {radio !== false ? <span className={"radio" + (active ? " on" : "")} /> : null}
      <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        {desc ? <span className="small muted" style={{ lineHeight: 1.35 }}>{desc}</span> : null}
      </span>
      {children}
    </button>
  );
}

export function Avatar({ user, size, ring }) {
  const s = size || 34;
  if (!user) return <span className="av" style={{ width: s, height: s, background: "#3A3733" }} />;
  const style = { width: s, height: s, fontSize: Math.round(s * 0.4), background: user.photo ? "url(" + user.photo + ") center/cover" : user.color };
  if (ring === false) style.border = "none";
  return <span className="av" style={style} aria-hidden="true">{user.photo ? "" : S.initial(user)}</span>;
}

export function AvatarStack({ users, size, max }) {
  const list = users.slice(0, max || 4);
  const extra = users.length - list.length;
  return (
    <span className="avstack">
      {list.map((u) => <Avatar key={u.id} user={u} size={size || 30} />)}
      {extra > 0 ? <span className="av" style={{ width: size || 30, height: size || 30, background: "#2A2825", color: "#BDB7AD", fontSize: 10.5 }}>+{extra}</span> : null}
    </span>
  );
}

// A clip's still frame: the saved thumbnail, or its gradient stand-in.
export function Thumb({ m, className, style, children, label }) {
  const bg = m ? (m.thumb ? "url(" + m.thumb + ") center/cover, " + (m.grad || "#2A2825") : m.grad) : "#2A2825";
  return <div className={"thumb " + (className || "")} style={Object.assign({ background: bg }, style)} role={label ? "img" : undefined} aria-label={label}>{m && m.kind === "photo" ? <span aria-label="Photo" style={{ position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: 5, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="image" size={10} color="#F2EFE9" /></span> : null}{m && m.status && m.status !== "READY" ? <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "2px 4px", background: "rgba(0,0,0,0.55)", fontSize: 9.5, fontWeight: 700, color: m.status === "FAILED" ? "#F0A49C" : "#F2EFE9", textAlign: "center" }}>{m.status === "FAILED" ? "Failed" : "Processing"}</span> : null}{children}</div>;
}

// Plays the chosen section of a clip. Real videos loop the section; sample clips show a gentle "playing" sweep.
// Android's WebView draws a big grey play button over a video that has no poster; a clear one keeps the thumbnail behind it.
export const NO_POSTER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
export function ClipView({ m, start, end, playing, onEnded, loop, style, children, fit, muted }) {
  const ref = useRef(null);
  const url = m ? m.liveUrl || (m.liveId ? live.video[m.liveId] : null) || m.src || null : null;
  const [t, setT] = useState(0);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = start || 0;
    if (playing) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause();
  }, [playing, start, end, url]);
  useEffect(() => {
    if (url || !playing) { setT(0); return; }
    const len = Math.max(0.5, (end || 1) - (start || 0));
    let t0 = performance.now();
    let raf;
    const step = (now) => {
      let p = (now - t0) / 1000 / len;
      if (p >= 1) {
        if (!loop) { setT(1); onEnded && onEnded(); return; }
        t0 = now; p = 0;
      }
      setT(p); raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end, url, m && m.id]);
  const onTime = () => {
    const v = ref.current; if (!v) return;
    if (v.currentTime >= (end || v.duration) - 0.03) {
      if (loop) { v.currentTime = start || 0; } else { v.pause(); onEnded && onEnded(); }
    }
  };
  // A clip that runs to the very end of its file (motion photos usually do) ends before the check above sees it.
  const onVideoEnd = () => {
    const v = ref.current; if (!v) return;
    if (loop && playing) { v.currentTime = start || 0; const p = v.play(); if (p && p.catch) p.catch(() => {}); } else if (onEnded) onEnded();
  };
  // Photos play as a short clip with gentle movement (Ken Burns).
  if (m && m.kind === "photo") {
    const k = playing ? t : 0.5;
    const mv = m.motion || "in";
    const tf = mv === "in" ? "scale(" + (1 + 0.12 * k) + ")" : mv === "out" ? "scale(" + (1.12 - 0.12 * k) + ")" : mv === "pan" ? "scale(1.14) translateX(" + (-5 + 10 * k) + "%)" : "none";
    return (
      <div className="thumb" style={Object.assign({ background: "#000" }, style)}>
        <div style={{ position: "absolute", inset: 0, background: m.thumb ? "url(" + m.thumb + ") center/cover, " + m.grad : m.grad, transform: tf, transformOrigin: "50% 45%" }} />
        {children}
      </div>
    );
  }
  return (
    <div className="thumb" style={Object.assign({ background: m ? (m.thumb ? "url(" + m.thumb + ") center/cover, " + m.grad : m.grad) : "#222" }, style)}>
      {url ? <video ref={ref} src={url} poster={m.thumb || NO_POSTER} muted={!!muted} playsInline onTimeUpdate={onTime} onEnded={onVideoEnd} style={{ objectFit: fit || "cover" }} /> : null}
      {!url && playing ? <div style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: (t * 100) + "%", background: "rgba(255,255,255,0.75)" }} /> : null}
      {!url && playing ? <div style={{ position: "absolute", inset: 0, background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.10) 50%, transparent 70%)", backgroundSize: "200% 100%", backgroundPosition: (100 - t * 200) + "% 0" }} /> : null}
      {children}
    </div>
  );
}

export function PlayBadge({ size }) {
  const s = size || 30;
  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: s, height: s, borderRadius: "50%", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <Icon name="play" size={Math.round(s * 0.42)} color="#F2EFE9" />
    </div>
  );
}

export function Swatches({ value, onPick, colors, cols, size }) {
  const list = colors || PALETTE;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(" + (cols || 8) + ", minmax(0,1fr))", gap: 8 }}>
      {list.map((p) => (
        <button key={p.color} aria-label={p.name} aria-pressed={p.color === value} onClick={() => onPick(p.color)}
          style={{ aspectRatio: "1", width: size || "auto", borderRadius: "50%", background: p.color, border: "none", outline: p.color === value ? "2px solid #F2EFE9" : "2px solid transparent", outlineOffset: 2, padding: 0 }} />
      ))}
    </div>
  );
}

export function strength(pass) {
  let score = 0;
  if (pass.length >= 10) score++;
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
  if (/\d/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass) || pass.length >= 16) score++;
  if (pass.length < 10) score = Math.min(score, 0);
  return score;
}
export function Strength({ pass }) {
  const colors = ["#3A3733", "#E0786E", "#E8A33D", "#B9C26A", "#7DB39F"];
  const labels = ["At least 10 characters", "Weak", "Okay", "Good", "Strong"];
  const sc = pass.length >= 10 ? Math.max(1, strength(pass)) : 0;
  return (
    <div className="stack gap6">
      <div className="grid4" style={{ gap: 4 }}>{[0, 1, 2, 3].map((i) => <div key={i} style={{ height: 4, borderRadius: 2, background: i < sc ? colors[sc] : "#2A2825" }} />)}</div>
      <span style={{ fontSize: 11.5, color: pass.length >= 10 ? colors[sc] : "var(--faint)" }}>{pass.length === 0 ? labels[0] : pass.length < 10 ? (10 - pass.length) + " more characters needed" : labels[sc]}</span>
    </div>
  );
}

export function PassInput({ id, value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input id={id} className="input" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} style={{ paddingRight: 52 }} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="iconbtn plain sq" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}>
        <Icon name={show ? "eyeOff" : "eye"} size={18} />
      </button>
    </div>
  );
}

export const ZONES = [
  { id: "Australia/Melbourne", label: "Melbourne, Australia", offset: "AEDT · UTC+11" },
  { id: "Australia/Sydney", label: "Sydney, Australia", offset: "AEDT · UTC+11" },
  { id: "Australia/Brisbane", label: "Brisbane, Australia", offset: "AEST · UTC+10" },
  { id: "Australia/Adelaide", label: "Adelaide, Australia", offset: "ACDT · UTC+10:30" },
  { id: "Australia/Perth", label: "Perth, Australia", offset: "AWST · UTC+8" },
  { id: "Pacific/Auckland", label: "Auckland, New Zealand", offset: "NZDT · UTC+13" },
  { id: "Asia/Tokyo", label: "Tokyo, Japan", offset: "JST · UTC+9" },
  { id: "Asia/Singapore", label: "Singapore", offset: "SGT · UTC+8" },
  { id: "Europe/London", label: "London, United Kingdom", offset: "GMT · UTC+0" },
  { id: "Europe/Berlin", label: "Berlin, Germany", offset: "CET · UTC+1" },
  { id: "America/New_York", label: "New York, United States", offset: "EST · UTC−5" },
  { id: "America/Los_Angeles", label: "Los Angeles, United States", offset: "PST · UTC−8" }
];
export const detectedZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Melbourne"; } catch (e) { return "Australia/Melbourne"; } };
export const zoneLabel = (id) => { const z = ZONES.find((x) => x.id === id); return z ? z.label + " (" + z.offset.split(" · ")[0] + ")" : id; };

export function TimezonePicker({ value, onChange, detected }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = ZONES.filter((z) => !q || (z.label + z.id).toLowerCase().indexOf(q.toLowerCase()) >= 0);
  return (
    <div className="stack gap6">
      <div className="hrow gap12" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid " + (open ? "var(--accent)" : "var(--line)") }}>
        <Icon name="globe" size={18} color="var(--muted)" />
        <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontSize: 14.5, fontWeight: 600 }}>{zoneLabel(value)}</span>
          <span style={{ fontSize: 11.5, color: value === detected ? "var(--ok)" : "var(--muted)" }}>{value === detected ? "Detected from your browser" : "Changed from detected"}</span>
        </span>
        <button type="button" className="chipbtn" onClick={() => { setOpen(!open); setQ(""); }} aria-expanded={open}>{open ? "Done" : "Change"}</button>
      </div>
      {open ? (
        <div className="stack gap6" style={{ padding: 10, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line)" }}>
          <input className="input" aria-label="Search timezones" placeholder="Search a city or region" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: "10px 12px", fontSize: 14 }} />
          <div className="stack" style={{ maxHeight: 220, overflowY: "auto" }}>
            {list.map((z) => (
              <button key={z.id} type="button" onClick={() => { onChange(z.id); setOpen(false); }} className="hrow between" style={{ padding: 10, borderRadius: 9, background: z.id === value ? "var(--accent-soft)" : "transparent", border: "none", color: "var(--fg)", fontSize: 13.5, textAlign: "left" }}>
                <span>{z.label}</span><span className="small muted">{z.offset}</span>
              </button>
            ))}
            {!list.length ? <span className="small faint" style={{ padding: 8 }}>No matches</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DateSheet({ open, onClose, value, onPick, title, note }) {
  const days = []; for (let i = 0; i < 14; i++) days.push(addDays(todayKey(), -i));
  return (
    <Sheet open={open} onClose={onClose} title={title || "Which day is this for?"}>
      <div className="stack gap10">
        {note ? <span className="small muted">{note}</span> : null}
        <div className="grid2">
          {days.map((k) => (
            <button key={k} className={"opt" + (k === value ? " on" : "")} onClick={() => { onPick(k); onClose(); }} style={{ padding: "11px 8px" }}>{relDay(k)}</button>
          ))}
        </div>
        <label className="sec" htmlFor="pick-date">Or pick any date</label>
        <input id="pick-date" className="input" type="date" max={todayKey()} value={value} onChange={(e) => { if (e.target.value) { onPick(e.target.value); onClose(); } }} />
      </div>
    </Sheet>
  );
}

export function Menu({ items }) {
  return (
    <div className="stack" style={{ padding: 4, borderRadius: 12, background: "#161513", border: "1px solid var(--line-soft)" }}>
      {items.filter(Boolean).map((it, i) => it === "-" ? <div key={i} style={{ height: 1, background: "var(--line-soft)", margin: "4px 8px" }} /> : (
        <button key={i} onClick={it.onClick} disabled={it.disabled} className="hrow gap10" style={{ width: "100%", padding: "11px 12px", border: "none", borderRadius: 9, background: "transparent", color: it.danger ? "var(--danger)" : "var(--fg)", fontSize: 13.5, fontWeight: 600, textAlign: "left", opacity: it.disabled ? 0.35 : 1 }}>
          {it.icon ? <Icon name={it.icon} size={16} /> : null}{it.label}
        </button>
      ))}
    </div>
  );
}

// Toasts run on Radix Toast: announced to screen readers, swipe down to dismiss, timer pauses on hover/focus.
export function ToastHost() {
  const { toastState, setToast } = useApp();
  const t = toastState;
  return (
    <RT.Provider swipeDirection="down" label="Notifications">
      {t ? (
        <RT.Root key={t.id} className="toast" open duration={t.action ? 6000 : 3600} onOpenChange={(o) => { if (!o) setToast(null); }}>
          <Icon name={t.kind === "warn" ? "alert" : "check"} size={16} color={t.kind === "warn" ? "var(--accent)" : "var(--ok)"} />
          <RT.Title className="grow">{t.text}</RT.Title>
          {t.action ? <RT.Action altText={t.action.label} asChild><button className="link" style={{ color: "var(--accent)", fontSize: 13, fontWeight: 800 }} onClick={() => t.action.run()}>{t.action.label}</button></RT.Action> : null}
          <RT.Close asChild><button className="iconbtn plain" style={{ width: 26, height: 26 }} aria-label="Dismiss"><Icon name="close" size={14} /></button></RT.Close>
        </RT.Root>
      ) : null}
      <RT.Viewport className="toast-viewport" />
    </RT.Provider>
  );
}

export function Section({ title, right, children, style }) {
  return (
    <div className="stack gap10" style={style}>
      {title || right ? <div className="hrow between" style={{ alignItems: "baseline", gap: 10 }}><span className="sec">{title}</span>{right ? <span className="small faint" style={{ textAlign: "right" }}>{right}</span> : null}</div> : null}
      {children}
    </div>
  );
}

export function Stepper({ value, onChange, min, max, label }) {
  return (
    <span className="hrow gap8">
      <button className="chipbtn" style={{ width: 32, padding: "6px 0" }} aria-label={"Decrease " + label} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="num" style={{ minWidth: 22, textAlign: "center", fontWeight: 700 }}>{value}</span>
      <button className="chipbtn" style={{ width: 32, padding: "6px 0" }} aria-label={"Increase " + label} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

// Drag-to-reorder for short lists (moods, tracklist). Works with mouse and touch.
export function useDragList(items, onReorder, rowHeight) {
  const [drag, setDrag] = useState(null);
  const handleProps = (index) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const h = rowHeight || 52;
      let to = index;
      setDrag({ from: index, to: index, dy: 0 });
      const move = (ev) => { const dy = ev.clientY - startY; to = Math.max(0, Math.min(items.length - 1, index + Math.round(dy / h))); setDrag({ from: index, to, dy }); };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setDrag(null); if (to !== index) onReorder(index, to); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    style: { touchAction: "none", cursor: "grab" }
  });
  const rowStyle = (index) => {
    if (!drag) return null;
    if (index === drag.from) return { transform: "translateY(" + drag.dy + "px)", position: "relative", zIndex: 2, boxShadow: "0 8px 20px rgba(0,0,0,0.5)", background: "#24221F" };
    const h = rowHeight || 52;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return { transform: "translateY(-" + h + "px)", transition: "transform 0.12s" };
    if (drag.from > drag.to && index < drag.from && index >= drag.to) return { transform: "translateY(" + h + "px)", transition: "transform 0.12s" };
    return { transition: "transform 0.12s" };
  };
  return { handleProps, rowStyle };
}
export const move = (arr, from, to) => { const a = arr.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };

export { fullDay, dayLabel };
