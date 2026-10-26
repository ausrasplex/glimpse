import React from "react";
import { useApp, post, api } from "../store.jsx";
import { app, apiUrl, apiHeaders, signedOut } from "../platform.js";
import { Icon } from "../icons.jsx";
import { AppUpdates, ReminderPermission } from "./appupdate.jsx";
import { Screen, TopBar, Sheet, Avatar, Toggle, ToggleRow, Swatches, Confirm, TimezonePicker, detectedZone, PassInput, Strength, Opts, Choice, useDragList, move } from "../ui.jsx";
import * as S from "../sel.js";
import { MONTH, ACCENTS, PALETTE, uid, hexA } from "../util.js";

const { useState, useRef, useEffect } = React;

const fmtTime = (t) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; const hh = h % 12 || 12; return { time: hh + ":" + String(m).padStart(2, "0"), ap }; };
const DAYNAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const daysSummary = (days) => { const n = days.filter(Boolean).length; if (n === 7) return "Every day"; if (!n) return "No days"; if (days.slice(0, 5).every(Boolean) && !days[5] && !days[6]) return "Weekdays"; if (!days.slice(0, 5).some(Boolean) && days[5] && days[6]) return "Weekends"; return n + " days a week"; };

function AvatarSheet({ open, onClose }) {
  const { act, refresh, me, toast } = useApp();
  const [step, setStep] = useState("choose");
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(130);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const ref = useRef(null);
  const drag = useRef(null);
  useEffect(() => { if (open) { setStep("choose"); setImg(null); setZoom(130); setOff({ x: 0, y: 0 }); } }, [open]);
  if (!open) return null;
  const pick = (f) => { const r = new FileReader(); r.onload = () => { const i = new Image(); i.onload = () => { setImg({ src: r.result, w: i.width, h: i.height, el: i }); setStep("crop"); }; i.src = r.result; }; r.readAsDataURL(f); };
  const C = 280;
  const base = img ? Math.max(C / img.w, C / img.h) : 1;
  const sc = base * zoom / 100;
  const save = () => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    const k = 256 / C;
    const w = img.w * sc * k, h = img.h * sc * k;
    g.drawImage(img.el, (256 - w) / 2 + off.x * k, (256 - h) / 2 + off.y * k, w, h);
    c.toBlob(async (blob) => {
      try { await fetch(apiUrl("/api/upload/avatar"), { method: "POST", body: blob, headers: Object.assign({ "Content-Type": "image/jpeg" }, apiHeaders()) }).then((r) => { if (!r.ok) throw new Error(); }); await refresh(); toast("Profile photo updated"); }
      catch (e) { toast("Couldn't save that photo. Try again.", null, "warn"); }
      onClose();
    }, "image/jpeg", 0.85);
  };
  if (step === "crop" && img) {
    return (
      <div className="overlay" role="dialog" aria-label="Crop photo" style={{ background: "var(--bg-deep)", justifyContent: "stretch" }}>
        <div className="hrow between" style={{ padding: 20 }}>
          <button className="link" style={{ color: "var(--muted)", fontSize: 14 }} onClick={() => setStep("choose")}>Cancel</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Move and scale</span>
          <button className="link" style={{ fontSize: 14, fontWeight: 700 }} onClick={save}>Save</button>
        </div>
        <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", cursor: "grab" }}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!drag.current) return; setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }); }}
          onPointerUp={() => { drag.current = null; }}>
          <img src={img.src} alt="" draggable="false" style={{ position: "absolute", width: img.w * sc, height: img.h * sc, maxWidth: "none", transform: "translate(" + off.x + "px," + off.y + "px)", userSelect: "none", pointerEvents: "none" }} />
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at center, transparent 0 " + C / 2 + "px, rgba(0,0,0,0.65) " + (C / 2 + 1) + "px)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", width: C, height: C, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.85)", pointerEvents: "none" }} />
        </div>
        <div className="stack gap10" style={{ padding: "20px 28px calc(30px + env(safe-area-inset-bottom, 0px))" }}>
          <div className="hrow between small muted"><label htmlFor="av-zoom">Zoom</label><span className="num">{zoom}%</span></div>
          <input id="av-zoom" className="range" type="range" min="100" max="250" step="5" value={zoom} onChange={(e) => setZoom(+e.target.value)} />
          <span className="small faint" style={{ textAlign: "center" }}>Drag the photo to position it. Saved as a 256 × 256 image.</span>
        </div>
      </div>
    );
  }
  return (
    <Sheet open onClose={onClose} title="Profile photo">
      <div className="stack gap8">
        <button className="hrow gap14" onClick={() => ref.current && ref.current.click()} style={{ padding: 14, borderRadius: 12, background: "#1F1E1B", border: "none", color: "var(--fg)", fontSize: 14.5, fontWeight: 600 }}><Icon name="image" size={20} color="var(--accent)" />Choose a photo</button>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pick(f); e.target.value = ""; }} />
        {me.photo ? <button className="hrow gap14" onClick={() => { act("removeAvatar").then(() => toast("Photo removed")).catch(() => {}); onClose(); }} style={{ padding: 14, borderRadius: 12, background: "#1F1E1B", border: "none", color: "var(--danger)", fontSize: 14.5, fontWeight: 600 }}><Icon name="trash" size={20} />Remove photo · use initial</button> : null}
        <span className="small faint" style={{ padding: "4px 2px" }}>On a phone, "Choose a photo" also offers the camera.</span>
      </div>
    </Sheet>
  );
}

function Field({ id, label, value, onCommit, type, validate }) {
  const [v, setV] = useState(value);
  const [err, setErr] = useState("");
  useEffect(() => setV(value), [value]);
  return (
    <div className="stack gap6" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid " + (err ? "var(--danger)" : "var(--line)") }}>
      <label className="sec" style={{ fontSize: 10.5 }} htmlFor={id}>{label}</label>
      <input id={id} type={type || "text"} value={v} onChange={(e) => { setV(e.target.value); setErr(""); }} onBlur={() => { if (v === value) return; const e = validate ? validate(v) : ""; if (e) { setErr(e); return; } onCommit(v.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} style={{ background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 14.5, padding: 0 }} />
      {err ? <span className="errtext">{err}</span> : null}
    </div>
  );
}

const SSO_LINK_ERRORS = { linked_elsewhere: "That SSO account is already linked to someone else on this server.", email_unverified: "Your identity provider didn't confirm your email address.", sso_off: "Single sign-on is turned off.", failed: "Linking didn't work. Try again." };
export function Profile({ params }) {
  const [unlink, setUnlink] = useState(false);
  useEffect(() => {
    if (params && params.linked) toast("Single sign-on linked to your account");
    if (params && params.ssoError) toast(SSO_LINK_ERRORS[params.ssoError] || SSO_LINK_ERRORS.failed, null, "warn");
  }, []);
  const [imSheet, setImSheet] = useState(false);
  const [imKey, setImKey] = useState("");
  const { db, act, local, actSoon, refresh, nav, me, toast } = useApp();
  const [avatar, setAvatar] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const pf = S.prefs(db, me.id);
  const setPref = (o) => { local((n) => { n.prefs[me.id] = Object.assign({}, S.prefs(n, me.id), o); }); actSoon("prefs-" + Object.keys(o).join(), "setPrefs", o, 150); };
  const joined = new Date(me.joinedAt);
  const reminders = db.reminders.filter((r) => r.userId === me.id);
  const moods = db.moods[me.id] || [];
  const shown = moods.filter((m) => !m.hidden);
  const admins = db.users.filter((u) => u.role === "ADMIN" && !u.disabled);
  const lastAdmin = me.role === "ADMIN" && admins.length === 1;
  const deleteAccount = async () => {
    try { await act("deleteMyAccount", {}, { noRefresh: true }); } catch (e) { return; }
    toast("Your account was deleted");
    await refresh();
    nav.reset("login");
  };
  const sso = db.server.sso || {};
  const im = db.server.immich || {};
  const hasPw = !!me.hasPassword;
  const ssoText = "Sign in with " + ((sso.label || "").trim() || "SSO");
  return (
    <Screen>
      <TopBar title="Profile" />
      <Sheet open={imSheet} onClose={() => setImSheet(false)} title="Connect Immich">
        <div className="stack gap14">
          <div className="stack gap4"><span style={{ fontSize: 17, fontWeight: 700 }}>Connect your Immich library</span><span className="small muted" style={{ lineHeight: 1.45 }}>In Immich, open Account settings › API keys, create a key called “Glimpse” with read-only access to your assets, then paste it here.</span></div>
          <input className="input" aria-label="Immich API key" placeholder="Paste your API key" value={imKey} onChange={(e) => setImKey(e.target.value.trim())} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} />
          <span className="small faint" style={{ lineHeight: 1.45 }}>Stored encrypted on the server and only used to list and copy the videos you pick.</span>
          <button className="btn" disabled={imKey.length < 4} onClick={() => { act("connectImmich", { key: imKey }).then(() => { setImSheet(false); toast("Immich connected. Find it under Add › Choose from Immich"); }).catch(() => {}); }}>Connect</button>
        </div>
      </Sheet>
      <Confirm open={unlink} onClose={() => setUnlink(false)} title={hasPw ? "Unlink single sign-on?" : "Set a password first"} body={hasPw ? "You'll sign in with your email and password instead. You can link SSO again any time." : "You don't have a Glimpse password yet, so unlinking SSO would leave you no way to sign in."} confirm={hasPw ? "Unlink" : "Set a password"} onConfirm={() => { setUnlink(false); if (hasPw) { act("unlinkSso").then(() => toast("SSO unlinked")).catch(() => {}); } else nav.go("password"); }} />
      <div className="scroll pad" style={{ paddingTop: 8 }}>
        <div className="stack" style={{ alignItems: "center", padding: "18px 0 8px" }}>
          <div style={{ position: "relative" }}>
            <Avatar user={me} size={88} ring={false} />
            <button aria-label="Change photo" onClick={() => setAvatar(true)} style={{ position: "absolute", bottom: -2, right: -2, width: 30, height: 30, borderRadius: "50%", background: "var(--accent)", border: "3px solid var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)" }}><Icon name="camera" size={14} stroke={2.3} /></button>
          </div>
          <span style={{ marginTop: 12, fontSize: 17, fontWeight: 700 }}>{me.name}</span>
          <span className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Joined {MONTH[joined.getMonth()]} {joined.getFullYear()}{me.role === "ADMIN" ? " · Server admin" : ""}</span>
        </div>
        <div className="sec" style={{ marginTop: 22, marginBottom: 10 }}>Account</div>
        <div className="stack gap10">
          <Field id="pf-name" label="Display name" value={me.name} validate={(v) => (v.trim() ? "" : "Your name can't be empty")} onCommit={(v) => { act("updateProfile", { name: v }).then(() => toast("Name saved")).catch(() => {}); }} />
          <Field id="pf-email" label="Email" type="email" value={me.email} validate={(v) => (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "That doesn't look like an email address" : "")} onCommit={(v) => { act("updateProfile", { email: v.trim() }).then(() => toast("Email saved")).catch(() => {}); }} />
          {tzOpen ? <TimezonePicker value={me.tz} onChange={(v) => { act("updateProfile", { tz: v }).then(() => toast("Timezone saved. Reminders follow it")).catch(() => {}); setTzOpen(false); }} detected={detectedZone()} /> : (
            <button className="hrow between" onClick={() => setTzOpen(true)} style={{ padding: 14, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)", textAlign: "left" }}>
              <span className="stack gap2"><span className="sec" style={{ fontSize: 10.5 }}>Timezone</span><span style={{ fontSize: 14.5 }}>{me.tz}</span></span><Icon name="chevR" size={16} color="var(--faint)" />
            </button>
          )}
          <button className="hrow between" onClick={() => nav.go("password")} style={{ padding: 14, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)" }}>
            <span className="hrow gap12"><span style={{ width: 34, height: 34, borderRadius: 10, background: "#232220", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="lock" size={16} color="var(--muted)" /></span><span className="stack gap2" style={{ textAlign: "left" }}><span style={{ fontSize: 14, fontWeight: 600 }}>{hasPw ? "Change password" : "Set a password"}</span>{!hasPw ? <span className="small muted">You sign in with SSO only</span> : null}</span></span>
            <Icon name="chevR" size={16} color="var(--faint)" />
          </button>
          {im.on ? (
            <div className="hrow between gap12" style={{ padding: 14, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}>
              <span className="hrow gap12" style={{ minWidth: 0 }}><span style={{ width: 34, height: 34, borderRadius: 10, background: me.immich ? "var(--accent-soft)" : "#232220", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="image" size={16} color={me.immich ? "var(--accent)" : "var(--muted)"} /></span><span className="stack gap2" style={{ minWidth: 0 }}><span style={{ fontSize: 14, fontWeight: 600 }}>Immich</span><span className="small muted ellipsis">{me.immich ? "Connected · pick videos from your library" : "Pick videos straight from your library"}</span></span></span>
              <button className="chipbtn" onClick={() => { if (me.immich) { act("disconnectImmich").then(() => toast("Immich disconnected. Glimpses you already added stay")).catch(() => {}); } else { setImKey(""); setImSheet(true); } }}>{me.immich ? "Disconnect" : "Connect"}</button>
            </div>
          ) : null}
          {sso.on ? (
            <div className="hrow between gap12" style={{ padding: 14, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}>
              <span className="hrow gap12" style={{ minWidth: 0 }}><span style={{ width: 34, height: 34, borderRadius: 10, background: me.sso ? "var(--accent-soft)" : "#232220", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="key" size={16} color={me.sso ? "var(--accent)" : "var(--muted)"} /></span><span className="stack gap2" style={{ minWidth: 0 }}><span style={{ fontSize: 14, fontWeight: 600 }}>Single sign-on</span><span className="small muted ellipsis">{me.sso ? "Linked · " + me.email : "Not linked yet"}</span></span></span>
              <button className="chipbtn" onClick={() => {
                if (!me.sso) { if (app) { toast("Link your SSO account from Glimpse in a web browser, then sign in here with it", null, "warn"); return; } window.location.href = "/api/auth/oidc/start?link=1"; return; }
                if (!sso.passwordLogin) { toast("This server only uses SSO, so unlinking would lock you out", null, "warn"); return; }
                setUnlink(true);
              }}>{me.sso ? "Unlink" : "Link"}</button>
            </div>
          ) : null}
        </div>

        <div className="sec" style={{ marginTop: 30, marginBottom: 10 }}>Preferences</div>
        <div className="stack gap10">
          <div className="card stack gap12">
            <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 600 }}>Notification badge</span><span className="small muted">How unread notifications show on the bell</span></span>
            <div className="grid2" style={{ gap: 8 }}>
              {["dot", "count"].map((b) => (
                <button key={b} onClick={() => setPref({ badge: b })} aria-pressed={pf.badge === b} className="hrow gap10" style={{ padding: "10px 12px", borderRadius: 10, background: pf.badge === b ? "#2A2825" : "#161513", border: "1.5px solid " + (pf.badge === b ? "var(--accent)" : "var(--line)"), color: "var(--fg)" }}>
                  <span style={{ position: "relative", width: 28, height: 28, borderRadius: "50%", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="bell" size={14} color="var(--muted)" />
                    {b === "dot" ? <span style={{ position: "absolute", top: 5, right: 6, width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} /> : <span style={{ position: "absolute", top: -3, right: -5, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 8, background: "var(--accent)", color: "var(--accent-ink)", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>3</span>}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{b === "dot" ? "Dot" : "Count"}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="card"><ToggleRow title="On this day" sub="Show a glimpse from this date in past years on Home" on={pf.onThisDay !== false} onChange={(v) => setPref({ onThisDay: v })} /></div>
          <div className="card"><ToggleRow title="Milestone notifications" sub="Streaks, glimpse counts and anniversaries · in-app" on={pf.milestones} onChange={(v) => setPref({ milestones: v })} /></div>
          <div className="card stack gap12">
            <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 600 }}>Accent colour</span><span className="small muted">Buttons, highlights and streaks · {(PALETTE.find((p) => p.color === pf.accent) || { name: "Custom" }).name}</span></span>
            <Swatches value={pf.accent} onPick={(c) => setPref({ accent: c })} />
          </div>
          <div className="card stack gap10">
            <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 600 }}>Mash fill</span><span className="small muted">When a clip doesn't match the mash shape. You can change it per mash</span></span>
            <Opts value={pf.fill} onChange={(v) => setPref({ fill: v })} options={[{ id: "blur", label: "Blurred" }, { id: "crop", label: "Crop" }, { id: "bars", label: "Bars" }]} />
          </div>
          <button className="card stack gap10" onClick={() => nav.go("moods")} style={{ color: "var(--fg)", textAlign: "left" }}>
            <span className="hrow between" style={{ width: "100%" }}>
              <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 600 }}>Moods</span><span className="small muted">{shown.length} shown{moods.length - shown.length ? " · " + (moods.length - shown.length) + " hidden" : ""}</span></span>
              <span className="hrow gap4" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>Manage<Icon name="chevR" size={13} stroke={2.4} /></span>
            </span>
            <span className="hrow wrap gap6">{shown.map((m) => <span key={m.label} className="tag" style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 9px", color: "var(--fg)" }}><span className="dot" style={{ background: m.color }} />{m.label}</span>)}</span>
          </button>
          <div className="card stack gap4" style={{ paddingBottom: 8 }}>
            <span className="stack gap2" style={{ paddingBottom: 8 }}><span style={{ fontSize: 14, fontWeight: 600 }}>Reminders</span><span className="small muted">Tap a reminder to edit it</span></span>
            {app ? <ReminderPermission /> : null}
            {reminders.map((r) => {
              const t = fmtTime(r.time);
              return (
                <div key={r.id} className="hrow gap12" style={{ padding: "12px 0", borderTop: "1px solid var(--line-soft)" }}>
                  <button onClick={() => nav.go("reminder", { id: r.id })} aria-label={"Edit " + t.time + " " + t.ap + " reminder"} className="stack gap4" style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, color: "inherit", textAlign: "left" }}>
                    <span className="num" style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: r.on ? "var(--fg)" : "var(--faint)" }}>{t.time} {t.ap}</span>
                    <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{r.message}</span>
                    <span className="hrow wrap gap6" style={{ marginTop: 2 }}>
                      <span className="tag">{r.rule === "check" ? "Only if nothing logged today" : "Always sends"}</span>
                      <span className="tag">{r.email && r.inapp ? "Email + in-app" : r.email ? "Email only" : "In-app only"}</span>
                      {daysSummary(r.days) !== "Every day" ? <span className="tag">{daysSummary(r.days)}</span> : null}
                    </span>
                  </button>
                  <Toggle on={r.on} label={(r.on ? "Turn off " : "Turn on ") + t.time + " " + t.ap + " reminder"} onChange={(v) => { local((n) => { n.reminders.find((x) => x.id === r.id).on = v; }); actSoon("rem-" + r.id, "saveReminder", { id: r.id, on: v }, 100); }} />
                </div>
              );
            })}
            {!reminders.length ? <span className="small faint" style={{ padding: "8px 0" }}>No reminders. Add one so you don't miss a day.</span> : null}
            <button className="btn dashed" style={{ marginTop: 4, color: "var(--muted)" }} onClick={() => nav.go("reminder", {})}><Icon name="plus" size={14} stroke={2.4} />Add reminder</button>
          </div>
        </div>

        {app ? <AppUpdates /> : null}
        <div className="sec" style={{ marginTop: 30, marginBottom: 10 }}>Session</div>
        {app ? (
          <div className="hrow between gap12" style={{ padding: 14, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", marginBottom: 10 }}>
            <span className="stack gap2" style={{ minWidth: 0 }}><span style={{ fontSize: 14, fontWeight: 600 }}>Server</span><span className="small muted ellipsis">{app.server.replace(/^https?:\/\//, "")}</span></span>
            <button className="chipbtn" onClick={async () => { try { await post("/api/auth/logout"); } catch (e) { /* offline */ } await app.forgetServer(); window.location.replace("/"); }}>Change</button>
          </div>
        ) : null}
        <button className="btn outline" onClick={async () => { let r = null; try { r = await post("/api/auth/logout"); } catch (e) { /* offline */ } signedOut(); if (r && r.redirect && !app) { window.location.href = r.redirect; return; } await refresh(); nav.reset("login"); }}><Icon name="logout" size={16} />Log out</button>
        <button className="btn danger-ghost" style={{ marginTop: 8, fontSize: 13 }} onClick={() => setDelOpen(true)}>Delete account</button>
        <div style={{ height: 28 }} />
      </div>
      <AvatarSheet open={avatar} onClose={() => setAvatar(false)} />
      {lastAdmin ? (
        <Confirm open={delOpen} onClose={() => setDelOpen(false)} title="You're the only admin" body="Make someone else an admin in Settings › People & invites before deleting your account, so the server isn't left without one." confirm="Open Settings" onConfirm={() => { setDelOpen(false); nav.reset("settings", { open: "people" }); }} />
      ) : (
        <Confirm open={delOpen} onClose={() => setDelOpen(false)} title="Delete your account?" body="Your own projects, clips and mashes are deleted and your storage is freed. Projects you own with other people are handed to the next member. This can't be undone." confirm="Delete account" danger onConfirm={deleteAccount} />
      )}
    </Screen>
  );
}

export function ReminderEdit({ params }) {
  const { db, act, local, actSoon, refresh, nav, me, toast } = useApp();
  const existing = params.id ? db.reminders.find((r) => r.id === params.id) : null;
  const [r, setR] = useState(() => existing ? JSON.parse(JSON.stringify(existing)) : { time: "19:30", message: "", rule: "check", days: [1, 1, 1, 1, 1, 1, 1], email: false, inapp: true, on: true });
  const [del, setDel] = useState(false);
  const set = (o) => setR(Object.assign({}, r, o));
  const presets = [["Morning", "08:00"], ["Midday", "12:30"], ["Evening", "19:30"], ["Night", "21:00"]];
  const t = fmtTime(r.time);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const msg = r.message.trim();
  const emailReady = db.server.email.ok;
  const can = msg && r.days.some(Boolean) && (r.email || r.inapp);
  const save = () => {
    act("saveReminder", { id: existing ? existing.id : null, time: r.time, message: msg, rule: r.rule, days: r.days, email: r.email, inapp: r.inapp, on: r.on }).then(() => { toast(existing ? "Reminder saved" : "Reminder added for " + t.time + " " + t.ap); nav.back(); }).catch(() => {});
    return;
    toast(existing ? "Reminder saved" : "Reminder added for " + t.time + " " + t.ap); nav.back();
  };
  return (
    <Screen>
      <TopBar title={existing ? "Edit reminder" : "New reminder"} icon="close" backLabel="Cancel" />
      <div className="scroll pad stack gap24" style={{ paddingTop: 20 }}>
        <div className="stack gap10">
          <span className="sec">Time</span>
          <label className="hrow gap8" style={{ justifyContent: "center", alignItems: "baseline", padding: "18px 0 16px", borderRadius: 16, background: "#1F1E1B", border: "1px solid var(--line)", position: "relative", cursor: "pointer" }}>
            <span className="num" style={{ fontSize: 46, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{t.time}</span><span style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>{t.ap}</span>
            <input type="time" aria-label="Reminder time" value={r.time} onChange={(e) => e.target.value && set({ time: e.target.value })} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }} />
          </label>
          <Opts value={r.time} onChange={(v) => set({ time: v })} options={presets.map((p) => ({ id: p[1], label: p[0], sub: fmtTime(p[1]).time + " " + fmtTime(p[1]).ap }))} />
          <span className="small faint">Tap the time to pick any minute. Uses your timezone ({me.tz}).</span>
        </div>
        <div className="stack gap8">
          <div className="hrow between" style={{ alignItems: "baseline" }}><label className="sec" htmlFor="rm-msg">Message</label><span className="tiny" style={{ color: r.message.length >= 70 ? "var(--accent)" : "var(--ghost)" }}>{r.message.length}/80</span></div>
          <textarea id="rm-msg" className="input" rows="2" maxLength={80} placeholder="What should this reminder say?" value={r.message} onChange={(e) => set({ message: e.target.value })} />
          <div className="hrow wrap gap6">{["Don't forget today's glimpse!", "What made today memorable?", "Grab a glimpse before midnight!"].map((s) => <button key={s} onClick={() => set({ message: s })} style={{ padding: "6px 11px", borderRadius: 16, background: "#211F1D", border: "1px solid var(--line)", color: "#BDB7AD", fontSize: 12 }}>{s}</button>)}</div>
        </div>
        <div className="stack gap8">
          <span className="sec">When to send</span>
          <Choice active={r.rule === "always"} onClick={() => set({ rule: "always" })} title="Always send" desc="Sends at this time every selected day." />
          <Choice active={r.rule === "check"} onClick={() => set({ rule: "check" })} title="Only if I haven't captured yet" desc="Skipped once you've logged an entry in a daily-habit project that day." />
        </div>
        <div className="stack gap10">
          <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Repeat on</span><span className="small muted">{daysSummary(r.days)}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 6 }}>
            {days.map((l, i) => <button key={i} aria-label={DAYNAMES[i]} aria-pressed={!!r.days[i]} onClick={() => { const d = r.days.slice(); d[i] = d[i] ? 0 : 1; set({ days: d }); }} style={{ aspectRatio: "1", borderRadius: "50%", background: r.days[i] ? "var(--accent)" : "#1F1E1B", border: "1px solid " + (r.days[i] ? "var(--accent)" : "var(--line)"), color: r.days[i] ? "var(--accent-ink)" : "var(--faint)", fontSize: 13, fontWeight: 700, padding: 0 }}>{l}</button>)}
          </div>
        </div>
        <div className="stack gap10">
          <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Send to</span>{!r.email && !r.inapp ? <span className="small" style={{ color: "var(--danger)" }}>Pick at least one</span> : null}</div>
          <div className="grid2" style={{ gap: 8 }}>
            {[{ k: "email", t: "Email", d: me.email, i: "mail" }, { k: "inapp", t: "In-app", d: "Notifications panel", i: "bell" }].map((c) => { const on = r[c.k]; return (
              <button key={c.k} onClick={() => set({ [c.k]: !on })} aria-pressed={on} className="stack gap8" style={{ position: "relative", alignItems: "flex-start", padding: "13px 14px", borderRadius: 14, background: on ? "#211F1C" : "#1A1917", border: "1.5px solid " + (on ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left", minWidth: 0 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={c.i} size={16} color={on ? "var(--accent)" : "var(--faint)"} /></span>
                <span className="stack gap2" style={{ minWidth: 0, width: "100%" }}><span style={{ fontSize: 14, fontWeight: 600 }}>{c.t}</span><span className="small muted ellipsis">{c.d}</span></span>
                <span style={{ position: "absolute", top: 12, right: 12, width: 20, height: 20, borderRadius: 6, background: on ? "var(--accent)" : "transparent", border: "2px solid " + (on ? "var(--accent)" : "#4A4742"), display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? <Icon name="check" size={12} stroke={3.2} color="var(--accent-ink)" /> : null}</span>
              </button>); })}
          </div>
          {r.email && !emailReady ? <span className="small" style={{ color: "var(--accent)", lineHeight: 1.4 }}>Email isn't set up on this server yet, so only the in-app reminder will arrive until the admin sets it up.</span> : null}
        </div>
        <div className="stack gap10">
          <span className="sec">Preview</span>
          <div className="hrow gap12" style={{ alignItems: "flex-start", padding: "12px 14px", borderRadius: 14, background: "#24221F", border: "1px solid var(--line)" }}>
            <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="clock" size={16} color="var(--accent)" /></span>
            <span className="stack gap2" style={{ minWidth: 0 }}><span style={{ fontSize: 13, fontWeight: 700, color: msg ? "var(--fg)" : "var(--ghost)" }}>{msg || "Your message will appear here"}</span><span className="small muted" style={{ lineHeight: 1.4 }}>{t.time} {t.ap} · {daysSummary(r.days)} · {r.rule === "check" ? "Only if nothing logged" : "Always"} · {r.email && r.inapp ? "Email + in-app" : r.email ? "Email only" : r.inapp ? "In-app only" : "Nowhere"}</span></span>
          </div>
        </div>
        <div style={{ height: 4 }} />
      </div>
      <div className="stack gap6" style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0, borderTop: "1px solid #24221F" }}>
        <button className="btn" disabled={!can} onClick={save}>{!msg ? "Add a message to save" : !r.days.some(Boolean) ? "Pick at least one day" : !(r.email || r.inapp) ? "Pick where to send it" : existing ? "Save changes" : "Save reminder"}</button>
        {existing ? <button className="btn danger-ghost" onClick={() => setDel(true)}>Delete reminder</button> : null}
      </div>
      <Confirm open={del} onClose={() => setDel(false)} title="Delete this reminder?" body="It stops sending straight away. This can't be undone." confirm="Delete" danger onConfirm={() => { act("deleteReminder", { id: existing.id }).then(() => { toast("Reminder deleted"); nav.back(); }).catch(() => {}); }} />
    </Screen>
  );
}

function MoodRow({ m, i, open, onToggleColor, rowStyle, handle, onRename, onHide, onColor, onDelete, isLast }) {
  const [label, setLabel] = useState(m.label);
  useEffect(() => setLabel(m.label), [m.label]);
  return (
    <div style={Object.assign({ borderTop: i === 0 ? "none" : "1px solid var(--line-soft)", opacity: m.hidden ? 0.45 : 1, background: "var(--surface)" }, rowStyle)}>
      <div className="hrow gap10" style={{ padding: "8px 8px 8px 6px", height: 52 }}>
        <span {...handle} aria-label={"Drag to reorder " + m.label} style={Object.assign({ width: 22, display: "flex", justifyContent: "center", color: "var(--ghost)" }, handle.style)}><Icon name="drag" size={16} /></span>
        <button onClick={onToggleColor} aria-label={"Change colour of " + m.label} aria-expanded={open} style={{ width: 30, height: 30, flexShrink: 0, borderRadius: "50%", background: "var(--raised)", border: "1.5px solid " + (open ? "var(--accent)" : "var(--line-strong)"), padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><span className="dot" style={{ width: 14, height: 14, background: m.color }} /></button>
        <input aria-label="Mood name" maxLength={20} value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => { const v = label.trim(); if (v && v !== m.label) onRename(v); else setLabel(m.label); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 14.5, fontWeight: 600, padding: "4px 0" }} />
        {m.preset ? <span className="tag" style={{ fontSize: 10 }}>Preset</span> : null}
        <button className="iconbtn plain sq" style={{ width: 30, height: 30 }} aria-label={(m.hidden ? "Show " : "Hide ") + m.label} aria-pressed={m.hidden} onClick={onHide}><Icon name={m.hidden ? "eyeOff" : "eye"} size={17} color={m.hidden ? "var(--ghost)" : "var(--muted)"} /></button>
        {!m.preset ? <button className="iconbtn plain sq" style={{ width: 30, height: 30 }} aria-label={"Delete " + m.label} onClick={onDelete}><Icon name="trash" size={16} color="var(--danger)" /></button> : null}
      </div>
      {open ? <div style={{ padding: "4px 14px 14px 66px" }}><Swatches value={m.color} onPick={onColor} /></div> : null}
    </div>
  );
}

export function Moods() {
  const { db, act, local, actSoon, refresh, me, toast } = useApp();
  const [open, setOpen] = useState(null);
  const list = db.moods[me.id] || [];
  const setList = (fn) => { const next = fn(list.slice()); local((n) => { n.moods[me.id] = next; }); actSoon("moods", "setMoods", { list: next }, 300); };
  const drag = useDragList(list, (a, b) => setList((l) => move(l, a, b)), 53);
  const used = (label) => db.entries.filter((e) => e.authorId === me.id && e.mood === label).length;
  return (
    <Screen>
      <TopBar title="Moods" sub="Shown as chips when you add an entry" />
      <div className="scroll pad stack gap10" style={{ paddingTop: 22 }}>
        <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Your moods</span><span className="small faint">Drag to reorder</span></div>
        <div className="card flush">
          {list.map((m, i) => (
            <MoodRow key={m.label + i} m={m} i={i} open={open === i} onToggleColor={() => setOpen(open === i ? null : i)} rowStyle={drag.rowStyle(i)} handle={drag.handleProps(i)}
              onRename={(v) => { if (list.some((x, j) => j !== i && x.label.toLowerCase() === v.toLowerCase())) { toast("You already have a mood called " + v); return; } const old = m.label; const n0 = used(old); act("renameMood", { id: m.id, label: v }).then(() => toast("Renamed on " + n0 + " past entries too")).catch(() => {}); }}
              onHide={() => setList((l) => l.map((x, j) => (j === i ? Object.assign({}, x, { hidden: !x.hidden }) : x)))}
              onColor={(c) => setList((l) => l.map((x, j) => (j === i ? Object.assign({}, x, { color: c }) : x)))}
              onDelete={() => { const snap = list.slice(); setList((l) => l.filter((_, j) => j !== i)); setOpen(null); toast(m.label + " deleted. Past entries keep the word", { label: "Undo", run: () => setList(() => snap) }); }} />
          ))}
        </div>
        <button className="btn dashed" onClick={() => { const usedC = list.map((x) => x.color); const c = (PALETTE.find((p) => usedC.indexOf(p.color) < 0) || PALETTE[0]).color; let name = "New mood", k = 2; while (list.some((x) => x.label === name)) name = "New mood " + k++; setList((l) => l.concat([{ label: name, color: c, preset: false, hidden: false }])); setOpen(list.length); }}><Icon name="plus" size={14} stroke={2.6} />Add a mood</button>
        <span className="small faint" style={{ lineHeight: 1.45 }}>Presets can be renamed, recoloured or hidden, but not deleted. Moods you type while adding an entry are saved here automatically. Changing a colour updates it on every past entry.</span>
        <div style={{ height: 20 }} />
      </div>
    </Screen>
  );
}

export function ChangePassword() {
  const { db, act, local, actSoon, refresh, nav, me, toast } = useApp();
  const [cur, setCur] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [others, setOthers] = useState(true);
  const [err, setErr] = useState("");
  const hasPw = !!me.hasPassword;
  const [busy, setBusy] = useState(false);
  const ok = (cur || !hasPw) && p1.length >= 10 && p1 === p2;
  return (
    <Screen>
      <TopBar title={hasPw ? "Change password" : "Set a password"} />
      <form className="scroll pad stack gap16" style={{ paddingTop: 26 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        try { await act("changePassword", { current: cur, password: p1, signOutOthers: others }, { quiet: true }); }
        catch (x) { setErr(x.message); setBusy(false); return; }
        toast(hasPw ? "Password updated" + (others ? ". Other devices were signed out" : "") : "Password set"); nav.back();
      }}>
        {hasPw ? <><div className="field"><label className="sec" htmlFor="cp-cur">Current password</label><PassInput id="cp-cur" value={cur} onChange={(v) => { setCur(v); setErr(""); }} autoComplete="current-password" />{err ? <span className="errtext">{err}</span> : null}</div>
        <div style={{ height: 1, background: "#211F1D", margin: "4px 0" }} /></> : <span className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>You sign in with SSO. A password is a backup way in{db.server.sso && !db.server.sso.passwordLogin ? ", for when the admin turns password sign-in back on" : ""}.</span>}
        <div className="field"><label className="sec" htmlFor="cp-new">New password</label><PassInput id="cp-new" value={p1} onChange={setP1} autoComplete="new-password" placeholder="At least 10 characters" /><Strength pass={p1} /></div>
        <div className="field"><label className="sec" htmlFor="cp-new2">Confirm new password</label><PassInput id="cp-new2" value={p2} onChange={setP2} autoComplete="new-password" />{p2 && p1 !== p2 ? <span className="errtext">Passwords don't match</span> : null}</div>
        <div className="card"><ToggleRow title="Sign out other devices" sub="Recommended if you think someone else knows it" on={others} onChange={setOthers} /></div>
        {!hasPw && err ? <span className="errtext">{err}</span> : null}
        <button className="btn" type="submit" disabled={!ok || busy} style={{ marginTop: 8 }}>{hasPw ? "Update password" : "Set password"}</button>
        <div style={{ height: 20 }} />
      </form>
    </Screen>
  );
}
