// Container entry: check config, migrate, print the setup code if needed, then run web + worker.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomInt, randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import pg from "pg";
import { migrate } from "../src/server/migrate";
import pkg from "../package.json";

const log = (...a: unknown[]) => console.log("[glimpse]", ...a);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const APP = process.env.APP_DIR || "/app";

function checkEnv() {
  const want = (process.env.STORAGE || "").trim().toLowerCase();
  const useS3 = want === "s3" || (want !== "local" && !!process.env.S3_ENDPOINT);
  const missing = ["DATABASE_URL", "SECRET_KEY", "REDIS_URL"].concat(useS3 ? ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"] : []).filter((k) => !process.env[k]);
  if (missing.length) { log("Missing settings: " + missing.join(", ") + ". Fill these in on the container's template and start it again."); process.exit(1); }
  if ((process.env.SECRET_KEY || "").length < 32) { log("SECRET_KEY must be at least 32 characters. Generate one with: openssl rand -hex 32"); process.exit(1); }
  if (want && want !== "local" && want !== "s3") log(`STORAGE should be "local" or "s3" (got "${want}"). Using ${useS3 ? "S3" : "the local folder"}.`);
  if (useS3) log("File storage: S3 at " + process.env.S3_ENDPOINT + " · bucket " + (process.env.S3_BUCKET || "glimpse"));
  else {
    const dir = process.env.MEDIA_DIR || "/media";
    log("File storage: local folder " + dir);
    if (!mapped(dir)) log(`WARNING: nothing is mapped to ${dir}. Clips saved there live inside the container and will be LOST when it updates. Map a share (e.g. /mnt/user/glimpse-media) to ${dir} in the template.`);
  }
  if (!process.env.APP_URL) log("APP_URL isn't set. Invite links and SSO will use http://localhost:3000 until you set it.");
}

// Is dir on its own mount (a mapped share), rather than the container's own disk? Unknown (non-Linux) counts as yes.
function mapped(dir: string): boolean {
  let text: string;
  try { text = readFileSync("/proc/self/mountinfo", "utf8"); } catch { return true; }
  const target = resolve(dir);
  const mounts = text.split("\n").map((l) => (l.split(" ")[4] || "").replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))).filter(Boolean);
  const best = mounts.filter((m) => m === "/" || target === m || target.startsWith(m + "/")).sort((a, b) => b.length - a.length)[0];
  return !!best && best !== "/";
}

async function connect(): Promise<pg.Client> {
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try { await c.connect(); return c; }
    catch (e) {
      if (i >= 30) { log("Couldn't reach PostgreSQL: " + (e as Error).message); process.exit(1); }
      log(`Waiting for PostgreSQL (${(e as Error).message})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function prepare() {
  const c = await connect();
  await migrate(c, join(APP, "drizzle"), log);
  const admins = await c.query("SELECT 1 FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (!admins.rowCount) {
    const code = String(randomInt(0, 1e6)).padStart(6, "0");
    await c.query("INSERT INTO settings (key, value) VALUES ('setup', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ hash: sha(code), at: Date.now() })]);
    log("No admin found, first-run setup enabled");
    log(`Setup code: ${code.slice(0, 3)}-${code.slice(3)}`);
    log(`Open ${process.env.APP_URL || "http://<server-ip>:3000"} to finish setup.`);
  } else {
    const r = await c.query("SELECT value FROM settings WHERE key = 'server'");
    const s = r.rows[0]?.value || {};
    const envSso = !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);
    if ((s.sso?.on || envSso) && s.sso?.passwordLogin === false) {
      const t = randomBytes(24).toString("base64url");
      await c.query("INSERT INTO settings (key, value) VALUES ('recovery', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ hash: sha(t), at: Date.now() })]);
      log("Password sign-in is off. If single sign-on is broken, an admin can sign in once with a password here:");
      log(`${(process.env.APP_URL || "http://<server-ip>:3000").replace(/\/$/, "")}/login?recovery=${t}`);
    } else await c.query("DELETE FROM settings WHERE key = 'recovery'");
  }
  await c.end();
}

function startChild(name: string, file: string, env: NodeJS.ProcessEnv): ChildProcess {
  const p = spawn(process.execPath, [file], { stdio: "inherit", env });
  p.on("exit", (code, sig) => { log(`${name} stopped (${sig || code}). Shutting down so Docker can restart the container.`); shutdown(code || 1); });
  return p;
}

const children: ChildProcess[] = [];
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  for (const c of children) if (!c.killed) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 8000).unref();
  Promise.all(children.map((c) => new Promise((r) => c.once("exit", r)))).then(() => process.exit(code));
}

(async () => {
  checkEnv();
  await prepare();
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: process.env.PORT || "3000", HOSTNAME: "0.0.0.0", NODE_ENV: "production" as const };
  children.push(startChild("web server", join(APP, "server.js"), env));
  if ((process.env.GLIMPSE_WORKER || "true") !== "false") children.push(startChild("worker", join(APP, "dist/worker.js"), env));
  log(`Glimpse v${pkg.version}${process.env.GLIMPSE_VERSION ? " (" + process.env.GLIMPSE_VERSION + ")" : ""} is running on port ${env.PORT}`);
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
})().catch((e) => { log("Start-up failed:", (e as Error).message); process.exit(1); });
