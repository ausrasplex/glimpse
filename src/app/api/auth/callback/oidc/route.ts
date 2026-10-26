import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { configFromSettings, finish } from "@/server/oidc";
import { decrypt, encrypt } from "@/server/crypto";
import { ssoSignIn } from "@/server/auth";
import { createSession } from "@/server/session";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";

// Hands sign-in back to the Android app. A page rather than a redirect, so the phone's browser always offers to open the app.
function toApp(url: string) {
  const u = JSON.stringify(url).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Back to Glimpse</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#121212;color:#F2EFE9;font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}a{padding:14px 26px;border-radius:14px;background:#E8A33D;color:#141413;font-weight:700;text-decoration:none}</style></head>
<body><p>Signed in. Returning you to the Glimpse app…</p><a id="go">Open Glimpse</a><script>var u=${u};document.getElementById("go").href=u;location.href=u;</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function GET(req: Request) {
  const jar = await cookies();
  const raw = decrypt(jar.get("glimpse_oidc")?.value);
  jar.delete({ name: "glimpse_oidc", path: "/api/auth" });
  let st = { at: 0 } as { state: string; nonce: string; verifier: string; invite: string | null; link: string | null; challenge?: string | null; at: number };
  try { if (raw) st = JSON.parse(raw); } catch { /* treated as expired */ }
  const back = (q: string) => {
    if (!st.challenge) return NextResponse.redirect(env.appUrl + q);
    const err = q.match(/[?&](?:error|ssoError)=([\w-]+)/);
    return toApp("glimpse://auth?error=" + (err ? err[1] : "failed"));
  };
  if (!raw) return back("/login?error=expired");
  if (Date.now() - st.at > 600e3) return back("/login?error=expired");
  try {
    const c = await configFromSettings();
    if (!c) return back("/login?error=sso_off");
    // Rebuild the URL as the provider saw it (behind a reverse proxy req.url is the internal address).
    const u = new URL(req.url);
    const current = new URL(env.appUrl + u.pathname + u.search);
    const idn = await finish(c.config, current, st);
    const r = await ssoSignIn(idn, { inviteToken: st.invite, linkUserId: st.link });
    if ("linked" in r) return back("/profile?linked=1");
    if ("error" in r) return back((st.link ? "/profile?ssoError=" : "/login?error=") + r.error);
    const made = await createSession(r.userId, { userAgent: req.headers.get("user-agent"), viaSso: true, idToken: idn.idToken, forApp: !!st.challenge });
    // The app swaps this short-lived code (with the secret only it holds) for the session at /api/auth/app-token.
    if (st.challenge && "token" in made) return toApp("glimpse://auth?code=" + encodeURIComponent(encrypt(JSON.stringify({ t: made.token, ch: st.challenge, at: Date.now() }))));
    return back("/");
  } catch (e) {
    console.error("[oidc callback]", (e as Error).message);
    return back("/login?error=failed");
  }
}
