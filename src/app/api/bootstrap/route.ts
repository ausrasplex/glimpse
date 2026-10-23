import { handle, json, requireUser } from "@/server/http";
import { buildBootstrap } from "@/server/bootstrap";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { const { user } = await requireUser(); return json(await buildBootstrap(user)); });
