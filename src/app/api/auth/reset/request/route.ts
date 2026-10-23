import { handle, json, body, checkOrigin, str, clientIp } from "@/server/http";
import { requestReset } from "@/server/auth";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  // Not awaited, so the response time is the same whether or not an email goes out.
  void requestReset(str(b.email, 200), clientIp(req)).catch((e) => console.error("[reset]", (e as Error).message));
  return json({ ok: true }); // identical whether or not the email has an account
});
