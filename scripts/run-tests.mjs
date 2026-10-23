// Bundles tests/*.test.ts with esbuild and runs them with Node's built-in test runner.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const tests = readdirSync("tests").filter((f) => f.endsWith(".test.ts"));
await build({ entryPoints: tests.map((t) => "tests/" + t), outdir: ".test-dist", bundle: true, platform: "node", target: "node22", format: "esm", outExtension: { ".js": ".mjs" }, logLevel: "warning", packages: "external" });
const r = spawnSync(process.execPath, ["--test", ...tests.map((t) => ".test-dist/" + t.replace(/\.ts$/, ".mjs"))], { stdio: "inherit" });
process.exit(r.status ?? 1);
