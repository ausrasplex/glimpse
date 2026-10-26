import React from "react";
import { useApp, api } from "../store.jsx";
import { fileUrl } from "../platform.js";
import { Icon } from "../icons.jsx";
import { Screen, TopBar, Opts } from "../ui.jsx";
import { todayKey, relDay, dayLabel } from "../util.js";

const { useState, useEffect } = React;

export function ImmichPicker() {
  const { db, nav, draft, setDraft, act, toast } = useApp();
  const [kind, setKind] = useState("video");
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const want = draft && draft.date && draft.date !== todayKey() ? draft.date : null;
  const used = new Set(db.media.filter((m) => m.immichId).map((m) => m.immichId));
  const load = (page, reset) => {
    setErr("");
    api("/api/immich/assets?type=" + kind + "&page=" + page).then((r) => { setItems((cur) => (reset || !cur ? r.items : cur.concat(r.items))); setNext(r.nextPage); }).catch((e) => { setErr(e.message); setItems([]); });
  };
  useEffect(() => { setItems(null); load(1, true); }, [kind]);
  const pick = async (a) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await act("immichImport", { assetId: a.id, kind: a.kind }, { noRefresh: true });
      setDraft(Object.assign({}, draft || {}, { source: "server", mediaId: r.mediaId, immichId: a.id, kind: a.kind, date: a.date || (draft && draft.date), fileName: (a.kind === "photo" ? "Photo · " : "Video · ") + (a.date ? dayLabel(a.date) : "") }));
      nav.back();
    } catch (e) { setBusy(false); }
  };
  const days = [];
  (items || []).forEach((a) => { const last = days[days.length - 1]; if (last && last.date === a.date) last.items.push(a); else days.push({ date: a.date, items: [a] }); });
  const ordered = want ? days.filter((x) => x.date === want).concat(days.filter((x) => x.date !== want)) : days;
  return (
    <Screen>
      <TopBar title="Choose from Immich" sub="Your own library" />
      <div style={{ padding: "4px 20px 10px", flexShrink: 0 }}><Opts value={kind} onChange={setKind} options={[{ id: "video", label: "Videos" }, { id: "photo", label: "Photos" }]} /></div>
      <div className="scroll pad stack gap20" style={{ paddingTop: 10 }}>
        {err ? <span className="errtext">{err}</span> : null}
        {items === null ? <span className="small faint">Loading your library…</span> : null}
        {items && !items.length && !err ? <span className="small muted">No {kind === "photo" ? "photos" : "videos"} found in your Immich library.</span> : null}
        {want && items && items.length && !days.some((x) => x.date === want) ? <span className="small muted" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--line)" }}>No {kind === "photo" ? "photos" : "videos"} from {dayLabel(want)} in what's loaded so far.</span> : null}
        {ordered.map((g) => (
          <div key={g.date} className="stack gap8">
            <div className="hrow between"><span className="sec" style={{ color: g.date === want ? "var(--accent)" : undefined }}>{g.date === want ? "The day you're filling · " : ""}{g.date ? relDay(g.date) : "Unknown date"}</span><span className="small faint">{g.items.length} {kind === "photo" ? (g.items.length === 1 ? "photo" : "photos") : g.items.length === 1 ? "video" : "videos"}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 4 }}>
              {g.items.map((a) => (
                <button key={a.id} disabled={busy} onClick={() => pick(a)} aria-label={(a.kind === "photo" ? "Photo from " : "Video from ") + (a.date ? dayLabel(a.date) : "unknown date") + (a.kind === "video" ? ", " + a.dur + " seconds" : "") + (used.has(a.id) ? ", already used" : "")} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 6, border: "none", padding: 0, background: "url(" + fileUrl("/api/immich/thumb/" + a.id) + ") center/cover, var(--surface)", overflow: "hidden" }}>
                  {a.kind === "video" ? <span style={{ position: "absolute", right: 5, bottom: 5, padding: "1px 5px", borderRadius: 5, background: "rgba(0,0,0,0.5)", fontSize: 10.5, fontWeight: 700, color: "#F2EFE9" }}>{Math.floor(a.dur / 60)}:{String(a.dur % 60).padStart(2, "0")}</span> : null}
                  {a.orient !== "portrait" ? <span style={{ position: "absolute", left: 5, bottom: 6, width: a.orient === "landscape" ? 14 : 10, height: 10, borderRadius: 2, border: "1.5px solid rgba(255,255,255,0.85)" }} /> : null}
                  {used.has(a.id) ? <span className="hrow gap4" style={{ position: "absolute", left: 5, top: 5, padding: "1px 6px", borderRadius: 5, background: "rgba(0,0,0,0.55)", fontSize: 10, fontWeight: 700, color: "var(--accent)" }}><Icon name="check" size={10} stroke={3} />Used</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
        {next ? <button className="btn outline" onClick={() => load(next)}>Load older</button> : null}
        <span className="small faint" style={{ textAlign: "center", lineHeight: 1.45, padding: "6px 10px 20px" }}>{kind === "photo" ? "A photo plays as a short clip with gentle movement. " : ""}Only your own Immich library is shown. Glimpse copies the original you pick, so it keeps working if you later delete it in Immich.</span>
      </div>
    </Screen>
  );
}
