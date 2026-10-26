// Start-up for the Android app: pick a Glimpse server (first launch), check it can talk to this app, then load the
// interface with the person's data. The native bridge must load before the interface reads window.GlimpseApp.
import g, { MIN_SERVER_API, launchLink } from "./native.js";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import React from "react";
import { createRoot } from "react-dom/client";
import ClientApp from "../../src/client/main.jsx";
import { api } from "../../src/client/store.jsx";
import "../../src/client/styles.css";

const root = createRoot(document.getElementById("root"));
const show = (el) => root.render(<div className="stage"><main className="device">{el}</main></div>);

// Home servers often have no HTTPS; that's fine on the home network, worth a word elsewhere.
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?(::1|f[cd][0-9a-f]{2}:)|[^.]+$|.*\.(local|lan|home|internal|home\.arpa)$)/i;
export function tidyAddress(raw) {
  let s = (raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = (PRIVATE.test(s.split(/[:/]/)[0]) ? "http://" : "https://") + s;
  try { const u = new URL(s); return u.origin + u.pathname.replace(/\/+$/, ""); } catch (e) { return ""; }
}
const insecure = (url) => { try { const u = new URL(url); return u.protocol === "http:" && !PRIVATE.test(u.hostname); } catch (e) { return false; } };

// Is this a Glimpse server this app can use? Resolves to its public data, or throws with a message to show.
// Asked by Android itself rather than the page: a server too old to answer the app's pages (no CORS headers) still
// gets recognised, and told it needs an update, instead of looking unreachable.
async function probe(url) {
  let r, b = null;
  try {
    if (Capacitor.isNativePlatform()) {
      r = await CapacitorHttp.get({ url: url + "/api/public", headers: { "X-Glimpse-App": "1" }, connectTimeout: 12000, readTimeout: 12000, responseType: "json" });
      b = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    } else {
      const res = await fetch(url + "/api/public", { headers: { "X-Glimpse-App": "1" } });
      r = { status: res.status };
      b = await res.json();
    }
  } catch (e) {
    if (!r) { const err = new Error("Couldn't reach " + url + ". Check the address, and that your phone can reach that network."); err.offline = true; throw err; }
  }
  if (!(r.status >= 200 && r.status < 300) || !b || !b.server || !b.server.name) throw new Error("That address answered, but it isn't a Glimpse server.");
  if (!(b.server.appApi >= MIN_SERVER_API)) { const err = new Error("old"); err.old = b.server.version || "an older version"; throw err; }
  return b;
}

function Connect({ initial, error }) {
  const [addr, setAddr] = React.useState(initial || "");
  const [err, setErr] = React.useState(error || "");
  const [busy, setBusy] = React.useState(false);
  const [warned, setWarned] = React.useState(null);
  const url = tidyAddress(addr);
  const go = async (e) => {
    if (e) e.preventDefault();
    if (!url) { setErr("Enter your Glimpse server's address."); return; }
    if (insecure(url) && warned !== url) { setWarned(url); setErr(""); return; }
    setBusy(true); setErr("");
    try {
      await probe(url);
      await g.setServer(url);
      start();
    } catch (x) {
      setBusy(false);
      setErr(x.old ? "This server runs Glimpse " + x.old + ", which is too old for this app. Ask whoever runs it to update." : x.message);
    }
  };
  return (
    <div className="screen" style={{ padding: "calc(56px + env(safe-area-inset-top, 0px)) 24px 24px", gap: 0 }}>
      <form className="stack gap16" onSubmit={go} style={{ flex: 1 }}>
        <div className="stack gap8">
          <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" }}>Your Glimpse server</span>
          <span className="muted" style={{ lineHeight: 1.5 }}>Glimpse keeps your clips on your own server. Enter the address you use for it in a browser.</span>
        </div>
        <div className="stack gap6">
          <label className="sec" htmlFor="srv">Server address</label>
          <input id="srv" className="input" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="glimpse.example.com or 192.168.1.10:4444" value={addr} onChange={(e) => { setAddr(e.target.value); setErr(""); }} />
          {url && url !== addr.trim() ? <span className="small faint">Connecting to {url}</span> : null}
        </div>
        {warned === url ? (
          <div className="stack gap6" style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(232,163,61,0.1)", border: "1px solid rgba(232,163,61,0.45)" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>This address doesn't use HTTPS</span>
            <span className="small muted" style={{ lineHeight: 1.45 }}>Outside your home network, your password and clips would travel unencrypted. Fine for testing; for everyday use, set up HTTPS on the server.</span>
          </div>
        ) : null}
        {err ? <span className="small" role="alert" style={{ color: "var(--danger)", lineHeight: 1.45 }}>{err}</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn" type="submit" disabled={busy}>{busy ? "Connecting…" : warned === url ? "Connect anyway" : "Connect"}</button>
      </form>
    </div>
  );
}

function Problem({ title, body }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="screen" style={{ padding: "calc(56px + env(safe-area-inset-top, 0px)) 24px 24px" }}>
      <div className="stack gap10" style={{ flex: 1 }}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>{title}</span>
        <span className="muted" style={{ lineHeight: 1.5 }}>{body}</span>
      </div>
      <div className="stack gap8">
        <button className="btn" disabled={busy} onClick={() => { setBusy(true); start(); }}>{busy ? "Trying…" : "Try again"}</button>
        <button className="btn outline" onClick={async () => { const was = g.server; await g.forgetServer(); show(<Connect initial={was} />); }}>Use a different server</button>
      </div>
    </div>
  );
}

// An invite link for a different server than the one this app is on: ask before switching.
function SwitchForInvite({ inv }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const host = (u) => u.replace(/^https?:\/\//, "");
  const go = async () => {
    setBusy(true); setErr("");
    try { await probe(inv.server); } catch (x) { setBusy(false); setErr(x.old ? "That server runs an older Glimpse that this app can't use yet." : x.message); return; }
    await g.setServer(inv.server);
    window.history.replaceState({ g: 1 }, "", "/invite/" + encodeURIComponent(inv.token));
    start();
  };
  return (
    <div className="screen" style={{ padding: "calc(56px + env(safe-area-inset-top, 0px)) 24px 24px" }}>
      <div className="stack gap10" style={{ flex: 1 }}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>Join a different server?</span>
        <span className="muted" style={{ lineHeight: 1.5 }}>This invite is for <b>{host(inv.server)}</b>. Glimpse is connected to <b>{host(g.server)}</b>. Joining switches the app to the new server; you can switch back from Profile.</span>
        {err ? <span className="small" role="alert" style={{ color: "var(--danger)", lineHeight: 1.45 }}>{err}</span> : null}
      </div>
      <div className="stack gap8">
        <button className="btn" disabled={busy} onClick={go}>{busy ? "Connecting…" : "Switch and join"}</button>
        <button className="btn outline" disabled={busy} onClick={() => start()}>Stay on {host(g.server)}</button>
      </div>
    </div>
  );
}

export async function start() {
  await launchLink();
  await g.load();
  // Opened from an invite link: connect to its server (asking first if this app is on another one), then show the invite.
  const inv = await g.takeInvite();
  if (inv) {
    if (g.server && g.server !== inv.server) { show(<SwitchForInvite inv={inv} />); return; }
    if (!g.server) {
      try { await probe(inv.server); } catch (x) { show(<Connect initial={inv.server} error={x.old ? "That server runs an older Glimpse that this app can't use yet." : x.message} />); return; }
      await g.setServer(inv.server);
    }
    window.history.replaceState({ g: 1 }, "", "/invite/" + encodeURIComponent(inv.token));
  }
  if (!g.server) { show(<Connect />); return; }
  let pub;
  try { pub = await probe(g.server); }
  catch (x) {
    if (x.old) show(<Problem title="Please update your Glimpse server" body={"Your server (" + g.server + ") runs Glimpse " + x.old + ". This app needs a newer one. Ask whoever runs it to update, then try again."} />);
    else show(<Problem title="Can't reach your server" body={x.message} />);
    return;
  }
  // Signed in: the person's data. Signed out (or the token was revoked): the sign-in screen.
  let initial = null;
  if (g.token) { try { initial = await api("/api/bootstrap"); } catch (e) { if (e.status === 401) g.setToken(null); } }
  root.render(<ClientApp initial={initial || pub} />);
}

start();
