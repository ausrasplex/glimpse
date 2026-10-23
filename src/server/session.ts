import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "./db";
import { token, sha256 } from "./ids";
import { env } from "./env";

export const COOKIE = "glimpse_session";
const DAYS = 60;

export async function createSession(userId: string, opts: { userAgent?: string | null; viaSso?: boolean; idToken?: string | null } = {}) {
  const t = token(32);
  await db.insert(schema.sessions).values({
    id: sha256(t), userId, expiresAt: new Date(Date.now() + DAYS * 86400e3),
    userAgent: opts.userAgent?.slice(0, 300) ?? null, viaSso: !!opts.viaSso, idToken: opts.idToken ?? null
  });
  const c = await cookies();
  c.set(COOKIE, t, { httpOnly: true, sameSite: "lax", secure: env.secureCookies, path: "/", maxAge: DAYS * 86400 });
  await db.update(schema.users).set({ lastActiveAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, userId));
}

export async function currentSession() {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (!t) return null;
  const sid = sha256(t);
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
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (t) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(t)));
  c.delete(COOKIE);
}

export async function signOutOthers(userId: string) {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  const keep = t ? sha256(t) : "";
  const all = await db.query.sessions.findMany({ where: eq(schema.sessions.userId, userId) });
  for (const s of all) if (s.id !== keep) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
}
