import { handle, json, body, checkOrigin, str, clientIp } from "@/server/http";
import { signup } from "@/server/auth";
import { hit } from "@/server/ratelimit";
import { fail } from "@/server/core";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  if ((await hit("signup-ip:" + clientIp(req), 3600)) > 20) fail(429, "Too many attempts. Try again later.");
  const b = await body(req);
  return json(await signup({ token: str(b.token, 200), name: str(b.name, 80), email: str(b.email, 200), password: str(b.password, 500), tz: str(b.tz, 60) }, req.headers.get("user-agent")));
});
