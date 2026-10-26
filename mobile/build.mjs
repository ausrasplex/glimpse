// Bundles the Glimpse interface (../src/client) with the app's start-up code into www/, which Capacitor ships inside
// the APK. The server is never part of it: the app talks to whichever Glimpse server the person chooses.
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";

const out = "www";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

await build({
  entryPoints: { app: "src/boot.jsx" },
  outdir: out,
  bundle: true,
  format: "esm",
  target: ["chrome110"],
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"', __APP_VERSION__: JSON.stringify(version) },
  loader: { ".woff2": "file", ".ttf": "file", ".png": "file", ".svg": "file" }
});

writeFileSync(out + "/index.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- No viewport-fit=cover: Android keeps the page between the status and navigation bars on every WebView version. -->
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#121212">
<title>Glimpse</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`);
console.log("Built " + out + "/ (app " + version + ")");
