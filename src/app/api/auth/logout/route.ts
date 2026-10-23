import { handle, json, checkOrigin } from "@/server/http";
import { currentSession, destroySession } from "@/server/session";
import { configFromSettings, endSessionUrl } from "@/server/oidc";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const s = await currentSession();
  let redirect: string | null = null;
  if (s?.session.viaSso && s.session.idToken) {
    try { const c = await configFromSettings(); if (c && c.settings.sso.idpLogout) redirect = endSessionUrl(c.config, s.session.idToken); } catch { redirect = null; }
  }
  await destroySession();
  return json({ ok: true, redirect });
});
