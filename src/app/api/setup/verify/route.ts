import { handle, json, body, checkOrigin, str, clientIp } from "@/server/http";
import { checkSetupCode } from "@/server/auth";
import { env } from "@/server/env";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  await checkSetupCode(str(b.code, 20), clientIp(req));
  return json({ ok: true, appUrl: env.appUrl });
});
