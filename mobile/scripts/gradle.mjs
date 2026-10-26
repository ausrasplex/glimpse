// Runs the Android build (Gradle) with Java and the Android SDK found, even in a terminal opened before they were set up.
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const win = process.platform === "win32";
const env = { ...process.env };
// On Windows, settings saved for the user (JAVA_HOME, ANDROID_HOME) reach new terminals only; read them directly.
const saved = (name) => {
  if (!win) return null;
  try { const m = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8" }).match(/REG_\w+\s+(.+)/); return m ? m[1].trim() : null; } catch (e) { return null; }
};
const first = (...dirs) => dirs.find((d) => d && existsSync(d)) || null;
env.ANDROID_HOME = first(env.ANDROID_HOME, saved("ANDROID_HOME"), join(process.env.LOCALAPPDATA || "", "Android", "Sdk")) || env.ANDROID_HOME;
env.JAVA_HOME = first(env.JAVA_HOME, saved("JAVA_HOME"), "C:\\Program Files\\Android\\Android Studio\\jbr") || env.JAVA_HOME;
if (!env.JAVA_HOME) { console.error("Java wasn't found. Install it (see mobile/README.md) and try again."); process.exit(1); }

const r = spawnSync(win ? ".\\gradlew.bat" : "./gradlew", process.argv.slice(2), { cwd: "android", env, stdio: "inherit", shell: win });
process.exit(r.status ?? 1);
