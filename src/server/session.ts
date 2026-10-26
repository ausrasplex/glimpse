import { cookies, headers } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "./db";
import { token, sha256 } from "./ids";
import { env } from "./env";

export const COOKIE = "glimpse_session";
const DAYS = 60;

// The Android app can't use the cookie (its pages come from the phone, not the server). It sends the session token as
// "Authorization: Bearer …", and adds a file key (?k=) to media and font links, which only the file routes accept.
export const APP_HEADER = "x-glimpse-app";
export async function fromApp() { return (await headers()).get(APP_HEADER) === "1"; }
async function requestToken(): Promise<string | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (t) return t;
  const a = (await headers()).get("authorization") || "";
  return a.startsWith("Bearer ") ? a.slice(7).trim() || null : null;
}
const keySig = (sid: string) => createHmac("sha256", "glimpse-files:" + env.secretKey).update(sid).digest("base64url").slice(0, 32);
export const fileKey = (sid: string) => sid + "." + keySig(sid);
function sidFromFileKey(k: string | null): string | null {
  if (!k) return null;
  const [sid, sig] = k.split(".");
  if (!sid || !sig) return null;
  const want = Buffer.from(keySig(sid)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? sid : null;
}

export async function createSession(userId: string, opts: { userAgent?: string | null; viaSso?: boolean; idToken?: string | null; forApp?: boolean } = {}) {
  const t = token(32);
  await db.insert(schema.sessions).values({
    id: sha256(t), userId, expiresAt: new Date(Date.now() + DAYS * 86400e3),
    userAgent: opts.userAgent?.slice(0, 300) ?? null, viaSso: !!opts.viaSso, idToken: opts.idToken ?? null
  });
  const app = opts.forApp || (await fromApp());
  if (!app) (await cookies()).set(COOKIE, t, { httpOnly: true, sameSite: "lax", secure: env.secureCookies, path: "/", maxAge: DAYS * 86400 });
  await db.update(schema.users).set({ lastActiveAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, userId));
  // The app keeps the token itself; browsers never see it.
  return app ? { token: t } : {};
}

export async function currentSession() {
  const t = await requestToken();
  return sessionById(t ? sha256(t) : null);
}

// For the routes that serve files: the session, or the app's file key on the link.
export async function fileSession(req: Request) {
  return (await currentSession()) ?? sessionById(sidFromFileKey(new URL(req.url).searchParams.get("k")));
}

async function sessionById(sid: string | null) {
  if (!sid) return null;
  const s = await db.query.sessions.findFirst({ where: and(eq(schema.sessions.id, sid), gt(schema.sessions.expiresAt, new Date())) });
  if (!s) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, s.userId) });
  if (!user || user.disabled) return null;
  // Touch at most every 10 minutes.
  if (Date.now() - s.lastSeenAt.getTime() > 600e3) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, sid));
    await db.update(schema.users).set({ lastActiveAt: new Date() }).where(eq(schema.users.id, user.id));
  }
  return { session: s, user };
}

export async function destroySession() {
  const t = await requestToken();
  if (t) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(t)));
  (await cookies()).delete(COOKIE);
}

export async function signOutOthers(userId: string) {
  const t = await requestToken();
  const keep = t ? sha256(t) : "";
  const all = await db.query.sessions.findMany({ where: eq(schema.sessions.userId, userId) });
  for (const s of all) if (s.id !== keep) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
}
