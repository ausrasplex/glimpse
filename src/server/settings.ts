// Server-wide settings, stored as one JSON document in the settings table.
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { env } from "./env";
import { encrypt, decrypt } from "./crypto";

export type SsoSettings = {
  on: boolean; label: string; issuer: string; clientId: string; secretEnc: string | null; tested: boolean;
  newAccounts: "invite" | "group"; group: string; adminGroup: string; passwordLogin: boolean; idpLogout: boolean;
};
export type ServerSettings = {
  setupDone: boolean; name: string; tz: string;
  userInvites: boolean; perDay: number; defaultQuota: number; warnAt: number;
  concurrency: number; maxRes: "720" | "1080" | "4k"; playback: "720" | "1080"; mashQuality: "smaller" | "high" | "best";
  musicUploads: boolean; loudness: boolean; trackSize: number; formats: Record<string, boolean>;
  /** Longer clips: off keeps the 10 second cap; max is seconds, 0 for no limit. */
  clipLimit: { on: boolean; max: number };
  /** Let people pick any Google Fonts family for text on mashes; the server downloads each one once. */
  googleFonts: boolean;
  email: { host: string; port: string; user: string; passEnc: string | null; from: string; ok: boolean };
  backup: { schedule: "daily" | "weekly" | "off"; keep: number; last: number | null; size: number };
  lockAfter: number; loginBg: "drift" | "still";
  sso: SsoSettings;
  immich: { on: boolean; url: string; tested: boolean };
};

export const DEFAULTS: ServerSettings = {
  setupDone: false, name: "Home Server", tz: process.env.TZ || "UTC",
  userInvites: false, perDay: 5, defaultQuota: 5, warnAt: 90,
  concurrency: 1, maxRes: "1080", playback: "720", mashQuality: "high",
  musicUploads: true, loudness: true, trackSize: 50, formats: { MP3: true, M4A: true, WAV: true, FLAC: true },
  clipLimit: { on: false, max: 60 }, googleFonts: true,
  email: { host: "", port: "587", user: "", passEnc: null, from: "", ok: false },
  backup: { schedule: "daily", keep: 7, last: null, size: 0 },
  lockAfter: 5, loginBg: "drift",
  sso: { on: false, label: "SSO", issuer: "", clientId: "", secretEnc: null, tested: false, newAccounts: "invite", group: "glimpse-users", adminGroup: "", passwordLogin: true, idpLogout: false },
  immich: { on: false, url: "", tested: false }
};

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

export async function getSettings(): Promise<ServerSettings> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "server") });
  const s = merge(DEFAULTS, row?.value);
  // OIDC from environment variables wins and locks the fields.
  const e = env.oidcEnv;
  if (e) s.sso = { ...s.sso, on: true, issuer: e.issuer, clientId: e.clientId, secretEnc: encrypt(e.clientSecret), tested: true };
  return s;
}

export async function saveSettings(patch: Partial<ServerSettings> | ((s: ServerSettings) => void)): Promise<ServerSettings> {
  const cur = await getSettings();
  let next: ServerSettings;
  if (typeof patch === "function") { next = structuredClone(cur); patch(next); } else next = merge(cur, patch);
  await db.insert(schema.settings).values({ key: "server", value: next }).onConflictDoUpdate({ target: schema.settings.key, set: { value: next } });
  return next;
}

export const ssoFromEnv = () => !!env.oidcEnv;
export const ssoSecret = (s: ServerSettings) => (env.oidcEnv ? env.oidcEnv.clientSecret : decrypt(s.sso.secretEnc));

// What any signed-in person (and the public sign-in page) may see.
/** What the Android app can rely on. Raise it when the app needs something new from the server. */
export const APP_API = 1;
export function publicSettings(s: ServerSettings, admin: boolean) {
  const pub = {
    name: s.name, url: env.appUrl, version: env.version, appApi: APP_API, tz: s.tz, setupDone: s.setupDone, loginBg: s.loginBg,
    lockAfter: s.lockAfter, userInvites: s.userInvites, perDay: s.perDay, defaultQuota: s.defaultQuota,
    musicUploads: s.musicUploads, trackSize: s.trackSize, formats: s.formats, maxRes: s.maxRes, mashQuality: s.mashQuality, clipLimit: s.clipLimit, googleFonts: s.googleFonts,
    email: { ok: s.email.ok },
    sso: { on: s.sso.on, label: s.sso.label, passwordLogin: !s.sso.on || s.sso.passwordLogin },
    immich: { on: s.immich.on }
  };
  if (!admin) return pub;
  return {
    ...s, url: env.appUrl, version: env.version, build: env.build,
    storage: env.storage === "s3" ? { kind: "s3", where: "bucket " + (process.env.S3_BUCKET || "glimpse") } : { kind: "local", where: env.mediaDir },
    email: { ...s.email, passEnc: undefined, passSet: !!s.email.passEnc },
    sso: { ...s.sso, secretEnc: undefined, secretSet: !!(s.sso.secretEnc || env.oidcEnv), fromEnv: ssoFromEnv() }
  };
}
