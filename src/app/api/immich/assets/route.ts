import { handle, json, requireUser } from "@/server/http";
import { listAssets } from "@/server/immich";
export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request) => {
  const { user } = await requireUser();
  const q = new URL(req.url).searchParams;
  return json(await listAssets(user.id, q.get("type") === "photo" ? "IMAGE" : "VIDEO", Math.max(1, Number(q.get("page")) || 1)));
});
