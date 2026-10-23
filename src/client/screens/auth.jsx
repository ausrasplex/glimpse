import React from "react";
import { useApp, api, post } from "../store.jsx";
import { Icon, Logo } from "../icons.jsx";
import { Screen, PassInput, Strength, TimezonePicker, detectedZone, zoneLabel, Avatar, Thumb, Opts } from "../ui.jsx";
import { GRADS } from "../util.js";

const { useState, useEffect, useRef } = React;
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const ssoLabel = (sso) => "Sign in with " + ((sso && sso.label || "").trim() || "SSO");
export function SsoButton({ onClick, label, primary }) {
  return <button type="button" className={"btn" + (primary ? "" : " outline")} onClick={onClick}><Icon name="key" size={16} />{label}</button>;
}
export function OrRule({ text }) {
  return <div className="hrow gap10" style={{ margin: "4px 0" }}><span style={{ flex: 1, height: 1, background: "var(--line)" }} /><span className="small faint">{text}</span><span style={{ flex: 1, height: 1, background: "var(--line)" }} /></div>;
}

// Messages the SSO callback can send back to the sign-in page.
const SSO_ERRORS = {
  no_account: "There's no Glimpse account for that sign-in. This server is invite-only, so ask someone on it to invite you.",
  disabled: "This account is switched off. Ask the server admin to turn it back on.",
  email_unverified: "Your identity provider didn't confirm your email address, so Glimpse can't match it to an account.",
  sso_off: "Single sign-on isn't turned on for this server.",
  failed: "Single sign-on didn't work. Try again, or ask the admin to check the SSO settings.",
  expired: "That sign-in took too long. Try again."
};

function Backdrop() {
  const { db } = useApp();
  const tiles = []; for (let i = 0; i < 24; i++) tiles.push({ g: GRADS[(i * 5) % GRADS.length], op: 0.55 + (i % 3) * 0.15 });
  return (
    <div style={{ margin: "0 -24px", height: 280, position: "relative", overflow: "hidden" }} aria-hidden="true">
      <div style={{ position: "absolute", top: "-30%", bottom: "-30%", left: "-8%", right: "-8%", display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 3, transform: "rotate(-6deg)" }}>
        {[0, 1, 2, 3].map((c) => {
          const col = tiles.filter((_, i) => i % 4 === c);
          return (
            <div key={c} style={{ overflow: "hidden" }}>
              <div className={db.server.loginBg === "still" ? "" : "drift-col" + (c % 2 ? " rev" : "")} style={{ display: "flex", flexDirection: "column", gap: 3, animationDuration: (44 + c * 7) + "s" }}>
                {col.concat(col).map((t, i) => <div key={i} style={{ aspectRatio: "3 / 4", borderRadius: 8, background: t.g, opacity: t.op, flexShrink: 0 }} />)}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(18,18,18,0.2), #121212 92%)" }} />
    </div>
  );
}

export function Login({ params }) {
  const { db, nav, refresh } = useApp();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (!lockedUntil) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [lockedUntil]);
  useEffect(() => { if (!db.server.setupDone) nav.reset("setup"); }, []);
  const locked = lockedUntil > Date.now();
  const sso = db.server.sso || {};
  const recovery = params.recovery || null;
  const pwOn = !sso.on || sso.passwordLogin || !!recovery;
  const ssoErr = params.error ? SSO_ERRORS[params.error] || SSO_ERRORS.failed : "";

  const submit = async (e) => {
    e.preventDefault();
    if (locked || busy) return;
    setBusy(true); setErr("");
    try {
      await post("/api/auth/login", { email: email.trim(), password: pass, recovery });
      await refresh();
      nav.reset("home");
    } catch (x) {
      setErr(x.message);
      const m = /(\d+) minutes?/.exec(x.message);
      if (x.status === 429 && m) setLockedUntil(Date.now() + +m[1] * 60000);
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <div className="scroll" style={{ padding: "0 24px" }}>
        <Backdrop />
        <div className="stack gap6" style={{ marginTop: -40, position: "relative" }}>
          <div className="hrow gap10">
            <Logo size={40} />
            <div className="stack" style={{ gap: 1 }}><span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>Glimpse</span><span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{db.server.name}</span></div>
          </div>
          <h1 style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>{recovery ? "Admin recovery" : "Welcome back"}</h1>
          <span className="muted" style={{ fontSize: 14 }}>{recovery ? "This one-time link lets an admin sign in with a password while single sign-on is the only way in." : "One second a day, all in one place."}</span>
        </div>
        {sso.on && !recovery ? (
          <div className="stack gap12" style={{ marginTop: 24 }}>
            <SsoButton primary={!pwOn} label={ssoLabel(sso)} onClick={() => { window.location.href = "/api/auth/oidc/start"; }} />
            {ssoErr ? <span className="errtext" role="alert">{ssoErr}</span> : null}
            {pwOn ? <OrRule text="or use your password" /> : <span className="small faint" style={{ textAlign: "center" }}>This server only uses single sign-on.</span>}
          </div>
        ) : null}
        {pwOn ? <form onSubmit={submit} className="stack gap12" style={{ marginTop: sso.on && !recovery ? 12 : 24 }}>
          <div className="field">
            <label className="sec" htmlFor="li-email">Email</label>
            <input id="li-email" className="input" type="email" autoComplete="username" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} />
          </div>
          <div className="field">
            <div className="hrow between" style={{ alignItems: "baseline" }}>
              <label className="sec" htmlFor="li-pass">Password</label>
              {!recovery ? <button type="button" className="link" onClick={() => nav.go("reset", { email })}>Forgot password?</button> : null}
            </div>
            <PassInput id="li-pass" value={pass} onChange={(v) => { setPass(v); setErr(""); }} autoComplete="current-password" />
          </div>
          {err ? <span className="errtext" role="alert">{err}</span> : null}
          {locked ? <span className="small faint">You can try again in {Math.ceil((lockedUntil - Date.now()) / 60000)} min.</span> : null}
          <button className="btn" type="submit" disabled={locked || busy || !email || !pass} style={{ marginTop: 6 }}>{busy ? "Signing in…" : "Sign in"}</button>
        </form> : null}
        <p className="faint" style={{ textAlign: "center", fontSize: 12.5, lineHeight: 1.5, margin: "26px 0 30px" }}>No account? This server is invite-only.<br />Ask someone already on it to invite you.</p>
      </div>
    </Screen>
  );
}

export function ResetPassword({ params }) {
  const { nav, refresh, toast } = useApp();
  const [st, setSt] = useState(params.token ? "new" : "request");
  const [email, setEmail] = useState(params.email || "");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = p1.length >= 10 && p1 === p2;
  const request = async (e) => {
    e.preventDefault();
    if (!validEmail(email) || busy) return;
    setBusy(true);
    try { await post("/api/auth/reset/request", { email: email.trim() }); setSt("sent"); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const confirm = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setErr("");
    try { await post("/api/auth/reset/confirm", { token: params.token, password: p1 }); await refresh(); toast("Password updated. You're signed in."); nav.reset("home"); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <div className="scroll" style={{ padding: "20px 22px 30px" }}>
        <button className="iconbtn" aria-label="Back to sign in" onClick={() => nav.reset("login")}><Icon name="back" size={17} stroke={2.2} /></button>
        {st === "request" ? (
          <form className="stack gap20" style={{ marginTop: 30 }} onSubmit={request}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="key" size={26} color="var(--accent)" /></div>
            <div className="stack gap8">
              <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.01em" }}>Forgot your password?</h1>
              <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>Enter your email and we'll send a link to set a new one. If email isn't set up on this server, ask the admin to send you a reset link.</span>
            </div>
            <div className="field"><label className="sec" htmlFor="rp-email">Email</label><input id="rp-email" className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {err ? <span className="errtext">{err}</span> : null}
            <button className="btn" type="submit" disabled={!validEmail(email) || busy}>Send reset link</button>
          </form>
        ) : st === "sent" ? (
          <div className="stack gap20" style={{ marginTop: 30 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(125,179,159,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="mail" size={26} color="var(--ok)" /></div>
            <div className="stack gap8">
              <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.01em" }}>Check your email</h1>
              <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>If that address has an account, a reset link is on its way. It works once and expires in 1 hour.</span>
            </div>
            <button className="btn outline" onClick={() => nav.reset("login")}>Back to sign in</button>
          </div>
        ) : (
          <form className="stack gap16" style={{ marginTop: 30 }} onSubmit={confirm}>
            <div className="stack gap8"><h1 style={{ margin: 0, fontSize: 26 }}>Set a new password</h1><span className="muted" style={{ fontSize: 14 }}>At least 10 characters.</span></div>
            <div className="field"><label className="sec" htmlFor="rp-new">New password</label><PassInput id="rp-new" value={p1} onChange={setP1} autoComplete="new-password" /><Strength pass={p1} /></div>
            <div className="field"><label className="sec" htmlFor="rp-new2">Confirm</label><PassInput id="rp-new2" value={p2} onChange={setP2} autoComplete="new-password" />{p2 && p1 !== p2 ? <span className="errtext">Passwords don't match</span> : null}</div>
            {err ? <span className="errtext">{err}</span> : null}
            <span className="small faint">You'll be signed out on all other devices.</span>
            <button className="btn" type="submit" disabled={!ok || busy}>Save &amp; sign in</button>
          </form>
        )}
      </div>
    </Screen>
  );
}

export function Signup({ params }) {
  const { db, nav, refresh, toast } = useApp();
  const [inv, setInv] = useState(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [tz, setTz] = useState(detectedZone());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ssoOn = !!(db.server.sso && db.server.sso.on);
  const pwOn = !ssoOn || db.server.sso.passwordLogin;
  useEffect(() => {
    api("/api/auth/invite?token=" + encodeURIComponent(params.token || "")).then((r) => {
      setInv(r);
      if (r.email) { setEmail(r.email); setName(r.email.split("@")[0].replace(/^./, (c) => c.toUpperCase())); }
    }).catch(() => setInv(null));
  }, []);
  if (inv === undefined) return <Screen><div className="scroll" style={{ padding: 40 }}><span className="small faint">Checking your invite…</span></div></Screen>;
  if (!inv) {
    return (
      <Screen>
        <div className="scroll" style={{ padding: "20px 22px" }}>
          <button className="iconbtn" aria-label="Back" onClick={() => nav.reset("login")}><Icon name="back" size={17} stroke={2.2} /></button>
          <div className="stack gap10" style={{ marginTop: 40 }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>This invite link doesn't work</h1>
            <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>It may have been used already, revoked, or expired. Ask the person who invited you for a new one.</span>
          </div>
        </div>
      </Screen>
    );
  }
  const ok = name.trim() && pass.length >= 10 && validEmail(email.trim());
  const join = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await post("/api/auth/signup", { token: params.token, name: name.trim(), email: email.trim(), password: pass, tz });
      await refresh();
      toast("Welcome to " + db.server.name + ", " + name.trim().split(" ")[0]);
      if (r.projectId) nav.reset("project", { projectId: r.projectId }); else nav.reset("home");
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const by = { id: "inviter", name: inv.inviter.name, color: inv.inviter.color, photo: inv.inviter.photo };
  return (
    <Screen>
      <form className="scroll" style={{ padding: "0 22px 30px" }} onSubmit={join}>
        <div className="stack gap14" style={{ marginTop: 26, padding: 18, borderRadius: 18, background: "linear-gradient(135deg, rgba(107,63,91,0.55), rgba(201,138,75,0.35))", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="hrow gap10">
            <Avatar user={by} size={40} ring={false} />
            <span style={{ fontSize: 13.5, lineHeight: 1.4 }}><strong>{inv.inviter.name.split(" ")[0]}</strong> invited you to join<br /><strong>{inv.project ? inv.project.name : "Glimpse"}</strong> on {db.server.name}</span>
          </div>
          {inv.project && inv.project.strip.length ? <div className="hrow gap6">{inv.project.strip.map((u, i) => <Thumb key={i} m={{ thumb: u, grad: GRADS[i % GRADS.length] }} style={{ flex: 1, aspectRatio: "3 / 4", borderRadius: 7 }} />)}</div> : null}
          <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{inv.project ? inv.project.members + (inv.project.members === 1 ? " member · " : " members · ") + inv.project.clips + (inv.project.clips === 1 ? " clip so far · " : " clips so far · ") : ""}invite expires in {inv.daysLeft} {inv.daysLeft === 1 ? "day" : "days"}</span>
        </div>
        <div className="stack gap6" style={{ marginTop: 24 }}>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.01em" }}>Create your account</h1>
          <span className="muted" style={{ fontSize: 13.5 }}>{inv.project ? "You'll land straight in the project once you're in." : "You'll make your first project once you're in."}</span>
        </div>
        {ssoOn ? (
          <div className="stack gap12" style={{ marginTop: 20 }}>
            <SsoButton primary={!pwOn} label={"Join with " + ((db.server.sso.label || "").trim() || "SSO")} onClick={() => { window.location.href = "/api/auth/oidc/start?invite=" + encodeURIComponent(params.token); }} />
            <span className="small faint" style={{ lineHeight: 1.45 }}>{inv.email ? "Your SSO account's email must be " + inv.email + "." : "Uses the name and email from your SSO account. No Glimpse password needed."}</span>
            {pwOn ? <OrRule text="or create a password" /> : null}
          </div>
        ) : null}
        {pwOn ? (
          <>
            <div className="stack gap14" style={{ marginTop: 20 }}>
              <div className="field">
                <span className="sec">Email</span>
                {inv.email ? <div className="hrow gap10" style={{ padding: "13px 14px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--line-soft)" }}><span style={{ flex: 1, fontSize: 15, color: "#BDB7AD" }}>{inv.email}</span><Icon name="lock" size={16} color="var(--faint)" /></div>
                  : <input className="input" type="email" aria-label="Email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} autoComplete="email" />}
                <span className="small faint">{inv.email ? "This invite is for this email address only." : "This link works once. You'll sign in with this email."}</span>
              </div>
              <div className="field"><label className="sec" htmlFor="su-name">Your name</label><input id="su-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              <div className="field"><label className="sec" htmlFor="su-pass">Password</label><PassInput id="su-pass" value={pass} onChange={setPass} autoComplete="new-password" placeholder="At least 10 characters" /><Strength pass={pass} /></div>
              <div className="field"><span className="sec">Timezone</span><TimezonePicker value={tz} onChange={setTz} detected={detectedZone()} /></div>
            </div>
            {err ? <span className="errtext" style={{ display: "block", marginTop: 12 }}>{err}</span> : null}
            <button className="btn" type="submit" disabled={!ok || busy} style={{ marginTop: 22 }}>{inv.project ? "Join " + inv.project.name : "Create account"}</button>
          </>
        ) : null}
        <div style={{ marginTop: 14, textAlign: "center", fontSize: 12.5 }} className="faint">Already have an account? <button type="button" className="link" onClick={() => nav.reset("login")}>Sign in</button></div>
      </form>
    </Screen>
  );
}

const CHECKS = [
  { k: "db", label: "Database" }, { k: "redis", label: "Job queue (Redis)" },
  { k: "s3", label: "File storage" }, { k: "worker", label: "Render worker" }, { k: "disk", label: "App data folder" }
];

export function SetupWizard() {
  const { db, nav, refresh, toast } = useApp();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [f, setF] = useState({ name: "", email: "", pass: "", pass2: "", tz: detectedZone(), serverName: "Home Server", quota: 5, emailOk: false, smtp: { host: "", port: "587", user: "", pass: "", from: "" }, emailErr: "", issuer: "", clientId: "", secret: "", ssoOk: false, ssoErr: "" });
  const [health, setHealth] = useState({});
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const set = (k, v) => setF((o) => Object.assign({}, o, { [k]: v }));
  const setSmtp = (k, v) => setF((o) => Object.assign({}, o, { emailOk: false, emailErr: "", smtp: Object.assign({}, o.smtp, { [k]: v }) }));
  useEffect(() => { if (db.server.setupDone) nav.reset("login"); }, []);
  const digits = code.replace(/\D/g, "");
  const step1Ok = f.name.trim() && validEmail(f.email) && f.pass.length >= 10 && f.pass === f.pass2;
  const allOk = CHECKS.every((c) => health[c.k] && health[c.k].ok);
  const hasFail = CHECKS.some((c) => health[c.k] && !health[c.k].ok);
  const runHealth = async () => {
    setHealth({});
    try { const r = await post("/api/setup/health", { code: digits }); setHealth(r.checks); setInfo(r); } catch (x) { setHealth({ db: { ok: false, detail: x.message } }); }
  };
  const verify = async () => {
    setBusy(true);
    try { const r = await post("/api/setup/verify", { code: digits }); setInfo(r); setStep(1); } catch (x) { setCodeErr(x.message); } finally { setBusy(false); }
  };
  const blocked = (step === 0 && digits.length < 6) || (step === 1 && !step1Ok) || (step === 2 && !f.serverName.trim()) || (step === 3 && !allOk) || (step === 6 && !f.ssoOk);
  const go = (n) => { setStep(n); if (n === 3) runHealth(); };
  const next = () => { if (step === 0) { verify(); return; } if (!blocked) go(step + 1); };
  const labels = ["Continue", "Create account", "Continue", allOk ? "Continue" : hasFail ? "Waiting for fixes" : "Checking…", "Continue", "Continue", "Continue", "Continue"];
  const testEmail = async () => {
    setBusy(true);
    try { await post("/api/setup/email-test", { code: digits, smtp: f.smtp, to: f.email }); setF((o) => Object.assign({}, o, { emailOk: true, emailErr: "" })); }
    catch (x) { setF((o) => Object.assign({}, o, { emailOk: false, emailErr: x.message })); } finally { setBusy(false); }
  };
  const testSso = async () => {
    setBusy(true);
    try { await post("/api/setup/sso-test", { code: digits, issuer: f.issuer.trim(), clientId: f.clientId.trim(), secret: f.secret }); setF((o) => Object.assign({}, o, { ssoOk: true, ssoErr: "" })); }
    catch (x) { setF((o) => Object.assign({}, o, { ssoOk: false, ssoErr: x.message })); } finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true);
    try {
      await post("/api/setup/finish", { code: digits, name: f.name.trim(), email: f.email.trim(), password: f.pass, tz: f.tz, serverName: f.serverName.trim(), quota: f.quota, smtp: f.emailOk ? f.smtp : null, sso: f.ssoOk ? { issuer: f.issuer.trim(), clientId: f.clientId.trim(), secret: f.secret } : null });
      await refresh();
      toast("Setup finished. " + f.serverName.trim() + " is ready");
      nav.reset("home");
    } catch (x) { toast(x.message, null, "warn"); } finally { setBusy(false); }
  };
  const appUrl = (info && info.appUrl) || db.server.url;
  const H = ({ children, sub }) => <div className="stack gap10"><h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{children}</h1><span className="muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{sub}</span></div>;
  return (
    <Screen>
      <div style={{ padding: "22px 20px 0", flexShrink: 0 }} className="stack gap14">
        <div className="hrow between">
          <div className="hrow gap10"><Logo size={32} /><div className="stack" style={{ gap: 1 }}><span style={{ fontSize: 14, fontWeight: 800 }}>Glimpse</span><span style={{ fontSize: 11, color: "var(--muted)" }}>First-run setup</span></div></div>
          <span className="small muted">{step < 8 ? "Step " + (step + 1) + " of 9" : "Ready to finish"}</span>
        </div>
        <div className="steps" style={{ padding: 0, gridTemplateColumns: "repeat(9, minmax(0,1fr))", gap: 4 }}>{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
      </div>
      <div className="scroll" style={{ padding: "26px 20px 0" }}>
        {step === 0 ? (
          <div className="stack gap20">
            <H sub="To prove you're the one running this server, enter the setup code printed in the container's log.">Welcome. Let's set up your server</H>
            <div className="stack gap4" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--bg-deep)", border: "1px solid var(--line-soft)", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
              <span className="sec" style={{ fontFamily: "var(--font)" }}>Unraid › Docker › Glimpse › Logs</span>
              <span className="faint">[glimpse] No admin found, first-run setup enabled</span>
              <span style={{ color: "var(--accent)" }}>[glimpse] Setup code: ###-###</span>
            </div>
            <div className="field">
              <label className="sec" htmlFor="setup-code">Setup code</label>
              <input id="setup-code" className="input" inputMode="numeric" placeholder="000-000" value={code} onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(d.length > 3 ? d.slice(0, 3) + "-" + d.slice(3) : d); setCodeErr(""); }} style={{ textAlign: "center", fontSize: 26, fontWeight: 700, letterSpacing: "0.3em", fontFamily: "ui-monospace, Menlo, monospace", borderColor: codeErr ? "var(--danger-strong)" : undefined }} />
              {codeErr ? <span className="errtext">{codeErr}</span> : null}
            </div>
            <span className="small" style={{ color: "var(--ghost)" }}>Once setup is finished this page is switched off for good.</span>
          </div>
        ) : step === 1 ? (
          <div className="stack gap16">
            <H sub="This is your own account too. You'll use it to capture and mash like everyone else.">Create your admin account</H>
            <div className="field"><label className="sec" htmlFor="adm-name">Your name</label><input id="adm-name" className="input" placeholder="e.g. Jesse" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="field"><label className="sec" htmlFor="adm-email">Email</label><input id="adm-email" className="input" type="email" placeholder="you@example.com" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
            <div className="field"><label className="sec" htmlFor="adm-pass">Password</label><PassInput id="adm-pass" value={f.pass} onChange={(v) => set("pass", v)} placeholder="At least 10 characters" /><Strength pass={f.pass} /></div>
            <div className="field"><label className="sec" htmlFor="adm-pass2">Confirm password</label><PassInput id="adm-pass2" value={f.pass2} onChange={(v) => set("pass2", v)} />{f.pass2 && f.pass2 !== f.pass ? <span className="errtext">Passwords don't match</span> : null}</div>
            <div className="field"><span className="sec">Timezone</span><TimezonePicker value={f.tz} onChange={(v) => set("tz", v)} detected={detectedZone()} /></div>
          </div>
        ) : step === 2 ? (
          <div className="stack gap16">
            <H sub="The name appears on the sign-in page and in emails.">Name your server</H>
            <div className="field"><label className="sec" htmlFor="srv-name">Server name</label><input id="srv-name" className="input" value={f.serverName} onChange={(e) => set("serverName", e.target.value)} /></div>
            <div className="field">
              <span className="sec">Public web address</span>
              <div className="input" style={{ color: "#BDB7AD" }}>{appUrl}</div>
              <span className="small" style={{ lineHeight: 1.4, color: /^https:/.test(appUrl) ? "var(--faint)" : "var(--accent)" }}>Set by APP_URL in the container's settings. Used for invite links, emails and the SSO redirect.{/^https:/.test(appUrl) ? "" : " Without https, sign-ins aren't encrypted over the internet."}</span>
              {typeof window !== "undefined" && appUrl.replace(/\/$/, "") !== window.location.origin ? <span className="small" style={{ color: "var(--accent)", lineHeight: 1.4 }}>You opened this page at {window.location.origin}. If people use a different address, update APP_URL and restart the container.</span> : null}
            </div>
          </div>
        ) : step === 3 ? (
          <div className="stack gap16">
            <H sub="Making sure everything Glimpse needs is running and reachable.">Checking your setup</H>
            <div className="card flush list">
              {CHECKS.map((c) => {
                const r = health[c.k];
                const st = !r ? "pending" : r.ok ? "ok" : "fail";
                return (
                  <div key={c.k} className="stack gap6" style={{ padding: "13px 14px", background: st === "fail" ? "rgba(224,120,110,0.04)" : "transparent" }}>
                    <div className="hrow gap12">
                      <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: st === "ok" ? "var(--ok)" : st === "fail" ? "var(--danger-strong)" : "transparent", border: "2px solid " + (st === "ok" ? "var(--ok)" : st === "fail" ? "var(--danger-strong)" : "var(--line-strong)"), display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {st === "ok" ? <Icon name="check" size={12} stroke={3.2} color="#141413" /> : st === "fail" ? <Icon name="close" size={11} stroke={3.2} color="#fff" /> : null}
                      </span>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{c.label}</span>
                      <span className="small" style={{ color: st === "ok" ? "var(--ok)" : st === "fail" ? "#F0A49C" : "var(--faint)", textAlign: "right", maxWidth: "45%" }}>{st === "ok" ? r.detail : st === "fail" ? "Not working" : "Checking…"}</span>
                    </div>
                    {st === "fail" ? <div style={{ marginLeft: 34, padding: "10px 12px", borderRadius: 10, background: "rgba(224,120,110,0.08)", border: "1px solid rgba(224,120,110,0.3)", fontSize: 12.5, color: "#F0A49C", lineHeight: 1.45 }}>{r.detail}</div> : null}
                  </div>
                );
              })}
            </div>
            {hasFail ? <button className="btn outline" onClick={runHealth}>Fix it, then check again</button> : null}
          </div>
        ) : step === 4 ? (
          <div className="stack gap16">
            <H sub="How much space each new person gets by default. You can change anyone's limit later, and your own account is unlimited.">Storage for new people</H>
            {info && info.storage && info.storage.free ? <div className="card hrow between"><span className="stack gap2"><span className="muted" style={{ fontSize: 13 }}>Free in your media folder</span><span style={{ fontSize: 20, fontWeight: 700 }}>{info.storage.free}</span></span></div> : null}
            <Opts value={f.quota} onChange={(v) => set("quota", v)} options={[{ id: 1, label: "1 GB" }, { id: 5, label: "5 GB" }, { id: 10, label: "10 GB" }, { id: 25, label: "25 GB" }, { id: 0, label: "None" }]} />
          </div>
        ) : step === 5 ? (
          <div className="stack gap14">
            <H sub="Needed for email reminders, invites to new people and password resets. In-app notifications work without it.">Email <span className="faint" style={{ fontSize: 14 }}>· optional</span></H>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}><input className="input" aria-label="SMTP server" placeholder="smtp.example.com" value={f.smtp.host} onChange={(e) => setSmtp("host", e.target.value.trim())} /><input className="input" aria-label="Port" placeholder="587" inputMode="numeric" value={f.smtp.port} onChange={(e) => setSmtp("port", e.target.value.trim())} /></div>
            <input className="input" aria-label="Username" placeholder="Username" value={f.smtp.user} onChange={(e) => setSmtp("user", e.target.value)} />
            <input className="input" type="password" aria-label="Password" placeholder="Password" value={f.smtp.pass} onChange={(e) => setSmtp("pass", e.target.value)} />
            <input className="input" aria-label="From address" placeholder="From address, e.g. glimpse@yourdomain.com" value={f.smtp.from} onChange={(e) => setSmtp("from", e.target.value.trim())} />
            <button className="btn outline" disabled={busy || !f.smtp.host || !validEmail(f.smtp.from)} onClick={testEmail}>{f.emailOk ? "Send another test" : "Save & send test email"}</button>
            {f.emailOk ? <span style={{ fontSize: 12.5, color: "var(--ok)" }}>Test email sent to {f.email}. Email is working.</span> : f.emailErr ? <span className="errtext">{f.emailErr}</span> : <span className="small faint">Fill in the SMTP details to test, or skip for now.</span>}
          </div>
        ) : step === 6 ? (
          <div className="stack gap14">
            <H sub="Let people sign in with the identity provider you already run, like Authentik, Authelia, Keycloak or Pocket ID. New people still need an invite.">Single sign-on <span className="faint" style={{ fontSize: 14 }}>· optional</span></H>
            <div className="stack gap6" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--bg-deep)", border: "1px solid var(--line-soft)" }}>
              <span className="sec">1 · In your provider, create an OIDC app with this redirect URL</span>
              <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{appUrl.replace(/\/$/, "")}/api/auth/callback/oidc</span>
            </div>
            <span className="sec">2 · Paste what it gives you</span>
            <input className="input" aria-label="Issuer URL" placeholder="Issuer URL, e.g. https://auth.yourdomain.com/application/o/glimpse/" value={f.issuer} onChange={(e) => setF((o) => Object.assign({}, o, { issuer: e.target.value.trim(), ssoOk: false, ssoErr: "" }))} />
            <input className="input" aria-label="Client ID" placeholder="Client ID" value={f.clientId} onChange={(e) => setF((o) => Object.assign({}, o, { clientId: e.target.value, ssoOk: false, ssoErr: "" }))} />
            <input className="input" type="password" aria-label="Client secret" placeholder="Client secret" value={f.secret} onChange={(e) => setF((o) => Object.assign({}, o, { secret: e.target.value, ssoOk: false, ssoErr: "" }))} />
            <button className="btn outline" disabled={busy || !f.issuer || !f.clientId || !f.secret} onClick={testSso}>Test connection</button>
            {f.ssoOk ? <span style={{ fontSize: 12.5, color: "var(--ok)", lineHeight: 1.45 }}>Found your provider. Sign in with SSO once setup is done and it links to this admin account by email.</span> : f.ssoErr ? <span className="errtext">{f.ssoErr}</span> : <span className="small faint" style={{ lineHeight: 1.45 }}>Your admin account keeps its password either way, so a provider outage can't lock you out.</span>}
          </div>
        ) : step === 7 ? (
          <div className="stack gap16">
            <H sub="Mashes and playback copies are made with FFmpeg on the CPU.">Video rendering</H>
            <div className="card stack gap12">
              <div className="hrow gap12"><span style={{ width: 40, height: 40, borderRadius: 11, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="cpu" size={20} color="var(--muted)" /></span><span className="stack gap2"><span style={{ fontSize: 15, fontWeight: 700 }}>CPU rendering</span><span className="small muted">{info && info.ffmpeg ? info.ffmpeg : "FFmpeg"} · works on any server</span></span></div>
              <span className="small faint" style={{ lineHeight: 1.45 }}>You can choose how many renders run at once in Settings › Rendering.</span>
            </div>
          </div>
        ) : (
          <div className="stack gap20">
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: "rgba(125,179,159,0.16)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={28} stroke={2.6} color="var(--ok)" /></div>
            <H sub="Finishing locks setup for good. Here's what you've chosen:">{f.serverName} is ready</H>
            <div className="card flush list">
              {[["Admin", f.name + " · " + f.email], ["Timezone", zoneLabel(f.tz)], ["Web address", appUrl], ["New users get", f.quota === 0 ? "Unlimited" : f.quota + " GB"], ["Email", f.emailOk ? "Working" : "Skipped. Set it up in Settings", !f.emailOk], ["Single sign-on", f.ssoOk ? "Connected" : "Skipped. Passwords only"], ["Rendering", "CPU"], ["Created for you", "Diary & Freestyle categories, 2 reminders"]].map((r) => (
                <div key={r[0]} className="hrow between gap12" style={{ padding: "11px 14px", fontSize: 13 }}><span className="muted">{r[0]}</span><span style={{ fontWeight: 600, textAlign: "right", color: r[2] ? "var(--accent)" : "var(--fg)" }}>{r[1]}</span></div>
              ))}
            </div>
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>
      <div className="hrow gap10" style={{ padding: "16px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        {step > 1 && step < 9 ? <button className="btn outline" style={{ width: "auto", padding: "13px 16px" }} onClick={() => go(step - 1)}>Back</button> : null}
        {step === 5 && !f.emailOk ? <button className="btn outline" style={{ width: "auto", padding: "13px 16px" }} onClick={() => go(6)}>Skip</button> : null}
        {step === 6 && !f.ssoOk ? <button className="btn outline" style={{ width: "auto", padding: "13px 16px" }} onClick={() => go(7)}>Skip</button> : null}
        {step < 8 ? <button className="btn" style={{ flex: 1 }} disabled={blocked || busy} onClick={next}>{step === 0 && busy ? "Checking…" : labels[step]}</button> : <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={finish}>{busy ? "Finishing…" : "Finish & start capturing"}</button>}
      </div>
    </Screen>
  );
}
