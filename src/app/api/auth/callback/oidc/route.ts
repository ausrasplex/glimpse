import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { configFromSettings, finish } from "@/server/oidc";
import { decrypt } from "@/server/crypto";
import { ssoSignIn } from "@/server/auth";
import { createSession } from "@/server/session";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const jar = await cookies();
  const raw = decrypt(jar.get("glimpse_oidc")?.value);
  jar.delete({ name: "glimpse_oidc", path: "/api/auth" });
  const back = (q: string) => NextResponse.redirect(env.appUrl + q);
  if (!raw) return back("/login?error=expired");
  const st = JSON.parse(raw) as { state: string; nonce: string; verifier: string; invite: string | null; link: string | null; at: number };
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
    await createSession(r.userId, { userAgent: req.headers.get("user-agent"), viaSso: true, idToken: idn.idToken });
    return back("/");
  } catch (e) {
    console.error("[oidc callback]", (e as Error).message);
    return back("/login?error=failed");
  }
}
