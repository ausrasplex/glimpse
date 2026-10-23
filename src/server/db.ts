import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { env } from "./env";

// Created on first use, so building the app or running tests doesn't need a database.
const g = globalThis as unknown as { __glimpsePool?: pg.Pool; __glimpseDb?: NodePgDatabase<typeof schema> };
export function pool(): pg.Pool {
  if (!g.__glimpsePool) g.__glimpsePool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
  return g.__glimpsePool;
}
function real(): NodePgDatabase<typeof schema> {
  if (!g.__glimpseDb) g.__glimpseDb = drizzle(pool(), { schema });
  return g.__glimpseDb;
}
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_t, k) { const r = real() as unknown as Record<string | symbol, unknown>; const v = r[k]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(r) : v; }
});
export type DB = NodePgDatabase<typeof schema>;
export { schema };
