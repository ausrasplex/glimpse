import { NextResponse } from "next/server";
import { HttpError } from "./core";
import { currentSession, fileSession } from "./session";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try { return await fn(...a); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error("[api]", e);
      return json({ error: "Something went wrong on the server. Try again." }, 500);
    }
  };
}

export async function requireUser() {
  const s = await currentSession();
  if (!s) throw new HttpError(401, "Please sign in again.");
  return s;
}
export async function requireFileUser(req: Request) {
  const s = await fileSession(req);
  if (!s) throw new HttpError(401, "Please sign in again.");
  return s;
}
export async function requireAdmin() {
  const s = await requireUser();
  if (s.user.role !== "ADMIN") throw new HttpError(403, "Only admins can do that.");
  return s;
}

// Same-origin check for state-changing requests (cookies are SameSite=Lax as well).
export const APP_ORIGINS = ["http://localhost", "https://localhost", "capacitor://localhost"];
export function checkOrigin(req: Request) {
  const o = req.headers.get("origin");
  if (!o || APP_ORIGINS.includes(o)) return;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  let appHost = "";
  try { appHost = new URL(process.env.APP_URL || "http://x").host; } catch { appHost = ""; }
  try { const oh = new URL(o).host; if (oh !== host && oh !== appHost) throw new HttpError(403, "Cross-site request blocked."); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(403, "Cross-site request blocked."); }
}

export const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");
export const bool = (v: unknown): boolean => v === true;
export const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function clientIp(req: Request): string {
  const f = req.headers.get("x-forwarded-for");
  return (f ? f.split(",")[0].trim() : req.headers.get("x-real-ip")) || "local";
}
export async function body(req: Request): Promise<Record<string, unknown>> {
  try { const b = await req.json(); return b && typeof b === "object" ? (b as Record<string, unknown>) : {}; } catch { return {}; }
}
