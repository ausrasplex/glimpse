import { randomBytes, createHash } from "node:crypto";

const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function id(prefix = ""): string {
  const b = randomBytes(14);
  let s = "";
  for (let i = 0; i < 14; i++) s += ALPHA[b[i] % 62];
  return prefix + s;
}
export const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
