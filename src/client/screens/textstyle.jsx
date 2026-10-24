// Text on mashes: the live preview, the style controls shared by the date stamp and the song title, and the font picker.
import React from "react";
import { useApp, api } from "../store.jsx";
import { Icon } from "../icons.jsx";
import { Sheet, Opts } from "../ui.jsx";
import { PALETTE } from "../util.js";
import { layoutBox, placeBoxes, withPreset } from "../../shared/textstyle";
import { fontStack, previewStack, loadPreview, useFontsLoading, measureWith, catalogue, CATEGORIES, catName } from "../fonts.js";

const { useState, useEffect, useRef, useMemo } = React;

// ---------- Preview ----------
// Laid out with the renderer's own code, measured in the real fonts, so it matches the finished video.
export function TextPreview({ items, w, h, back, quiet, radius = 10 }) {
  // Re-measured once the fonts have loaded.
  const loading = useFontsLoading(items.map((it) => it.look.font));
  const short = Math.min(w, h);
  const boxes = placeBoxes(items.map((it) => {
    const m = measureWith(it.look.font), sp = it.look.style === "bold" ? 0.04 : 0;
    return layoutBox(it.look, it.lines, short, (t, px, wt) => m(t, px, wt) + sp * px * Array.from(t).length);
  }), w, h);
  return (
    <div style={{ position: "relative", width: w, height: h, borderRadius: radius, overflow: "hidden", background: "#000" }} aria-label="Preview of the text on the video" role="img">
      {back}
      {boxes.map((b, i) => (
        <div key={i} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.r, background: b.look.bgOpacity > 0 ? hexAlpha(b.look.bg, b.look.bgOpacity) : "transparent", pointerEvents: "none" }}>
          {b.lines.map((l, j) => (
            <span key={j} style={{ position: "absolute", left: l.x, top: l.baseline - l.size * 0.95, fontFamily: fontStack(b.look.font), fontSize: l.size, fontWeight: l.weight, lineHeight: 1.2, whiteSpace: "nowrap", color: b.look.color, opacity: l.alpha, letterSpacing: b.upper ? l.size * 0.04 : 0, textShadow: b.shadow ? "0 " + Math.max(0.5, short / 430) + "px " + Math.max(1, short / 160) + "px rgba(0,0,0,0.75)" : "none" }}>{l.text}</span>
          ))}
        </div>
      ))}
      {loading && !quiet ? <span className="tiny" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", padding: "3px 8px", borderRadius: 8, background: "rgba(0,0,0,0.55)", color: "#F2EFE9" }}>Loading font…</span> : null}
    </div>
  );
}
const hexAlpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; };

// ---------- Controls ----------
const TEXT_COLORS = [{ name: "White", color: "#FFFFFF" }, { name: "Black", color: "#111111" }].concat(PALETTE.slice(0, 10));
const BG_COLORS = [{ name: "Black", color: "#000000" }, { name: "White", color: "#FFFFFF" }].concat(PALETTE.slice(0, 10));

function ColorRow({ label, value, colors, onPick }) {
  return (
    <div className="stack gap6">
      <span className="sec">{label}</span>
      <div className="hrow wrap" style={{ gap: 8 }}>
        {colors.map((c) => <button key={c.color} aria-label={label + ": " + c.name} aria-pressed={c.color.toUpperCase() === value} onClick={() => onPick(c.color.toUpperCase())} style={{ width: 26, height: 26, borderRadius: "50%", background: c.color, border: "1px solid rgba(255,255,255,0.18)", outline: c.color.toUpperCase() === value ? "2px solid var(--fg)" : "2px solid transparent", outlineOffset: 2, padding: 0 }} />)}
        <label style={{ position: "relative", width: 26, height: 26, borderRadius: "50%", border: "1px dashed var(--line-strong)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", cursor: "pointer" }} title="Choose any colour">
          <Icon name="plus" size={13} />
          <input type="color" aria-label={label + ": choose any colour"} value={value.length === 7 ? value : "#FFFFFF"} onChange={(e) => onPick(e.target.value.toUpperCase())} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
      </div>
    </div>
  );
}

/** Position, preset, font, size, colours, background, corners and padding for one piece of text. */
export function TextStyleControls({ look, set, onFont }) {
  const boxed = look.bgOpacity > 0;
  const put = (o) => set(Object.assign({}, look, o));
  return (
    <div className="stack gap16">
      <div className="stack gap6"><span className="sec">Position</span><Opts value={look.pos} onChange={(v) => put({ pos: v })} options={[{ id: "tl", label: "↖ Top" }, { id: "tr", label: "Top ↗" }, { id: "bl", label: "↙ Bottom" }, { id: "br", label: "Bottom ↘" }]} /></div>
      <div className="stack gap6"><span className="sec">Style</span><Opts value={look.style} onChange={(v) => set(withPreset(look, v))} options={[{ id: "pill", label: "Pill" }, { id: "plain", label: "Plain" }, { id: "bold", label: "Bold" }]} /></div>
      <div className="stack gap6">
        <span className="sec">Font</span>
        <button className="hrow between gap10" onClick={onFont} style={{ padding: "11px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)", textAlign: "left" }}>
          <span className="ellipsis" style={{ fontFamily: fontStack(look.font), fontSize: 17, fontWeight: 700 }}>{look.font}</span>
          <span className="hrow gap4 small muted">Change<Icon name="chevR" size={13} /></span>
        </button>
      </div>
      <div className="stack gap6"><span className="sec">Size</span><Opts value={look.size} onChange={(v) => put({ size: v })} options={[{ id: "s", label: "S" }, { id: "m", label: "M" }, { id: "l", label: "L" }, { id: "xl", label: "XL" }]} /></div>
      <ColorRow label="Text colour" value={look.color} colors={TEXT_COLORS} onPick={(c) => put({ color: c })} />
      <div className="stack gap6"><span className="sec">Background</span><Opts value={look.bgOpacity} onChange={(v) => put({ bgOpacity: v })} options={[{ id: 0, label: "None" }, { id: 0.25, label: "25%" }, { id: 0.45, label: "45%" }, { id: 0.7, label: "70%" }, { id: 1, label: "Solid" }]} /></div>
      {boxed ? (
        <>
          <ColorRow label="Background colour" value={look.bg} colors={BG_COLORS} onPick={(c) => put({ bg: c })} />
          <div className="stack gap6"><span className="sec">Corners</span><Opts value={look.radius} onChange={(v) => put({ radius: v })} options={[{ id: "none", label: "Square" }, { id: "s", label: "Small" }, { id: "m", label: "Medium" }, { id: "full", label: "Round" }]} /></div>
          <div className="stack gap6"><span className="sec">Padding</span><Opts value={look.pad} onChange={(v) => put({ pad: v })} options={[{ id: "s", label: "S" }, { id: "m", label: "M" }, { id: "l", label: "L" }]} /></div>
        </>
      ) : <span className="small faint">No background: the text gets a soft shadow so it stays readable.</span>}
    </div>
  );
}

// ---------- Font picker ----------
const ROW = 52;
const PAGE = 60;

// A row loads its preview font only once it has stayed on screen for a moment.
function FontRow({ family, cat, on, stored, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.IntersectionObserver) { loadPreview(family); return; }
    let t = null;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(t);
      if (e.isIntersecting) t = setTimeout(() => { loadPreview(family); io.disconnect(); }, 150);
    }, { rootMargin: "80px 0px" });
    io.observe(el);
    return () => { clearTimeout(t); io.disconnect(); };
  }, [family]);
  return (
    <button ref={ref} onClick={() => onPick(family)} aria-pressed={on} className="hrow between gap10" style={{ width: "100%", height: ROW, flexShrink: 0, padding: "0 12px", borderRadius: 12, background: on ? "var(--accent-soft)" : "transparent", border: "1px solid " + (on ? "var(--accent)" : "transparent"), color: "var(--fg)", textAlign: "left" }}>
      <span className="ellipsis" style={{ fontFamily: previewStack(family), fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>{family}</span>
      <span className="hrow gap6" style={{ flexShrink: 0 }}>
        <span className="tiny faint">{catName(cat)}</span>
        {on ? <Icon name="check" size={15} stroke={2.6} color="var(--accent)" /> : null}
        {!stored && !on ? <Icon name="download" size={13} color="var(--ghost)" /> : null}
      </span>
    </button>
  );
}

export function FontPicker({ open, onClose, value, onPick }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState("popular");
  const [list, setList] = useState(null);
  const [server, setServer] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const more = useRef(null);
  useEffect(() => {
    if (!open) return;
    setQ(""); setShown(PAGE);
    catalogue().then(setList);
    api("/api/fonts").then(setServer).catch(() => setServer({ stored: [{ family: "Inter", cat: "s", uses: 0 }], google: false }));
  }, [open]);
  const match = (f, c) => (!q || f.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0) && (cat === "all" || c === cat);
  const stored = useMemo(() => {
    const s = (server && server.stored) || [];
    const mine = s.find((x) => x.family === value);
    return (mine ? [mine] : []).concat(s.filter((x) => x.family !== value));
  }, [server, value]);
  const storedSet = new Set(stored.map((x) => x.family));
  const google = useMemo(() => {
    if (!list || !server || !server.google) return [];
    const out = list.filter(([f]) => !storedSet.has(f));
    return sort === "az" ? out.slice().sort((a, b) => a[0].localeCompare(b[0])) : out;
  }, [list, server, sort, stored]);
  const downloaded = stored.filter((x) => match(x.family, x.cat));
  const others = google.filter(([f, c]) => match(f, c));
  // Show more Google Fonts rows as the list scrolls near its end.
  useEffect(() => {
    const el = more.current;
    if (!el || !window.IntersectionObserver) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setShown((n) => n + PAGE); }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [others.length > shown, open]);
  const pick = (f) => { onPick(f); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Font" tall>
      <div className="stack gap12">
        <div className="hrow gap10" style={{ padding: "11px 14px", borderRadius: 12, background: "#1F1E1B", border: "1px solid var(--line)" }}><Icon name="search" size={16} color="var(--faint)" /><input aria-label="Search fonts" placeholder="Search fonts" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 14 }} /></div>
        <div className="hrow wrap gap6">{CATEGORIES.map((c) => <button key={c.id} onClick={() => { setCat(c.id); setShown(PAGE); }} aria-pressed={cat === c.id} style={{ padding: "6px 11px", borderRadius: 14, background: cat === c.id ? "var(--accent-soft)" : "var(--surface)", border: "1px solid " + (cat === c.id ? "var(--accent)" : "var(--line)"), color: cat === c.id ? "var(--fg)" : "var(--muted)", fontSize: 12, fontWeight: 600 }}>{c.label}</button>)}</div>
        <div className="stack gap4">
          <span className="sec" style={{ padding: "6px 2px" }}>Downloaded · {downloaded.length}</span>
          {downloaded.map((x) => <FontRow key={x.family} family={x.family} cat={x.cat} stored on={x.family === value} onPick={pick} />)}
          {!downloaded.length ? <span className="small faint" style={{ padding: "4px 2px 8px" }}>No downloaded fonts match.</span> : null}
        </div>
        {server && server.google ? (
          <div className="stack gap4">
            <div className="hrow between" style={{ padding: "6px 2px" }}>
              <span className="sec">Google Fonts · {others.length}</span>
              <span className="hrow gap6">{[["popular", "Popular"], ["az", "A–Z"]].map((o) => <button key={o[0]} className="link" onClick={() => setSort(o[0])} aria-pressed={sort === o[0]} style={{ fontSize: 12, color: sort === o[0] ? "var(--accent)" : "var(--muted)" }}>{o[1]}</button>)}</span>
            </div>
            {others.slice(0, shown).map(([f, c]) => <FontRow key={f} family={f} cat={c} on={f === value} onPick={pick} />)}
            {others.length > shown ? <div ref={more} style={{ height: ROW }} /> : null}
            {!list ? <span className="small faint" style={{ padding: 8 }}>Loading the font list…</span> : !others.length ? <span className="small faint" style={{ padding: "4px 2px" }}>No Google Fonts match.</span> : null}
            <span className="tiny faint" style={{ padding: "8px 2px", lineHeight: 1.4 }}>Picking a Google font downloads it to this server once. Your browser loads fonts from here, not from Google.</span>
          </div>
        ) : server ? <span className="small faint" style={{ padding: "4px 2px", lineHeight: 1.4 }}>Downloading more fonts from Google Fonts is turned off on this server.</span> : null}
      </div>
    </Sheet>
  );
}
