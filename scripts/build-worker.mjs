// Bundles the worker and the container start script into dist/ (no node_modules needed at runtime).
import { build } from "esbuild";
import { copyFileSync } from "node:fs";
const common = { bundle: true, platform: "node", target: "node22", format: "cjs", sourcemap: false, logLevel: "info", external: ["pg-native", "msgpackr-extract", "cpu-features", "ssh2"], tsconfig: "tsconfig.json" };
await build({ ...common, entryPoints: ["src/worker/index.ts"], outfile: "dist/worker.js" });
await build({ ...common, entryPoints: ["scripts/start.ts"], outfile: "dist/start.js" });
// The SVG renderer for text on mashes loads its WebAssembly from beside the worker.
copyFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm", "dist/resvg.wasm");
