// Applies drizzle/*.sql in order, once each, under an advisory lock.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

export async function migrate(client: pg.Client | pg.PoolClient, dir: string, log = console.log) {
  await client.query("SELECT pg_advisory_lock(727274)");
  try {
    await client.query("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query("SELECT name FROM _migrations")).rows.map((r: { name: string }) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), "utf8");
      await client.query("BEGIN");
      try { await client.query(sql); await client.query("INSERT INTO _migrations (name) VALUES ($1)", [f]); await client.query("COMMIT"); log("applied migration " + f); }
      catch (e) { await client.query("ROLLBACK"); throw new Error(`Migration ${f} failed: ${(e as Error).message}`); }
    }
  } finally { await client.query("SELECT pg_advisory_unlock(727274)"); }
}
