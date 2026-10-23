import React from "react";
import { useApp } from "../store.jsx";
import { Icon, Logo } from "../icons.jsx";
import { Screen, Avatar, Toggle, ToggleRow, Opts, Choice, Stepper, Menu, Confirm, Dialog, TimezonePicker, detectedZone, zoneLabel } from "../ui.jsx";
import * as S from "../sel.js";
import { QUALITY } from "../../shared/mash";
import { rel, shortDate, uid, gb } from "../util.js";

const { useState } = React;

function Acc({ id, open, setOpen, icon, title, sub, badge, children }) {
  const isOpen = open === id;
  return (
    <div style={{ borderRadius: 16, background: "var(--surface)", border: "1px solid " + (isOpen ? "var(--accent)" : "var(--line)") }}>
      <button onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} className="hrow gap12" style={{ width: "100%", padding: 14, background: "none", border: "none", color: "var(--fg)", textAlign: "left" }}>
        <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={18} color="var(--muted)" /></span>
        <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span><span className="small muted" style={{ lineHeight: 1.35 }}>{sub}</span></span>
        {badge || null}
        <Icon name="chevD" size={16} color="var(--faint)" style={{ transform: isOpen ? "rotate(180deg)" : "none" }} />
      </button>
      {isOpen ? <div className="stack gap16" style={{ padding: "0 14px 16px" }}>{children}</div> : null}
    </div>
  );
}
const Count = ({ n }) => (n ? <span className="num" style={{ padding: "2px 8px", borderRadius: 9, background: "var(--accent)", color: "var(--accent-ink)", fontSize: 11, fontWeight: 800 }}>{n}</span> : null);
const Inset = ({ children, style }) => <div className="stack gap12" style={Object.assign({ padding: 12, borderRadius: 12, background: "#161513", border: "1px solid var(--line-soft)" }, style)}>{children}</div>;

function UsageBar({ parts, total }) {
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--line-soft)" }}>
      {parts.map((p, i) => <div key={i} style={{ width: Math.max(0.6, Math.min(100, (p.v / total) * 100)) + "%", background: p.c }} />)}
    </div>
  );
}

export function CopyBox({ url, note }) {
  const { toast } = useApp();
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack gap8" style={{ padding: 12, borderRadius: 12, background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
      <span style={{ fontSize: 12.5, fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all", userSelect: "all" }}>{url}</span>
      <div className="hrow between gap8 wrap">
        <span className="small muted">{note}</span>
        <button className="chipbtn" style={{ background: "var(--accent)", color: "var(--accent-ink)", border: "none", fontWeight: 700 }} onClick={() => { try { navigator.clipboard.writeText(url).then(() => setCopied(true), () => toast("Select the link and copy it")); } catch (e) { toast("Select the link and copy it"); } }}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

function People() {
  const { db, act, local, actSoon, me, toast } = useApp();
  const [openU, setOpenU] = useState(null);
  const [invMenu, setInvMenu] = useState(null);
  const [del, setDel] = useState(null);
  const [delChoice, setDelChoice] = useState("keep");
  const [link, setLink] = useState(null);
  const [reset, setReset] = useState(null);
  const admin = db.admin || {};
  const users = db.users.filter((u) => !u.deleted);
  const admins = users.filter((u) => u.role === "ADMIN" && !u.disabled).length;
  const setUser = (id, o, msg) => act("adminSetUser", Object.assign({ userId: id }, o)).then(() => msg && toast(msg)).catch(() => {});
  const statusInfo = { needs: ["Needs approval", "accent"], pending: ["Pending", ""], accepted: ["Accepted", "ok"], revoked: ["Revoked", ""], declined: ["Declined", ""], expired: ["Expired", ""] };
  const invites = db.invites.slice().sort((a, b) => (a.status === "needs" ? -1 : 0) - (b.status === "needs" ? -1 : 0) || b.at - a.at).slice(0, 40);
  const du = del ? S.user(db, del) : null;
  const sharedCount = du ? (admin.sharedProjects || {})[du.id] || 0 : 0;
  const deleteUser = async () => {
    const u = du;
    setDel(null); setOpenU(null);
    try { await act("adminDeleteUser", { userId: u.id, choice: delChoice }); toast(u.name + "'s account deleted"); } catch (e) { /* toast shown */ }
  };
  return (
    <>
      <span className="sec">Users</span>
      <div className="list" style={{ borderRadius: 12, background: "#161513", border: "1px solid var(--line-soft)", overflow: "hidden" }}>
        {users.map((u) => {
          const use = (admin.usage || {})[u.id] || { total: 0 };
          const quota = u.quota ? u.quota * 1e9 : null;
          const pct = quota ? Math.min(100, (use.total / quota) * 100) : Math.min(100, use.total / 1e11 * 100);
          const last = u.role === "ADMIN" && admins === 1 && !u.disabled;
          const open = openU === u.id;
          return (
            <div key={u.id}>
              <button onClick={() => setOpenU(open ? null : u.id)} aria-expanded={open} className="hrow gap10" style={{ width: "100%", padding: "11px 12px", background: "none", border: "none", color: "var(--fg)", textAlign: "left", opacity: u.disabled ? 0.5 : 1 }}>
                <Avatar user={u} size={32} ring={false} />
                <span className="stack gap4" style={{ flex: 1, minWidth: 0 }}>
                  <span className="hrow gap6"><span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 700 }}>{u.name}{u.id === me.id ? " (you)" : ""}</span><span className={"tag" + (u.role === "ADMIN" && !u.disabled ? " accent" : "")} style={{ fontSize: 10 }}>{u.disabled ? "Disabled" : u.role === "ADMIN" ? "Admin" : "User"}</span>{u.sso ? <span className="tag" style={{ fontSize: 10 }}>SSO</span> : null}{u.locked ? <span className="tag danger" style={{ fontSize: 10 }}>Locked</span> : null}</span>
                  <span style={{ display: "block", height: 4, borderRadius: 2, background: "var(--line-soft)", overflow: "hidden" }}><span style={{ display: "block", width: pct + "%", height: "100%", background: quota && use.total / quota > 0.85 ? "#E07B5B" : "var(--accent)" }} /></span>
                  <span className="tiny muted ellipsis">{u.email} · {gb(use.total)} {quota ? "of " + u.quota + " GB" : "· unlimited"} · active {u.id === me.id ? "now" : rel(u.lastActive)}</span>
                </span>
              </button>
              {open ? (
                <div className="stack gap12" style={{ padding: "0 12px 14px" }}>
                  <div className="stack gap6"><span className="sec">Storage limit</span><Opts value={u.quota || null} onChange={(v) => setUser(u.id, { quota: v }, "Storage limit saved")} options={[{ id: 1, label: "1 GB" }, { id: 5, label: "5 GB" }, { id: 10, label: "10 GB" }, { id: 25, label: "25 GB" }, { id: null, label: "Unlimited" }]} /></div>
                  {last ? <span className="small muted">{u.id === me.id ? "You're" : u.name + " is"} the only admin, so this account can't be demoted, disabled or deleted.</span> : null}
                  <div className="grid2" style={{ gap: 6 }}>
                    {!last ? <button className="chipbtn" onClick={() => setUser(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" }, u.role === "ADMIN" ? u.name + " is no longer an admin" : u.name + " is now an admin")}>{u.role === "ADMIN" ? "Remove admin" : "Make admin"}</button> : null}
                    <button className="chipbtn" onClick={() => act("adminResetLink", { userId: u.id }).then((r) => { if (r.sent) toast("Password reset link sent to " + u.email); else setReset({ user: u, url: r.link }); }).catch(() => {})}>{db.server.email.ok ? "Send reset link" : "Make reset link"}</button>
                    {u.locked ? <button className="chipbtn" onClick={() => setUser(u.id, { unlock: true }, u.name + " can try signing in again")}>Unlock sign-in</button> : null}
                    {u.id !== me.id && !last ? <button className="chipbtn" onClick={() => setUser(u.id, { disabled: !u.disabled }, u.disabled ? u.name + " can sign in again" : u.name + " can't sign in now")}>{u.disabled ? "Re-enable" : "Disable"}</button> : null}
                    {u.id !== me.id && !last ? <button className="chipbtn" style={{ color: "var(--danger)", borderColor: "rgba(224,120,110,0.35)" }} onClick={() => { setDel(u.id); setDelChoice("keep"); }}>Delete user</button> : null}
                  </div>
                  {reset && reset.user.id === u.id ? <CopyBox url={reset.url} note={"Send this to " + S.firstName(u) + " · works once, for 1 hour"} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <span className="sec">Invites</span>
      <Inset>
        <ToggleRow title="Let users invite people" sub="From a project's Members screen, by email" on={db.server.userInvites} onChange={(v) => { local((n) => { n.server.userInvites = v; }); actSoon("srv-ui", "setServer", { userInvites: v }, 50); }} />
        {db.server.userInvites ? <div className="hrow between"><span className="small muted">Invites per user, per day</span><Stepper value={db.server.perDay} min={1} max={20} label="invites per day" onChange={(v) => { local((n) => { n.server.perDay = v; }); actSoon("srv-pd", "setServer", { perDay: v }, 300); }} /></div>
          : <span className="small muted" style={{ lineHeight: 1.4 }}>While off, invites to new emails from project owners come to you for approval.</span>}
      </Inset>
      <div className="stack gap8">
        {invites.map((iv) => {
          const by = S.user(db, iv.invitedBy); const p = iv.projectId ? S.project(db, iv.projectId) : null;
          const st = statusInfo[iv.status] || [iv.status, ""]; const live = iv.status === "needs" || iv.status === "pending"; const open = invMenu === iv.id;
          return (
            <div key={iv.id} style={{ borderRadius: 12, background: "#161513", border: "1px solid " + (iv.status === "needs" ? "var(--accent)" : "var(--line-soft)") }}>
              <div className="hrow gap10" style={{ padding: "11px 8px 11px 12px" }}>
                <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
                  <span className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>{iv.email || "Invite link"}</span>
                  <span className="tiny muted" style={{ lineHeight: 1.35 }}>by {by ? (by.id === me.id ? "You" : S.firstName(by)) : "—"} · {p ? "into " + p.name : iv.projectId ? "into a project" : "server invite"} · {iv.status === "accepted" ? "joined " + shortDate(iv.acceptedAt || iv.at) : rel(iv.at)}</span>
                </span>
                <span className={"tag " + st[1]} style={{ fontSize: 10.5 }}>{st[0]}</span>
                {live ? <button className="iconbtn plain sq" style={{ width: 30, height: 30, background: open ? "#2A2825" : "transparent" }} aria-label={"Options for invite to " + (iv.email || "link")} aria-expanded={open} onClick={() => setInvMenu(open ? null : iv.id)}><Icon name="more" size={16} color="var(--muted)" /></button> : <span style={{ width: 30 }} />}
              </div>
              {open ? <div style={{ margin: "0 8px 8px" }}><Menu items={[
                iv.status === "needs" ? { label: "Approve & send invite", icon: "check", onClick: () => { setInvMenu(null); act("approveInvite", { inviteId: iv.id }).then((r) => { if (r && r.link) setLink(r.link); toast(r && r.emailed ? "Approved. Invite email sent to " + iv.email : "Approved. Email isn't set up, so copy the link below and send it"); }).catch(() => {}); } } : null,
                iv.status === "pending" ? { label: "Copy link", icon: "copy", onClick: () => { setInvMenu(null); act("inviteLink", { inviteId: iv.id }, { noRefresh: true }).then((r) => setLink(r.link)).catch(() => {}); } } : null,
                { label: iv.status === "needs" ? "Decline request" : "Revoke invite", icon: "close", danger: true, onClick: () => { setInvMenu(null); act("revokeInvite", { inviteId: iv.id }).then(() => toast(iv.status === "needs" ? "Request declined" : "Invite revoked")).catch(() => {}); } }
              ]} /></div> : null}
            </div>
          );
        })}
      </div>
      <button className="btn dashed" style={{ fontSize: 13 }} onClick={() => act("createInviteLink").then((r) => setLink(r.link)).catch(() => {})}>+ Create invite link</button>
      {link ? <CopyBox url={link} note="Single use · expires in 7 days" /> : null}
      <Confirm open={!!du} onClose={() => setDel(null)} title={du ? "Delete " + S.firstName(du) + "'s account?" : ""} body={du ? "Their own projects, clips and mashes are deleted and their storage is freed." + (sharedCount ? " They're also in " + sharedCount + " shared project" + (sharedCount > 1 ? "s" : "") + ". What should happen to their clips there?" : "") : ""} confirm="Delete account" danger onConfirm={deleteUser}>
        {sharedCount ? <div className="stack gap8"><Choice active={delChoice === "keep"} onClick={() => setDelChoice("keep")} title="Keep their clips in shared projects" /><Choice active={delChoice === "drop"} onClick={() => setDelChoice("drop")} title="Remove their clips everywhere" /></div> : null}
      </Confirm>
    </>
  );
}

const inStyle = { padding: "10px 12px", fontSize: 14 };
function SignIn() {
  const { db, act, local, actSoon, me, toast } = useApp();
  const sso = db.server.sso;
  const locked = !!sso.fromEnv;
  const [pwOff, setPwOff] = useState(false);
  const [secret, setSecret] = useState("");
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const setSso = (o, ms) => { local((n) => { Object.assign(n.server.sso, o); }); actSoon("sso-" + Object.keys(o).join(), "setSso", o, ms == null ? 50 : ms); };
  const edit = (o) => { setSso(Object.assign({ tested: false }, o), 600); setTest(null); };
  const callback = (db.server.url || "").replace(/\/$/, "") + "/api/auth/callback/oidc";
  const unlinked = db.users.filter((u) => !u.sso && !u.disabled && !u.deleted);
  const runTest = async () => {
    setBusy(true);
    try { const r = await act("testSso", { issuer: sso.issuer, clientId: sso.clientId, secret: secret || null }, { quiet: true }); setSecret(""); setTest({ ok: true, msg: "Found " + r.issuer + ". Try it from the sign-in page." }); }
    catch (e) { setTest({ ok: false, msg: e.message }); } finally { setBusy(false); }
  };
  return (
    <>
      <ToggleRow title="Single sign-on (SSO)" sub="OpenID Connect · Authentik, Authelia, Keycloak, Pocket ID, Zitadel and others" on={sso.on} onChange={(v) => { if (locked) { toast("SSO is set by the container's OIDC_* settings"); return; } if (!v && !sso.passwordLogin) setSso({ on: false, passwordLogin: true }); else setSso({ on: v }); toast(v ? "SSO is on. The button shows on the sign-in page" : "SSO is off. Everyone signs in with a password"); }} />
      {sso.on ? (
        <>
          <Inset style={{ gap: 6 }}>
            <span className="sec">Redirect URL for your provider</span>
            <div className="hrow gap8"><span style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, color: "#BDB7AD", wordBreak: "break-all" }}>{callback}</span><button className="chipbtn" aria-label="Copy redirect URL" onClick={() => { try { navigator.clipboard.writeText(callback); } catch (e) { /* ignore */ } toast("Redirect URL copied"); }}><Icon name="copy" size={14} /></button></div>
          </Inset>
          {locked ? <span className="small muted" style={{ lineHeight: 1.45 }}>Issuer, client ID and secret come from the container's <code>OIDC_ISSUER</code>, <code>OIDC_CLIENT_ID</code> and <code>OIDC_CLIENT_SECRET</code> settings.</span> : null}
          <div className="field"><label className="sec" htmlFor="sso-issuer">Issuer URL</label><input id="sso-issuer" disabled={locked} className="input" style={inStyle} placeholder="https://auth.yourdomain.com/application/o/glimpse/" value={sso.issuer} onChange={(e) => edit({ issuer: e.target.value.trim() })} /></div>
          <div className="grid2" style={{ gap: 8 }}>
            <div className="field"><label className="sec" htmlFor="sso-id">Client ID</label><input id="sso-id" disabled={locked} className="input" style={inStyle} value={sso.clientId} onChange={(e) => edit({ clientId: e.target.value })} /></div>
            <div className="field"><label className="sec" htmlFor="sso-secret">Client secret</label><input id="sso-secret" disabled={locked} className="input" style={inStyle} type="password" placeholder={sso.secretSet ? "Saved" : ""} value={secret} onChange={(e) => { setSecret(e.target.value); setTest(null); }} /></div>
          </div>
          <button className="chipbtn" style={{ padding: 10 }} disabled={busy} onClick={runTest}>{busy ? "Testing…" : sso.tested && !test ? "Connected · test again" : "Save & test connection"}</button>
          {test ? <span className="small" style={{ color: test.ok ? "var(--ok)" : "#F0A49C", lineHeight: 1.4 }}>{test.msg}</span> : null}
          <div className="field">
            <label className="sec" htmlFor="sso-label">Button label</label>
            <div className="hrow" style={{ borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", overflow: "hidden" }}><span className="muted" style={{ padding: "0 0 0 12px", fontSize: 14, whiteSpace: "nowrap" }}>Sign in with</span><input id="sso-label" className="input" style={Object.assign({}, inStyle, { border: "none", background: "transparent", paddingLeft: 6 })} placeholder="SSO" value={sso.label} onChange={(e) => setSso({ label: e.target.value.slice(0, 24) }, 600)} /></div>
            <span className="small muted">“SSO” suits most servers. Name your provider if people know it by name, e.g. Authentik.</span>
          </div>
          <div className="stack gap8">
            <span className="sec">New people</span>
            <Choice active={sso.newAccounts === "invite"} onClick={() => setSso({ newAccounts: "invite" })} title="Invite only" desc="SSO signs in people who already have an account or an invite, matched by verified email." />
            <Choice active={sso.newAccounts === "group"} onClick={() => setSso({ newAccounts: "group" })} title="Anyone in a group" desc="Members of this provider group get an account the first time they sign in." />
            {sso.newAccounts === "group" ? <input className="input" style={inStyle} aria-label="Group name" placeholder="glimpse-users" value={sso.group} onChange={(e) => setSso({ group: e.target.value.trim() }, 600)} /> : null}
          </div>
          <div className="field"><label className="sec" htmlFor="sso-admin">Admin group <span className="faint" style={{ textTransform: "none", letterSpacing: 0 }}>· optional</span></label><input id="sso-admin" className="input" style={inStyle} placeholder="e.g. glimpse-admins" value={sso.adminGroup} onChange={(e) => setSso({ adminGroup: e.target.value.trim() }, 600)} /><span className="small muted">Members become admins when they sign in. Leave empty to choose admins here.</span></div>
          <ToggleRow title="Allow password sign-in" sub={sso.passwordLogin ? "Email and password still work alongside SSO" : "SSO only. The password form is hidden"} on={sso.passwordLogin} onChange={(v) => { if (v) { setSso({ passwordLogin: true }); toast("Password sign-in is back on"); } else if (!me.sso) toast("Sign in with SSO once first, so your own account is linked", null, "warn"); else setPwOff(true); }} />
          <ToggleRow title="Sign out of the provider too" sub={sso.idpLogout ? "Signing out of Glimpse also signs out of your other apps" : "Signing out of Glimpse leaves your other apps signed in"} on={sso.idpLogout} onChange={(v) => setSso({ idpLogout: v })} />
          {!locked ? <span className="small faint" style={{ lineHeight: 1.45 }}>Prefer Docker settings? Set <code>OIDC_ISSUER</code>, <code>OIDC_CLIENT_ID</code> and <code>OIDC_CLIENT_SECRET</code> and these fields lock here.</span> : null}
        </>
      ) : <span className="small muted" style={{ lineHeight: 1.45 }}>Everyone signs in with email and password. Turn on SSO to add a sign-in button for the identity provider you already run.</span>}
      <Confirm open={pwOff} onClose={() => setPwOff(false)} title="Turn off password sign-in?" body={"Everyone will sign in through SSO only." + (unlinked.length ? " " + unlinked.length + (unlinked.length === 1 ? " person hasn't" : " people haven't") + " used SSO yet (" + unlinked.slice(0, 6).map(S.firstName).join(", ") + (unlinked.length > 6 ? "…" : "") + "). They can still get in if their email at your provider matches." : "")} confirm="Use SSO only" onConfirm={() => { setSso({ passwordLogin: false }); setPwOff(false); toast("Password sign-in is off"); }}>
        <Inset style={{ gap: 4 }}><span style={{ fontSize: 13, fontWeight: 600 }}>If your provider ever goes down</span><span className="small muted" style={{ lineHeight: 1.45 }}>Restart the Glimpse container. A one-time recovery link is printed in its log that lets an admin sign in with their password.</span></Inset>
      </Confirm>
    </>
  );
}

function ImmichAdmin() {
  const { db, act, local, actSoon, toast } = useApp();
  const im = db.server.immich;
  const [res, setRes] = useState(null);
  const set = (o, ms) => { local((n) => { Object.assign(n.server.immich, o); }); actSoon("im-" + Object.keys(o).join(), "setImmich", o, ms == null ? 50 : ms); };
  const connected = (db.admin && db.admin.immichConnected) || 0;
  return (
    <>
      <ToggleRow title="Import from Immich" sub="Adds “Choose from Immich” when people add a glimpse" on={im.on} onChange={(v) => { set({ on: v }); toast(v ? "Immich import is on" : "Immich import is off"); }} />
      {im.on ? (
        <>
          <div className="field">
            <label className="sec" htmlFor="im-url">Immich server address</label>
            <input id="im-url" className="input" style={inStyle} placeholder="http://immich-server:2283" value={im.url} onChange={(e) => { set({ url: e.target.value.trim(), tested: false }, 700); setRes(null); }} />
            <span className="small muted" style={{ lineHeight: 1.4 }}>The address Glimpse's server uses to reach Immich, e.g. the container name on the same Docker network. People's phones never talk to Immich directly.</span>
          </div>
          <button className="chipbtn" style={{ padding: 10 }} onClick={() => act("testImmich", { url: im.url }, { quiet: true }).then((r) => setRes({ ok: true, msg: "Reached " + r.version + " at " + im.url })).catch((e) => setRes({ ok: false, msg: e.message }))}>{im.tested && !res ? "Connected · test again" : "Test connection"}</button>
          {res ? <span className="small" style={{ color: res.ok ? "var(--ok)" : "#F0A49C", lineHeight: 1.4 }}>{res.msg}</span> : null}
          <Inset style={{ gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{connected ? connected + (connected === 1 ? " person has" : " people have") + " connected their library" : "Nobody has connected yet"}</span>
            <span className="small muted" style={{ lineHeight: 1.45 }}>Each person adds their own Immich API key in Profile, so they only ever see their own library. Picked videos are copied into Glimpse and count toward that person's storage.</span>
          </Inset>
        </>
      ) : null}
    </>
  );
}

function AdminSettings({ initialOpen }) {
  const { db, act, local, actSoon, me, toast } = useApp();
  const [open, setOpen] = useState(initialOpen || null);
  const [mail, setMail] = useState({ host: db.server.email.host, port: db.server.email.port, user: db.server.email.user, pass: "", from: db.server.email.from });
  const [mailBusy, setMailBusy] = useState(false);
  const srv = db.server;
  const onShare = !srv.storage || srv.storage.kind !== "s3";
  const admin = db.admin || {};
  const clip = srv.clipLimit || { on: false, max: 60 };
  const fmtLimit = (s) => (s % 60 === 0 ? s / 60 + " min" : s + " seconds");
  const setSrv = (o, ms) => { local((n) => Object.assign(n.server, o)); actSoon("srv-" + Object.keys(o).join(), "setServer", o, ms == null ? 50 : ms); };
  const approvals = db.invites.filter((i) => i.status === "needs").length;
  const removals = db.removalRequests.filter((r) => r.status === "open" && S.track(db, r.trackId));
  const tot = admin.totals || { clips: 0, mashes: 0, music: 0 };
  const appUsed = tot.clips + tot.mashes + tot.music;
  const queue = (admin.queue || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  const users = db.users.filter((u) => !u.deleted);
  const nAdmins = users.filter((u) => u.role === "ADMIN").length;
  return (
    <div className="stack gap10">
      <Acc id="people" open={open} setOpen={setOpen} icon="users" title="People & invites" sub={users.length + (users.length === 1 ? " user · " : " users · ") + nAdmins + (nAdmins === 1 ? " admin" : " admins")} badge={<Count n={approvals} />}><People /></Acc>
      <Acc id="signin" open={open} setOpen={setOpen} icon="key" title="Sign-in" sub={srv.sso.on ? "SSO · " + (srv.sso.passwordLogin ? "passwords too" : "SSO only") : "Passwords only"}><SignIn /></Acc>
      <Acc id="storage" open={open} setOpen={setOpen} icon="storage" title="Storage" sub={"App uses " + gb(appUsed) + (admin.dataFree ? " · " + admin.dataFree + " free for backups" : "")}>
        <div className="stack gap8">
          <UsageBar total={Math.max(appUsed, 1)} parts={[{ v: tot.clips, c: "var(--accent)" }, { v: tot.mashes, c: "#6FA8DC" }, { v: tot.music, c: "#9B87D6" }]} />
          <div className="hrow wrap" style={{ gap: "6px 12px", fontSize: 11, color: "#BDB7AD" }}>
            <span className="hrow gap4"><span className="dot" style={{ background: "var(--accent)", borderRadius: 2 }} />Clips {gb(tot.clips)}</span>
            <span className="hrow gap4"><span className="dot" style={{ background: "#6FA8DC", borderRadius: 2 }} />Mashes {gb(tot.mashes)}</span>
            <span className="hrow gap4"><span className="dot" style={{ background: "#9B87D6", borderRadius: 2 }} />Music {gb(tot.music)}</span>
          </div>
          <span className="small faint" style={{ lineHeight: 1.4 }}>Clips include the original and its playback copy. {onShare ? "Files are saved in the folder mapped to " + srv.storage.where + ", so free space is whatever that share has left." : "Free space depends on your S3 storage; check it there."}</span>
        </div>
        <div className="stack gap6"><span className="sec">Default limit for new users</span><Opts value={srv.defaultQuota} onChange={(v) => setSrv({ defaultQuota: v })} options={[{ id: 1, label: "1 GB" }, { id: 5, label: "5 GB" }, { id: 10, label: "10 GB" }, { id: 25, label: "25 GB" }, { id: 0, label: "None" }]} /></div>
      </Acc>
      <Acc id="capture" open={open} setOpen={setOpen} icon="camera" title="Capture" sub={clip.on ? "Clips up to " + (clip.max > 0 ? fmtLimit(clip.max) : "any length") : "Clips up to 10 seconds"}>
        <ToggleRow title="Allow longer clips" sub={clip.on ? "Everyone can keep a longer moment from each video" : "Off: each glimpse keeps up to 10 seconds"} on={clip.on} onChange={(v) => setSrv({ clipLimit: Object.assign({}, clip, { on: v }) })} />
        {clip.on ? (
          <div className="stack gap6">
            <span className="sec">Longest clip</span>
            <Opts value={[30, 60, 300, 0].indexOf(clip.max) >= 0 ? clip.max : null} onChange={(v) => setSrv({ clipLimit: Object.assign({}, clip, { max: v }) })} options={[{ id: 30, label: "30s" }, { id: 60, label: "1 min" }, { id: 300, label: "5 min" }, { id: 0, label: "No limit" }]} />
            <label className="hrow between gap12" style={{ marginTop: 4 }}>
              <span className="small muted">Or set your own, in seconds</span>
              <input className="input num" type="number" inputMode="numeric" min={11} max={36000} aria-label="Longest clip in seconds" value={clip.max > 0 ? clip.max : ""} placeholder="No limit" onChange={(e) => { const v = Math.round(Number(e.target.value)); setSrv({ clipLimit: Object.assign({}, clip, { max: v > 0 ? v : 0 }) }, 600); }} style={{ width: 110, padding: "8px 10px", textAlign: "right" }} />
            </label>
            <span className="small muted" style={{ lineHeight: 1.4 }}>Applies to trimming new glimpses and adjusting old ones. Longer clips make longer mashes, and you can still shorten each one when mashing.</span>
          </div>
        ) : null}
      </Acc>
      <Acc id="render" open={open} setOpen={setOpen} icon="mash" title="Rendering" sub={(queue.length ? queue.length + " in queue" : "Idle") + " · " + (admin.worker && admin.worker.ok ? "worker running" : "worker not running")}>
        {admin.worker && !admin.worker.ok ? <span style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(224,120,110,0.1)", border: "1px solid rgba(224,120,110,0.35)", fontSize: 12, color: "#F0A49C", lineHeight: 1.4 }}>The render worker isn't running, so uploads and mashes will wait. Check the container log, and that GLIMPSE_WORKER is true.</span> : null}
        <div className="hrow between gap12"><span className="stack gap2"><span style={{ fontSize: 13.5, fontWeight: 600 }}>Renders at once</span><span className="small muted">More = faster queue, busier server</span></span><Stepper value={srv.concurrency} min={1} max={4} label="renders at once" onChange={(v) => setSrv({ concurrency: v }, 400)} /></div>
        <div className="stack gap6"><span className="sec">Playback copies</span><Opts value={srv.playback || "720"} onChange={(v) => setSrv({ playback: v })} options={[{ id: "720", label: "720p" }, { id: "1080", label: "1080p" }]} /><span className="small muted" style={{ lineHeight: 1.4 }}>Every upload gets a small H.264 copy so it plays in any browser, including iPhone HEVC videos. Originals are kept untouched for mashes. Adds about {srv.playback === "1080" ? "25" : "10"}% to clip storage.</span></div>
        <div className="stack gap6"><span className="sec">Mash resolution</span><Opts value={srv.maxRes} onChange={(v) => setSrv({ maxRes: v })} options={[{ id: "720", label: "720p" }, { id: "1080", label: "1080p" }, { id: "4k", label: "4K" }]} /></div>
        <div className="stack gap6"><span className="sec">Mash quality</span><Opts value={srv.mashQuality || "high"} onChange={(v) => setSrv({ mashQuality: v })} options={Object.keys(QUALITY).map((k) => ({ id: k, label: QUALITY[k].label, sub: QUALITY[k].audioKbps + " kbps" }))} /><span className="small muted" style={{ lineHeight: 1.4 }}>{QUALITY[srv.mashQuality || "high"].hint}. The starting choice for new mashes; people can change it per mash.</span></div>
        <ToggleRow title="Allow downloading fonts from Google Fonts" sub={srv.googleFonts !== false ? "People can pick any Google font for text on mashes. The server downloads each one once." : "Only the fonts already on this server can be picked."} on={srv.googleFonts !== false} onChange={(v) => setSrv({ googleFonts: v })} />
        <div className="hrow gap10" style={{ padding: "10px 12px", borderRadius: 11, background: "#161513", border: "1px solid var(--line-soft)" }}><Icon name="cpu" size={18} color="var(--muted)" /><span className="stack gap2" style={{ flex: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>CPU encoding</span><span className="tiny muted">{admin.worker && admin.worker.ffmpeg ? admin.worker.ffmpeg : "FFmpeg"} · GPU encoding is planned for a later version</span></span></div>
        <div className="stack gap6">
          <span className="sec">Queue</span>
          {queue.map((j, i) => {
            const running = j.status === "rendering";
            return (
              <div key={j.id} role="progressbar" aria-label={j.title + (running ? " rendering" : " queued")} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(j.progress)} className="hrow gap10" style={{ padding: "10px 12px", borderRadius: 11, background: running ? "linear-gradient(to right, var(--accent-soft) " + j.progress + "%, #161513 " + j.progress + "%)" : "#161513", border: "1px solid " + (running ? "var(--accent)" : "var(--line-soft)") }}>
                <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}><span className="ellipsis" style={{ fontSize: 13, fontWeight: 600 }}>{j.title}</span><span className="tiny" style={{ color: running ? "#BDB7AD" : "var(--faint)" }}>{j.ownerId === me.id ? "You" : j.ownerName} · {running ? "rendering" : "queued · #" + (i + 1)}</span></span>
                {running ? <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>{Math.round(j.progress)}%</span> : null}
                <button className="chipbtn" style={{ background: "transparent", color: "var(--muted)", fontSize: 12 }} onClick={() => act("adminCancelRender", { mashId: j.id }).then(() => toast("Render cancelled")).catch(() => {})}>Cancel</button>
              </div>
            );
          })}
          {!queue.length ? <span className="small muted">Nothing rendering right now.</span> : null}
        </div>
      </Acc>
      <Acc id="music" open={open} setOpen={setOpen} icon="music" title="Music" sub={(removals.length ? removals.length + " removal request" + (removals.length > 1 ? "s" : "") + " · " : "") + "uploads " + (srv.musicUploads ? "open to all" : "admins only")} badge={<Count n={removals.length} />}>
        {removals.map((r) => {
          const t = S.track(db, r.trackId); const by = S.user(db, r.userId);
          return (
            <div key={r.id} className="stack gap10" style={{ padding: 12, borderRadius: 12, background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
              <span className="sec" style={{ color: "var(--accent)" }}>Removal request</span>
              <span className="stack gap2"><span style={{ fontSize: 14, fontWeight: 700 }}>{t.title}{t.artist ? " · " + t.artist : ""}</span><span className="small muted">Requested by {by ? S.firstName(by) : "someone"} · {rel(r.at)}{r.reason ? " · “" + r.reason + "”" : ""}</span><span className="small muted">Already-rendered mashes keep their audio.</span></span>
              <div className="grid2"><button className="chipbtn" onClick={() => act("dismissRemoval", { requestId: r.id }).then(() => toast("Request dismissed. " + (by ? S.firstName(by) : "They") + " has been told")).catch(() => {})}>Dismiss</button><button className="chipbtn" style={{ background: "var(--danger-strong)", borderColor: "var(--danger-strong)", color: "#fff", fontWeight: 700 }} onClick={() => act("deleteTrack", { trackId: t.id }).then(() => toast(t.title + " deleted from the library")).catch(() => {})}>Delete track</button></div>
            </div>
          );
        })}
        <ToggleRow title="Non-admins can upload" sub="Otherwise only admins add tracks" on={srv.musicUploads} onChange={(v) => setSrv({ musicUploads: v })} />
        <ToggleRow title="Even out loudness" sub="New uploads play at a similar volume" on={srv.loudness} onChange={(v) => setSrv({ loudness: v })} />
        <div className="stack gap6"><span className="sec">Max track size</span><Opts value={srv.trackSize} onChange={(v) => setSrv({ trackSize: v })} options={[{ id: 25, label: "25 MB" }, { id: 50, label: "50 MB" }, { id: 100, label: "100 MB" }]} /></div>
        <div className="stack gap6"><span className="sec">Allowed formats</span>
          <div className="grid4">{Object.keys(srv.formats).map((f) => <button key={f} className={"opt" + (srv.formats[f] ? " on" : "")} aria-pressed={srv.formats[f]} onClick={() => { const on = Object.keys(srv.formats).filter((k) => srv.formats[k]).length; if (srv.formats[f] && on === 1) return; setSrv({ formats: Object.assign({}, srv.formats, { [f]: !srv.formats[f] }) }); }}>{f}</button>)}</div>
        </div>
      </Acc>
      <Acc id="immich" open={open} setOpen={setOpen} icon="image" title="Immich" sub={srv.immich.on ? "Import on · " + (admin.immichConnected || 0) + " connected" : "Off"}><ImmichAdmin /></Acc>
      <Acc id="email" open={open} setOpen={setOpen} icon="mail" title="Email" sub={srv.email.ok ? "Sending from " + srv.email.from : "Reminders & resets can't send yet"} badge={<span className={"tag " + (srv.email.ok ? "ok" : "danger")}>{srv.email.ok ? "Working" : "Not set up"}</span>}>
        {!srv.email.ok ? <span style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(224,120,110,0.1)", border: "1px solid rgba(224,120,110,0.35)", fontSize: 12, color: "#F0A49C", lineHeight: 1.4 }}>Until this works, email reminders, invite emails and password resets won't be delivered. In-app notifications still work.</span> : null}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}><input className="input" style={inStyle} aria-label="SMTP server" placeholder="smtp.example.com" value={mail.host} onChange={(e) => setMail(Object.assign({}, mail, { host: e.target.value }))} /><input className="input" style={inStyle} aria-label="Port" placeholder="587" inputMode="numeric" value={mail.port} onChange={(e) => setMail(Object.assign({}, mail, { port: e.target.value }))} /></div>
        <input className="input" style={inStyle} aria-label="Username" placeholder="Username" value={mail.user} onChange={(e) => setMail(Object.assign({}, mail, { user: e.target.value }))} />
        <input className="input" style={inStyle} type="password" aria-label="Password" placeholder={srv.email.passSet ? "Saved · type to replace" : "Password"} value={mail.pass} onChange={(e) => setMail(Object.assign({}, mail, { pass: e.target.value }))} />
        <input className="input" style={inStyle} aria-label="From address" placeholder="From address, e.g. glimpse@yourdomain.com" value={mail.from} onChange={(e) => setMail(Object.assign({}, mail, { from: e.target.value }))} />
        <button className="btn sm" disabled={mailBusy} onClick={() => { if (!mail.host.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.from.trim())) { toast("Fill in the SMTP server and a valid From address first"); return; } setMailBusy(true); act("saveEmail", mail).then(() => toast("Test email sent to " + me.email)).catch(() => {}).finally(() => setMailBusy(false)); }}>{mailBusy ? "Sending…" : "Save & send test email"}</button>
      </Acc>
      <Acc id="backup" open={open} setOpen={setOpen} icon="shield" title="Backups" sub={srv.backup.schedule === "off" ? "Automatic backups are off" : "Database · last " + (srv.backup.last ? rel(srv.backup.last) : "never")}>
        {srv.backup.schedule === "off" ? <span style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(224,120,110,0.1)", border: "1px solid rgba(224,120,110,0.35)", fontSize: 12, color: "#F0A49C", lineHeight: 1.4 }}>Automatic database backups are off. If the database is lost, every entry, project and mash setting goes with it.</span> : null}
        <div className="stack gap6"><span className="sec">Database backup</span><Opts value={srv.backup.schedule} onChange={(v) => setSrv({ backup: Object.assign({}, srv.backup, { schedule: v }) })} options={[{ id: "daily", label: "Daily 3 AM" }, { id: "weekly", label: "Weekly" }, { id: "off", label: "Off" }]} /></div>
        <div className="stack gap6"><span className="sec">Keep the last</span><Opts value={srv.backup.keep} onChange={(v) => setSrv({ backup: Object.assign({}, srv.backup, { keep: v }) })} options={[3, 7, 14, 30].map((k) => ({ id: k, label: String(k) }))} /></div>
        <div className="hrow between gap12"><span className="small muted">Last backup: {srv.backup.last ? rel(srv.backup.last) + " · " + srv.backup.size + " MB" : "never"}</span><button className="chipbtn" onClick={() => act("backupNow").then(() => toast("Backing up the database now")).catch(() => {})}>Back up now</button></div>
        <Inset style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{onShare ? "Also back up your media share and this folder" : "Also back up your S3 storage and this folder"}</span>
          <span style={{ fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", color: "#BDB7AD", lineHeight: 1.6, wordBreak: "break-all" }}>/mnt/user/appdata/glimpse/backups</span>
          <span className="small muted" style={{ lineHeight: 1.4 }}>{onShare ? "Clips, photos, music and mashes live in the share mapped to " + srv.storage.where + ", so include it in your Unraid backups." : "Clips, photos, music and mashes live in your S3 bucket, so include its data folder in your Unraid backups."} Glimpse backs up the database itself into the folder above.</span>
        </Inset>
      </Acc>
      <Acc id="server" open={open} setOpen={setOpen} icon="server" title="Server" sub={srv.name + " · Glimpse " + srv.version}>
        <div className="field"><label className="sec" htmlFor="srv-name">Server name</label><input id="srv-name" className="input" style={inStyle} value={srv.name} onChange={(e) => setSrv({ name: e.target.value.slice(0, 60) }, 700)} onBlur={(e) => { if (!e.target.value.trim()) setSrv({ name: "Home Server" }); }} /><span className="small muted">Shown on the sign-in page and in emails.</span></div>
        <div className="stack gap6"><span className="sec">Sign-in background</span><Opts value={srv.loginBg === "still" ? "still" : "drift"} onChange={(v) => setSrv({ loginBg: v })} options={[{ id: "drift", label: "Slow drift" }, { id: "still", label: "Still" }]} /><span className="small muted">Palette tiles only. Real clips are never shown on the public sign-in page. Drift also stops for anyone with reduce motion turned on.</span></div>
        <div className="field"><span className="sec">Public web address</span><div className="input" style={Object.assign({}, inStyle, { color: "#BDB7AD" })}>{srv.url}</div><span className="small muted">Set by APP_URL in the container's settings. Used in invite links, emails and the SSO redirect.</span></div>
        <div className="field"><span className="sec">Default timezone</span><TimezonePicker value={srv.tz} onChange={(v) => setSrv({ tz: v })} detected={detectedZone()} /><span className="small muted">Used for scheduled backups and as a starting point for new people.</span></div>
        <div className="hrow between gap12"><span className="stack gap2"><span style={{ fontSize: 13.5, fontWeight: 600 }}>Lock out after</span><span className="small muted">Failed sign-ins, then a 15-minute wait</span></span><Stepper value={srv.lockAfter} min={3} max={10} label="failed sign-ins" onChange={(v) => setSrv({ lockAfter: v }, 300)} /></div>
        <span className="small muted">Glimpse {srv.version}{srv.build && srv.build !== "v" + srv.version && srv.build !== srv.version ? " · build " + srv.build : ""}</span>
      </Acc>
    </div>
  );
}

function YouLinks() {
  const { nav } = useApp();
  const rows = [["profile", "user", "Profile & preferences", "Reminders, moods, accent colour, badge style"], ["projects", "layers", "Projects & categories", "Archive, delete, manage members"], ["music", "music", "Music library", "Shared tracks on this server"]];
  return (
    <div className="card flush list">
      {rows.map((r) => <button key={r[0]} className="row" onClick={() => nav.go(r[0])}><Icon name={r[1]} size={18} color="var(--muted)" /><span className="grow"><span className="t">{r[2]}</span><span className="s">{r[3]}</span></span><Icon name="chevR" size={16} color="var(--faint)" /></button>)}
    </div>
  );
}

export function Settings({ params }) {
  const { db, me, act, toast } = useApp();
  const admin = me.role === "ADMIN";
  const [asked, setAsked] = useState(false);
  const use = S.usage(db, me.id);
  const quota = me.quota ? me.quota * 1e9 : null;
  const adminName = db.server.adminName || "the admin";
  return (
    <Screen tab="settings">
      <div className="hrow between" style={{ padding: "22px 20px 12px", flexShrink: 0 }}>
        <div className="stack gap2"><span style={{ fontSize: 22, fontWeight: 700 }}>Settings</span><span className="small muted">{admin ? "Server admin · applies to everyone" : db.server.name + " · managed by " + adminName.split(" ")[0]}</span></div>
        {admin ? <span className="tag accent" style={{ fontSize: 11, padding: "4px 10px" }}>Admin</span> : null}
      </div>
      <div className="scroll pad stack gap22" style={{ paddingTop: 6, gap: 22 }}>
        {admin ? <AdminSettings initialOpen={params.open} /> : (
          <div className="stack gap10">
            <span className="sec">Your storage</span>
            <div className="card stack gap12" style={{ padding: 16 }}>
              <div className="hrow between" style={{ alignItems: "baseline" }}><span style={{ fontSize: 22, fontWeight: 700 }}>{gb(use.total)} <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}>{quota ? "of " + me.quota + " GB" : "· unlimited"}</span></span>{quota ? <span className="small muted">{gb(Math.max(0, quota - use.total))} left</span> : null}</div>
              <UsageBar total={quota || Math.max(use.total * 1.5, 1e9)} parts={[{ v: use.clips, c: "var(--accent)" }, { v: use.mashes, c: "#6FA8DC" }, { v: use.music, c: "#9B87D6" }]} />
              <div className="hrow wrap gap12" style={{ fontSize: 11.5, color: "#BDB7AD" }}><span className="hrow gap4"><span className="dot" style={{ background: "var(--accent)", borderRadius: 2 }} />Clips {gb(use.clips)}</span><span className="hrow gap4"><span className="dot" style={{ background: "#6FA8DC", borderRadius: 2 }} />Mashes {gb(use.mashes)}</span><span className="hrow gap4"><span className="dot" style={{ background: "#9B87D6", borderRadius: 2 }} />Music {gb(use.music)}</span></div>
              <span className="small faint" style={{ lineHeight: 1.4 }}>Clips in shared projects count toward whoever filmed them. Deleting old mashes is the quickest way to free space.</span>
            </div>
          </div>
        )}
        <div className="stack gap10"><span className="sec">You</span><YouLinks /></div>
        {!admin ? (
          <div className="stack gap10">
            <span className="sec">This server</span>
            <div className="card stack gap12">
              {[["Server", db.server.name], ["Admin", adminName], ["Version", db.server.version]].map((r) => <div key={r[0]} className="hrow between" style={{ fontSize: 13 }}><span className="muted">{r[0]}</span><span style={{ fontWeight: 600 }}>{r[1]}</span></div>)}
              <button className="btn sm ghost" disabled={asked} onClick={() => act("contactAdmin").then(() => { setAsked(true); toast("Message sent to " + adminName.split(" ")[0]); }).catch(() => {})}>{asked ? "Message sent" : "Contact the admin"}</button>
            </div>
          </div>
        ) : null}
        <span className="tiny faint" style={{ textAlign: "center", padding: "4px 0 12px" }}>Glimpse v{db.server.version}</span>
      </div>
    </Screen>
  );
}
