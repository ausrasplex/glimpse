// Bundles the worker and the container start script into dist/ (no node_modules needed at runtime).
import { build } from "esbuild";
const common = { bundle: true, platform: "node", target: "node22", format: "cjs", sourcemap: false, logLevel: "info", external: ["pg-native", "msgpackr-extract", "cpu-features", "ssh2"], tsconfig: "tsconfig.json" };
await build({ ...common, entryPoints: ["src/worker/index.ts"], outfile: "dist/worker.js" });
await build({ ...common, entryPoints: ["scripts/start.ts"], outfile: "dist/start.js" });
