import { scrypt, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { env } from "./env";

const N = 16384, R = 8, P = 1, KEYLEN = 64;
function scryptAsync(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) { await scryptAsync(pw, randomBytes(16)); return false; } // same cost either way
  const [alg, , , , saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const key = await scryptAsync(pw, Buffer.from(saltB64, "base64"));
  const want = Buffer.from(keyB64, "base64");
  return want.length === key.length && timingSafeEqual(want, key);
}

// AES-256-GCM for secrets at rest (Immich API keys, OIDC/SMTP secrets).
const encKey = () => createHash("sha256").update("glimpse-enc:" + env.secretKey).digest();
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const out = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), out.toString("base64")].join(".");
}
export function decrypt(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const [v, iv, tag, data] = blob.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}
