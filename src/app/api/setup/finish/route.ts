import { handle, json, body, checkOrigin, str, num, clientIp } from "@/server/http";
import { checkSetupCode, finishSetup } from "@/server/auth";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  await checkSetupCode(str(b.code, 20), clientIp(req));
  const sm = b.smtp as Record<string, unknown> | null, so = b.sso as Record<string, unknown> | null;
  await finishSetup({
    name: str(b.name, 80), email: str(b.email, 200), password: str(b.password, 500), tz: str(b.tz, 60), serverName: str(b.serverName, 60), quota: num(b.quota, 0, 1000, 5),
    smtp: sm ? { host: str(sm.host, 200), port: str(sm.port, 6), user: str(sm.user, 200), pass: str(sm.pass, 500), from: str(sm.from, 200) } : null,
    sso: so ? { issuer: str(so.issuer, 500), clientId: str(so.clientId, 300), secret: str(so.secret, 500) } : null
  }, req.headers.get("user-agent"));
  return json({ ok: true });
});
