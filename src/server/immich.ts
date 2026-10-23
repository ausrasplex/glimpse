// Read-only access to a person's own Immich library, through their own API key.
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getSettings } from "./settings";
import { decrypt } from "./crypto";
import { fail } from "./core";

export async function immich(userId: string, path: string, init?: RequestInit) {
  const s = await getSettings();
  if (!s.immich.on || !s.immich.url) fail(400, "Immich import is turned off.");
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const key = decrypt(u?.immichKeyEnc);
  if (!key) fail(400, "Connect your Immich account in Profile first.");
  let r: Response;
  try { r = await fetch(s.immich.url.replace(/\/$/, "") + path, { ...init, headers: { ...(init?.headers || {}), "x-api-key": key!, Accept: "application/json", "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { return fail(502, "Couldn't reach Immich at " + s.immich.url + ". " + (e as Error).message); }
  if (r.status === 401 || r.status === 403) fail(400, "Immich didn't accept your API key. Reconnect it in Profile.");
  if (!r.ok) fail(502, "Immich answered " + r.status + ".");
  return r;
}

export async function testImmich(url: string, key?: string) {
  const r = await fetch(url.replace(/\/$/, "") + "/api/server/version", { headers: key ? { "x-api-key": key } : {}, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("Immich answered " + r.status);
  const v = (await r.json()) as { major: number; minor: number; patch: number };
  return `Immich v${v.major}.${v.minor}.${v.patch}`;
}

const durSec = (d: unknown) => { const m = /^(\d+):(\d+):([\d.]+)$/.exec(String(d || "")); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };

export async function listAssets(userId: string, type: "VIDEO" | "IMAGE", page: number) {
  const r = await immich(userId, "/api/search/metadata", { method: "POST", body: JSON.stringify({ type, page, size: 120, order: "desc", withExif: true }) });
  const j = (await r.json()) as { assets?: { items?: Record<string, unknown>[]; nextPage?: string | null } };
  const items = (j.assets?.items || []).map((a) => {
    const ex = (a.exifInfo || {}) as Record<string, unknown>;
    let w = Number(ex.exifImageWidth || a.width || 0), h = Number(ex.exifImageHeight || a.height || 0);
    if (["6", "8", "Rotate 90 CW", "Rotate 270 CW"].includes(String(ex.orientation || ""))) [w, h] = [h, w];
    const local = String(a.localDateTime || a.fileCreatedAt || "");
    return { id: String(a.id), kind: type === "VIDEO" ? "video" : "photo", date: local.slice(0, 10), dur: Math.round(durSec(a.duration)), orient: !w || !h ? "portrait" : Math.abs(w - h) / Math.max(w, h) < 0.08 ? "square" : w > h ? "landscape" : "portrait" };
  });
  return { items, nextPage: j.assets?.nextPage ? Number(j.assets.nextPage) : null };
}
