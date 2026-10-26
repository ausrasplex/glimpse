import { handle, json, requireUser } from "@/server/http";
import { buildBootstrap } from "@/server/bootstrap";
import { fromApp, fileKey } from "@/server/session";
export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const { user, session } = await requireUser();
  const d = await buildBootstrap(user);
  return json((await fromApp()) ? { ...d, fileKey: fileKey(session.id) } : d);
});
