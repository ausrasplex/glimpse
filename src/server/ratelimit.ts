import { redis } from "./queue";

// Fixed-window counter. Returns the count after this hit.
export async function hit(key: string, windowSec: number): Promise<number> {
  const r = redis();
  const k = "rl:" + key;
  const n = await r.incr(k);
  if (n === 1) await r.expire(k, windowSec);
  return n;
}
export async function count(key: string): Promise<number> { return Number((await redis().get("rl:" + key)) || 0); }
export async function clear(key: string) { await redis().del("rl:" + key); }
export async function ttl(key: string): Promise<number> { return Math.max(0, await redis().ttl("rl:" + key)); }
