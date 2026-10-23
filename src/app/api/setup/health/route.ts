import { handle, json, body, checkOrigin, str, clientIp } from "@/server/http";
import { checkSetupCode } from "@/server/auth";
import { healthChecks } from "@/server/health";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  await checkSetupCode(str(b.code, 20), clientIp(req));
  return json(await healthChecks());
});
