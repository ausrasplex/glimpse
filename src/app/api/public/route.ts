import { handle, json } from "@/server/http";
import { publicBootstrap } from "@/server/bootstrap";
export const dynamic = "force-dynamic";
export const GET = handle(async () => json(await publicBootstrap()));
