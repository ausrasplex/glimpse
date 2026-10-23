import { handle, json, body, checkOrigin, str, clientIp } from "@/server/http";
import { checkSetupCode } from "@/server/auth";
import { testProvider } from "@/server/oidc";
import { fail } from "@/server/core";
export const POST = handle(async (req: Request) => {
  checkOrigin(req);
  const b = await body(req);
  await checkSetupCode(str(b.code, 20), clientIp(req));
  try { return json({ ok: true, issuer: await testProvider(str(b.issuer, 500), str(b.clientId, 300), str(b.secret, 500)) }); }
  catch (e) { return fail(400, "Couldn't reach the provider: " + (e as Error).message + ". Check the issuer URL matches your provider exactly."); }
});
