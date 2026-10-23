import { handle, json } from "@/server/http";
import { inviteInfo } from "@/server/auth";
export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => {
  const t = new URL(req.url).searchParams.get("token") || "";
  const info = await inviteInfo(t);
  return info ? json(info) : json({ error: "This invite link doesn't work." }, 404);
});
