import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { configFromSettings, startUrl } from "@/server/oidc";
import { encrypt } from "@/server/crypto";
import { currentSession } from "@/server/session";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const c = await configFromSettings();
    if (!c) return NextResponse.redirect(env.appUrl + "/login?error=sso_off");
    const link = q.get("link") === "1" ? (await currentSession())?.user.id ?? null : null;
    const st = await startUrl(c.config, c.settings);
    (await cookies()).set("glimpse_oidc", encrypt(JSON.stringify({ state: st.state, nonce: st.nonce, verifier: st.verifier, invite: q.get("invite"), link, at: Date.now() })), { httpOnly: true, sameSite: "lax", secure: env.secureCookies, path: "/api/auth", maxAge: 600 });
    return NextResponse.redirect(st.url);
  } catch (e) {
    console.error("[oidc start]", (e as Error).message);
    return NextResponse.redirect(env.appUrl + "/login?error=failed");
  }
}
