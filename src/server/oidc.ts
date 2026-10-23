// Single sign-on with any OpenID Connect provider (Authentik, Authelia, Keycloak, Pocket ID, Zitadel...).
import * as client from "openid-client";
import { getSettings, ssoSecret, type ServerSettings } from "./settings";
import { env } from "./env";

export const redirectUri = () => env.appUrl + "/api/auth/callback/oidc";

const cache = new Map<string, { at: number; config: client.Configuration }>();
export async function oidcConfig(issuer: string, clientId: string, secret: string): Promise<client.Configuration> {
  const k = issuer + "|" + clientId;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 3600e3) return hit.config;
  const opts = issuer.startsWith("http://") ? { execute: [client.allowInsecureRequests] } : undefined;
  const config = await client.discovery(new URL(issuer), clientId, secret, undefined, opts);
  cache.set(k, { at: Date.now(), config });
  return config;
}

export async function configFromSettings(s?: ServerSettings) {
  const st = s || (await getSettings());
  if (!st.sso.on || !st.sso.issuer || !st.sso.clientId) return null;
  const secret = ssoSecret(st);
  if (!secret) return null;
  return { config: await oidcConfig(st.sso.issuer, st.sso.clientId, secret), settings: st };
}

export function wantsGroups(s: ServerSettings) { return s.sso.newAccounts === "group" || !!s.sso.adminGroup.trim(); }

export async function startUrl(config: client.Configuration, s: ServerSettings) {
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = client.randomState(), nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(), scope: "openid email profile" + (wantsGroups(s) ? " groups" : ""),
    code_challenge: challenge, code_challenge_method: "S256", state, nonce
  });
  return { url: url.href, state, nonce, verifier };
}

export type Identity = { sub: string; email: string | null; emailVerified: boolean; name: string; groups: string[]; idToken: string | null };

export async function finish(config: client.Configuration, currentUrl: URL, st: { state: string; nonce: string; verifier: string }): Promise<Identity> {
  const tokens = await client.authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier: st.verifier, expectedState: st.state, expectedNonce: st.nonce, idTokenExpected: true });
  const claims = (tokens.claims() || {}) as Record<string, unknown>;
  let info: Record<string, unknown> = {};
  try { info = (await client.fetchUserInfo(config, tokens.access_token, String(claims.sub))) as Record<string, unknown>; } catch { info = {}; }
  const all = { ...info, ...claims };
  const ev = all.email_verified;
  const groupsRaw = all.groups ?? all.roles ?? [];
  return {
    sub: String(claims.sub),
    email: typeof all.email === "string" ? all.email.toLowerCase() : null,
    // Some providers (e.g. Authentik by default) leave the claim out. The admin chose to trust this
    // provider, so a missing claim counts as verified; an explicit "false" never does.
    emailVerified: ev === undefined || ev === null ? true : ev === true || ev === "true",
    name: String(all.name || all.preferred_username || all.nickname || (typeof all.email === "string" ? all.email.split("@")[0] : "New person")).slice(0, 80),
    groups: Array.isArray(groupsRaw) ? groupsRaw.map(String) : typeof groupsRaw === "string" ? [groupsRaw] : [],
    idToken: tokens.id_token ?? null
  };
}

export function endSessionUrl(config: client.Configuration, idToken: string): string | null {
  try { return client.buildEndSessionUrl(config, { id_token_hint: idToken, post_logout_redirect_uri: env.appUrl + "/login" }).href; } catch { return null; }
}

export async function testProvider(issuer: string, clientId: string, secret: string): Promise<string> {
  cache.delete(issuer + "|" + clientId);
  const c = await oidcConfig(issuer, clientId, secret);
  const m = c.serverMetadata();
  if (!m.authorization_endpoint || !m.token_endpoint) throw new Error("The provider's discovery document is missing its sign-in endpoints.");
  return m.issuer;
}
