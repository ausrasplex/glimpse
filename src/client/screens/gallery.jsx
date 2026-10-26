// The phone's photos and videos in the Android app, grouped by the day each was taken. Opens at the day the
// glimpse is for, so a clip for last Tuesday is right there. Not used on the website.
import React from "react";
import { Icon } from "../icons.jsx";
import { phone } from "../platform.js";
import { todayKey, addDays, dayKey, parseKey, dayLabel, relDay, fmtSec } from "../util.js";

const { useState, useEffect, useRef } = React;
const PAGE = 120;
const dayOf = (ms) => dayKey(new Date(ms));

export function PhoneGallery({ date, onPick, onClose, onBrowse }) {
  const anchor = date && date <= todayKey() ? date : null;
  const cut = anchor ? parseKey(addDays(anchor, 1)).getTime() : null;
  const [access, setAccess] = useState("loading");
  const [asked, setAsked] = useState(false);
  const [older, setOlder] = useState([]);
  const [newer, setNewer] = useState([]);
  const [more, setMore] = useState({ older: true, newer: !!anchor });
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState({});
  const [err, setErr] = useState("");
  const end = useRef(null);
  const loading = useRef(false);

  const thumbsFor = (items) => {
    for (let i = 0; i < items.length; i += 30) {
      phone.thumbs(items.slice(i, i + 30), 256).then((t) => setThumbs((cur) => Object.assign({}, cur, t))).catch(() => {});
    }
  };
  const loadOlder = async (from) => {
    if (loading.current) return;
    loading.current = true; setBusy(true);
    try {
      const last = from !== undefined ? from : older.length ? older[older.length - 1].taken : cut;
      const items = await phone.list(last ? { before: last, limit: PAGE } : { limit: PAGE });
      setOlder((cur) => (from !== undefined ? items : cur.concat(items)));
      setMore((m) => Object.assign({}, m, { older: items.length === PAGE }));
      thumbsFor(items);
    } catch (e) { setErr(e.message || "Couldn't read your photos and videos."); }
    finally { loading.current = false; setBusy(false); }
  };
  const loadNewer = async () => {
    const first = newer.length ? newer[0].taken + 1 : cut;
    const items = await phone.list({ after: first, limit: 60 }).catch(() => []);
    setNewer((cur) => items.slice().reverse().concat(cur));
    setMore((m) => Object.assign({}, m, { newer: items.length === 60 }));
    thumbsFor(items);
  };
  const start = (a) => { setAccess(a); setErr(""); if (a !== "none") { setNewer([]); loadOlder(cut || null); } };
  useEffect(() => { phone.access().then(start).catch(() => setAccess("none")); }, []);
  // Escape (and Android's back button) closes the gallery.
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const ask = async () => { setAsked(true); start(await phone.requestAccess().catch(() => "none")); };

  // Older days load as the end of the list comes into view.
  useEffect(() => {
    const el = end.current;
    if (!el || !window.IntersectionObserver || !more.older || !older.length) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadOlder(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  });

  const all = newer.concat(older);
  const groups = [];
  all.forEach((it) => { const k = dayOf(it.taken); const g = groups[groups.length - 1]; if (g && g.day === k) g.items.push(it); else groups.push({ day: k, items: [it] }); });
  const firstOlder = older.length ? dayOf(older[0].taken) : null;

  return (
    <div className="screen" role="dialog" aria-label="Choose from gallery" style={{ zIndex: 40 }}>
      <div className="topbar">
        <button className="iconbtn" aria-label="Close gallery" onClick={onClose}><Icon name="close" size={17} stroke={2.2} /></button>
        <div className="stack gap2" style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>Choose from gallery</span>
          <span className="small muted">{anchor ? "Starting at " + relDay(anchor) : "Newest first"}</span>
        </div>
      </div>
      {access === "none" ? (
        <div className="stack gap12" style={{ padding: "30px 24px", alignItems: "center", textAlign: "center" }}>
          <span style={{ width: 60, height: 60, borderRadius: "50%", background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="image" size={26} color="var(--accent)" /></span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Let Glimpse see your photos and videos</span>
          <span className="muted small" style={{ lineHeight: 1.5, maxWidth: 300 }}>So it can show them by day and open at the day you're adding to. Nothing leaves your phone until you pick a clip.</span>
          {asked ? (
            <>
              <span className="small faint" style={{ lineHeight: 1.45, maxWidth: 300 }}>If Android doesn't ask, allow "Photos and videos" for Glimpse in Settings.</span>
              <button className="btn" onClick={() => phone.openSettings()}>Open settings</button>
            </>
          ) : <button className="btn" onClick={ask}>Allow access</button>}
          <button className="btn ghost sm" onClick={onBrowse}>Browse files instead</button>
        </div>
      ) : (
        <div className="scroll" style={{ padding: "0 2px 24px" }}>
          {access === "partial" ? (
            <div className="hrow gap10" style={{ margin: "0 16px 12px", padding: "10px 12px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}>
              <span className="small muted" style={{ flex: 1, lineHeight: 1.4 }}>Glimpse can only see the photos and videos you chose.</span>
              <button className="chipbtn" onClick={ask}>Choose more</button>
            </div>
          ) : null}
          {more.newer ? <div style={{ padding: "0 16px 12px" }}><button className="btn ghost sm" onClick={loadNewer}><Icon name="chevD" size={15} style={{ transform: "rotate(180deg)" }} />Show newer</button></div> : null}
          {anchor && older.length && firstOlder !== anchor && !newer.length ? <span className="small faint" style={{ display: "block", padding: "0 18px 10px", lineHeight: 1.4 }}>Nothing from {dayLabel(anchor)}. Showing {relDay(firstOlder)} and earlier.</span> : null}
          {groups.map((g) => (
            <section key={g.day} aria-label={dayLabel(g.day)}>
              <div className="hrow gap8" style={{ padding: "14px 16px 8px" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: g.day === anchor ? "var(--accent)" : "var(--fg)" }}>{relDay(g.day)}</span>
                {g.day === anchor ? <span className="tag accent">Adding to this day</span> : null}
                <span className="small faint" style={{ marginLeft: "auto" }}>{g.items.length}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 2 }}>
                {g.items.map((it) => (
                  <button key={it.id} onClick={() => onPick(it)} aria-label={(it.kind === "video" ? "Video, " + fmtSec(it.duration) : "Photo") + ", " + dayLabel(g.day)}
                    style={{ position: "relative", aspectRatio: "1", border: "none", padding: 0, background: thumbs[it.id] ? "url(" + thumbs[it.id] + ") center/cover" : "var(--surface)", outline: g.day === anchor ? "1px solid rgba(232,163,61,0.35)" : "none", outlineOffset: -1 }}>
                    {it.kind === "video" ? <span className="hrow gap4" style={{ position: "absolute", right: 4, bottom: 4, padding: "1px 5px", borderRadius: 5, background: "rgba(0,0,0,0.55)", fontSize: 10.5, fontWeight: 700, color: "#F2EFE9" }}><Icon name="play" size={9} />{fmtSec(it.duration)}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
          {access !== "loading" && !busy && !all.length ? (
            <div className="stack gap10" style={{ padding: 40, textAlign: "center", alignItems: "center" }}>
              <span className="small faint">{anchor ? "No photos or videos from " + dayLabel(anchor) + " or earlier." : "No photos or videos on this phone yet."}</span>
              <button className="btn ghost sm" onClick={onBrowse}>Browse files instead</button>
            </div>
          ) : null}
          {err ? <span className="small" style={{ display: "block", padding: 20, color: "var(--danger)" }}>{err}</span> : null}
          <div ref={end} style={{ height: 1 }} />
          {busy ? <span className="small faint" style={{ display: "block", textAlign: "center", padding: 16 }}>Loading…</span> : null}
        </div>
      )}
    </div>
  );
}
