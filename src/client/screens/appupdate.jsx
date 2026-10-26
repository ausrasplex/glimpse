// Updates for the Android app, from GitHub Releases: Profile › App, and a card on Home when one is waiting.
// Not used on the website.
import React from "react";
import { Icon } from "../icons.jsx";
import { Toggle } from "../ui.jsx";
import { app } from "../platform.js";

const { useState, useEffect } = React;
const updates = app && app.updates ? app.updates : null;

// The first few lines of a release's notes, as plain text.
const notesOf = (rel) => (rel.notes || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/^#+\s*|^[-*]\s+/, "").replace(/\*\*|__|`/g, "").trim()).filter((l) => l && !/^sha-?256/i.test(l)).slice(0, 6);

export function AppUpdates() {
  const [daily, setDaily] = useState(true);
  const [state, setState] = useState({ step: "idle" });
  useEffect(() => { if (updates) updates.dailyOn().then(setDaily); }, []);
  if (!updates) return null;
  const check = async () => {
    setState({ step: "checking" });
    try {
      const rel = await updates.latest();
      setState(rel && updates.isNewer(rel) ? { step: "available", rel } : { step: "current" });
    } catch (e) { setState({ step: "error", error: e.message }); }
  };
  const install = async (rel) => {
    if (!(await updates.canInstall())) { setState({ step: "permission", rel }); return; }
    setState({ step: "downloading", rel, pct: 0 });
    try {
      await updates.install(rel, (p) => setState({ step: "downloading", rel, pct: p }));
      setState({ step: "installer", rel });
    } catch (e) { setState({ step: "available", rel, error: e.message }); }
  };
  const rel = state.rel;
  return (
    <>
      <div className="sec" style={{ marginTop: 30, marginBottom: 10 }}>App</div>
      <div className="stack gap12" style={{ padding: 14, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}>
        <div className="hrow between gap12">
          <span className="stack gap2" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Glimpse for Android</span>
            <span className="small muted">Version {app.version}</span>
          </span>
          {state.step === "idle" || state.step === "current" || state.step === "error" ? <button className="chipbtn" onClick={check}>Check for updates</button> : null}
          {state.step === "checking" ? <span className="small muted">Checking…</span> : null}
        </div>
        {state.step === "current" ? <span className="small" style={{ color: "var(--ok)" }}>You have the latest version.</span> : null}
        {state.step === "error" ? <span className="small" style={{ color: "var(--danger)", lineHeight: 1.45 }}>{state.error}</span> : null}
        {rel ? (
          <div className="stack gap10" style={{ padding: 12, borderRadius: 10, background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Version {rel.version} is available</span>
            {notesOf(rel).length ? <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>{notesOf(rel).map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
            {state.step === "permission" ? (
              <>
                <span className="small" style={{ lineHeight: 1.45 }}>Android needs your OK first: allow <b>Install unknown apps</b> for Glimpse, then come back and tap Update again.</span>
                <div className="grid2">
                  <button className="btn sm" onClick={() => updates.openInstallSettings()}>Open setting</button>
                  <button className="btn ghost sm" onClick={() => install(rel)}>Update</button>
                </div>
              </>
            ) : state.step === "downloading" ? (
              <div className="stack gap6">
                <span className="small muted">Downloading · {Math.round((state.pct || 0) * 100)}%</span>
                <div style={{ height: 4, borderRadius: 2, background: "var(--line)" }}><div style={{ height: 4, borderRadius: 2, width: (state.pct || 0) * 100 + "%", background: "var(--accent)", transition: "width .3s" }} /></div>
              </div>
            ) : state.step === "installer" ? (
              <span className="small" style={{ lineHeight: 1.45 }}>Android's installer is open. Tap <b>Update</b> there to finish; Glimpse restarts on the new version.</span>
            ) : (
              <>
                {state.error ? <span className="small" style={{ color: "var(--danger)", lineHeight: 1.45 }}>{state.error}</span> : null}
                <div className="grid2">
                  <button className="btn sm" onClick={() => install(rel)}><Icon name="download" size={15} />Update</button>
                  <button className="btn ghost sm" onClick={() => updates.openPage(rel)}>Release notes</button>
                </div>
              </>
            )}
          </div>
        ) : null}
        <div className="hrow between gap12">
          <span className="stack gap2"><span style={{ fontSize: 13.5, fontWeight: 600 }}>Check daily</span><span className="small muted">Shows a note on Home when there's a new version</span></span>
          <Toggle on={daily} onChange={(v) => { setDaily(v); updates.setDaily(v); }} label="Check for updates daily" />
        </div>
      </div>
    </>
  );
}

// Profile › Reminders: reminders reach the phone as notifications once Android allows them.
export function ReminderPermission() {
  const [perm, setPerm] = useState("granted");
  const refresh = () => app.reminders.permission().then(setPerm).catch(() => {});
  useEffect(() => {
    refresh();
    // Back from Android's settings: check again.
    const back = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  if (!app.reminders || perm === "granted") return null;
  const blocked = perm === "denied";
  const turnOn = async () => {
    if (blocked) { app.openAppSettings(); return; }
    const p = await app.reminders.ask().catch(() => "denied");
    setPerm(p);
    if (p === "granted" && app.syncReminders) app.syncReminders();
  };
  return (
    <div className="hrow gap10" style={{ margin: "0 0 8px", padding: "10px 12px", borderRadius: 12, background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
      <Icon name="bell" size={18} color="var(--accent)" />
      <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>Get reminders on this phone</span>
        <span className="small muted" style={{ lineHeight: 1.4 }}>{blocked ? "Notifications are off for Glimpse. Turn them on in Android's settings." : "Glimpse needs your OK to show notifications. In-app reminders then arrive on time, even offline."}</span>
      </span>
      <button className="chipbtn" onClick={turnOn}>{blocked ? "Settings" : "Turn on"}</button>
    </div>
  );
}

// On Home: a small card when the daily check found a newer version.
export function UpdateBanner({ onOpen }) {
  const [rel, setRel] = useState(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (updates) updates.daily().then(setRel).catch(() => {}); }, []);
  if (!rel || hidden) return null;
  return (
    <div className="hrow gap12" style={{ margin: "0 20px 14px", padding: "10px 12px", borderRadius: 14, background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
      <Icon name="download" size={18} color="var(--accent)" />
      <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>Glimpse {rel.version} is available</span>
        <span className="small muted">Update from Profile › App</span>
      </span>
      <button className="chipbtn" onClick={onOpen}>View</button>
      <button className="iconbtn plain" aria-label="Hide" onClick={() => setHidden(true)} style={{ width: 28, height: 28 }}><Icon name="close" size={14} /></button>
    </div>
  );
}
