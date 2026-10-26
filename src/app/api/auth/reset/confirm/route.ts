import { handle, json, body, checkOrigin, str } from "@/server/http";
import { confirmReset } from "@/server/auth";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  return json({ ok: true, ...(await confirmReset(str(b.token, 200), str(b.password, 500), req.headers.get("user-agent"))) });
});
