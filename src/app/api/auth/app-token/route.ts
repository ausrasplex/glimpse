import { createHash } from "node:crypto";
import { handle, json, body, str } from "@/server/http";
import { decrypt } from "@/server/crypto";
import { HttpError } from "@/server/core";
export const dynamic = "force-dynamic";

// The Android app's single sign-on finishes here: it trades the code from glimpse://auth for its session token,
// proving it started the sign-in with the secret whose hash it sent to /api/auth/oidc/start.
export const POST = handle(async (req: Request) => {
  const b = await body(req);
  const raw = decrypt(str(b.code, 4000));
  let c: { t?: string; ch?: string; at?: number } = {};
  try { if (raw) c = JSON.parse(raw); } catch { c = {}; }
  const ch = createHash("sha256").update(str(b.verifier, 200)).digest("base64url");
  if (!c.t || !c.at || Date.now() - c.at > 120e3 || c.ch !== ch) throw new HttpError(400, "That sign-in has expired. Try again.");
  return json({ token: c.t });
});
