import type { db } from "../db";
import type { ServerSettings } from "../settings";
import type { schema } from "../db";

export type Ctx = { user: typeof schema.users.$inferSelect; settings: ServerSettings; db: typeof db; ip: string };
export type Args = Record<string, unknown>;
export type Action = (ctx: Ctx, args: Args) => Promise<unknown>;
