import { handle, json, body, checkOrigin, str, clientIp } from "@/server/http";
import { checkSetupCode } from "@/server/auth";
import { sendWith } from "@/server/mail";
import { fail } from "@/server/core";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  await checkSetupCode(str(b.code, 20), clientIp(req));
  const s = (b.smtp || {}) as Record<string, unknown>;
  try { await sendWith({ host: str(s.host, 200), port: str(s.port, 6), user: str(s.user, 200), pass: str(s.pass, 500), from: str(s.from, 200) }, str(b.to, 200), "Glimpse test email", "Email from your Glimpse server is working."); }
  catch (e) { fail(400, "Couldn't send: " + (e as Error).message); }
  return json({ ok: true });
});
