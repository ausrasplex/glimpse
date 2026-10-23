// Runtime configuration from environment variables (set in the Unraid template).
import pkg from "../../package.json";
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get databaseUrl() { return req("DATABASE_URL"); },
  get redisUrl() { return req("REDIS_URL", "redis://127.0.0.1:6379"); },
  get secretKey() { return req("SECRET_KEY"); },
  get appUrl() { return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""); },
  /** "local" (default): files in MEDIA_DIR. "s3": an S3-compatible store. Older installs with S3_ENDPOINT set and no STORAGE keep using S3. */
  get storage(): "local" | "s3" {
    const v = (process.env.STORAGE || "").trim().toLowerCase();
    if (v === "s3" || v === "local") return v;
    return process.env.S3_ENDPOINT ? "s3" : "local";
  },
  get mediaDir() { return process.env.MEDIA_DIR || "/media"; },
  get s3() {
    return {
      endpoint: req("S3_ENDPOINT"),
      bucket: req("S3_BUCKET", "glimpse"),
      accessKeyId: req("S3_ACCESS_KEY"),
      secretAccessKey: req("S3_SECRET_KEY"),
      region: process.env.S3_REGION || "us-east-1"
    };
  },
  get dataDir() { return process.env.DATA_DIR || "/data"; },
  get oidcEnv() {
    const issuer = process.env.OIDC_ISSUER, clientId = process.env.OIDC_CLIENT_ID, clientSecret = process.env.OIDC_CLIENT_SECRET;
    return issuer && clientId && clientSecret ? { issuer, clientId, clientSecret } : null;
  },
  /** App version from package.json, e.g. "1.0.0". */
  get version() { return pkg.version; },
  /** What the image was built from (a git tag or main-<commit>), set by the GitHub workflow. */
  get build() { return process.env.GLIMPSE_VERSION || "dev"; },
  get secureCookies() { return (process.env.APP_URL || "").startsWith("https://"); }
};
