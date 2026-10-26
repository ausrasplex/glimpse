// Hooks for the Android app (built from mobile/). The app sets window.GlimpseApp before the interface loads; in a
// browser it isn't there, so every function here leaves things exactly as they were.
export const app = typeof window !== "undefined" ? window.GlimpseApp || null : null;

// Server calls: the app's pages come from the phone, so they go to the chosen server with the session token.
export const apiUrl = (path) => (app && path.charAt(0) === "/" ? app.server + path : path);
export const apiHeaders = () => (app ? app.headers() : {});

// Media, fonts and downloads are loaded by the WebView itself, so their links carry the app's file key.
export const fileUrl = (u) => (app && typeof u === "string" && u.indexOf("/api/") === 0 ? app.fileUrl(u) : u);
export function appUrls(v) {
  if (!app || !v || typeof v !== "object") return typeof v === "string" ? fileUrl(v) : v;
  if (Array.isArray(v)) return v.map(appUrls);
  const out = {};
  Object.keys(v).forEach((k) => { out[k] = appUrls(v[k]); });
  return out;
}

// What a server reply means for the app: a new session token, or the key for file links.
export function fromServer(body) {
  if (!app || !body || typeof body !== "object") return body;
  if (typeof body.token === "string") app.setToken(body.token);
  if (typeof body.fileKey === "string") app.fileKey = body.fileKey;
  return appUrls(body);
}

// Single sign-on: a page change in a browser; in the app, the phone's browser and back through glimpse://.
export function startSso(path) {
  if (app) app.sso(path);
  else window.location.href = path;
}
export function download(path) {
  if (app) app.download(fileUrl(path));
  else window.location.href = path;
}
// The phone's own gallery and camera (the app only). Picked items are "phone files": { uri, name, type, size, taken }.
export const phone = app && app.media ? app.media : null;
// A link the page can show or play: a phone file through the app, a picked File through an object URL.
export const localUrl = (f) => (f && f.uri && app ? app.localUrl(f.uri) : URL.createObjectURL(f));

// Copy text. The app uses the phone's clipboard (Android's WebView doesn't allow the browser one); browsers try the
// clipboard API, then the older copy command, which still works after waiting on the server. Resolves to true if copied.
export async function copyText(text) {
  if (app && app.copy) { try { await app.copy(text); return true; } catch (e) { return false; } }
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* try the old way */ }
  try {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  } catch (e) { return false; }
}

// A small buzz on the phone ("tap" or "success"); nothing in a browser.
export const haptic = (kind) => { if (app && app.haptic) app.haptic(kind); };

export function signedOut() {
  if (app) app.setToken(null);
}
