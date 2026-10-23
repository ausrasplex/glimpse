import { handle, json, body, requireUser, checkOrigin, clientIp, str } from "@/server/http";
import { actions } from "@/server/actions";
import { getSettings } from "@/server/settings";
import { db } from "@/server/db";
import { fail } from "@/server/core";
import { hit } from "@/server/ratelimit";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const { user } = await requireUser();
  if ((await hit("act:" + user.id, 60)) > 600) fail(429, "Slow down a little and try again.");
  const b = await body(req);
  const type = str(b.type, 40);
  const fn = Object.prototype.hasOwnProperty.call(actions, type) ? actions[type] : null;
  if (!fn) fail(400, "Unknown action.");
  const settings = await getSettings();
  const result = await fn!({ db, user, settings, ip: clientIp(req) }, (b.args && typeof b.args === "object" ? b.args : {}) as Record<string, unknown>);
  return json({ ok: true, result: result ?? null });
});
