import { handle, json, body, clientIp, checkOrigin, str } from "@/server/http";
import { login } from "@/server/auth";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  return json(await login(str(b.email, 200), str(b.password, 500), b.recovery ? str(b.recovery, 200) : null, clientIp(req), req.headers.get("user-agent")));
});
