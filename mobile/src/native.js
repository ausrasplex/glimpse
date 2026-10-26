// The bridge between the Glimpse interface and the phone. Sets window.GlimpseApp, which ../../src/client/platform.js
// looks for: in a browser it's missing and the interface behaves as the website does.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

// Glimpse's own native pieces (android/app/src/main/java/app/glimpse/mobile).
const Media = registerPlugin("GlimpseMedia");
const Uploads = registerPlugin("GlimpseUploads");

/** The oldest server this app works with (the server reports its own as server.appApi). */
export const MIN_SERVER_API = 1;
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let ssoVerifier = null;
const g = {
  native: Capacitor.isNativePlatform(),
  version: __APP_VERSION__,
  server: "",
  token: null,
  fileKey: null,

  // The chosen server and its sign-in. The token lives in the phone's secure storage (Android Keystore).
  async load() {
    const s = await Preferences.get({ key: "server" });
    this.server = s.value || "";
    this.token = this.server ? await SecureStorage.get("token:" + this.server).catch(() => null) : null;
  },
  async setServer(url) {
    this.server = url;
    this.token = null; this.fileKey = null;
    await Preferences.set({ key: "server", value: url });
  },
  async forgetServer() {
    if (this.server) await SecureStorage.remove("token:" + this.server).catch(() => {});
    await Preferences.remove({ key: "server" });
    this.server = ""; this.token = null; this.fileKey = null;
  },
  setToken(t) {
    this.token = t || null;
    if (!t) this.fileKey = null;
    const k = "token:" + this.server;
    (t ? SecureStorage.set(k, t) : SecureStorage.remove(k)).catch(() => {});
  },

  headers() { return Object.assign({ "X-Glimpse-App": "1" }, this.token ? { Authorization: "Bearer " + this.token } : {}); },
  fileUrl(u) { return this.server + u + (this.fileKey ? (u.indexOf("?") >= 0 ? "&" : "?") + "k=" + encodeURIComponent(this.fileKey) : ""); },

  // Single sign-on happens in the phone's browser. The server sends us back to glimpse://auth with a code that only
  // works together with the secret made here.
  async sso(path) {
    ssoVerifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const ch = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ssoVerifier))));
    await Browser.open({ url: this.server + path + (path.indexOf("?") >= 0 ? "&" : "?") + "app=1&challenge=" + ch });
  },
  download(url) { Browser.open({ url }); },
  // A small buzz: "tap" for picking something, "success" when it's saved.
  haptic(kind) {
    if (!Capacitor.isNativePlatform()) return;
    (kind === "success" ? Haptics.notification({ type: NotificationType.Success }) : Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
  },

  // The phone's photo library and camera. Picked items are "phone files": { uri, name, type, size, taken, … }.
  media: !Capacitor.isNativePlatform() ? null : {
    access: () => Media.access().then((r) => r.access),
    requestAccess: () => Media.requestAccess().then((r) => r.access),
    openSettings: () => Media.openSettings(),
    list: (o) => Media.list(o).then((r) => r.items.map(phoneFile)),
    thumbs: (items, size) => Media.thumbnails({ items: items.map((i) => ({ id: i.id, uri: i.uri, kind: i.kind })), size: size || 256 })
      .then((r) => { const out = {}; Object.keys(r.paths).forEach((k) => { out[k] = Capacitor.convertFileSrc(r.paths[k]); }); return out; }),
    record: () => Media.record().then((r) => (r.cancelled ? null : phoneFile(r))),
    frames: (uri, times, width) => Media.frames({ uri, times, width }).then((r) => r.frames)
  },
  // A phone file as a link the page can play or show (served by MediaWebViewClient, with seeking).
  localUrl: (uri) => "/_glimpse_media_/?uri=" + encodeURIComponent(uri),

  // Uploads a phone file natively, so it keeps going in the background. Same shape as resumableUpload().
  upload(file, type, cb, resume) {
    cb = cb || {};
    let s = resume || null, cancelled = false;
    const call = async (path, opts) => {
      const r = await fetch(this.server + path, Object.assign({}, opts, { headers: Object.assign({}, this.headers(), (opts || {}).headers || {}) }));
      const b = await r.json().catch(() => null);
      if (!r.ok) { const e = new Error((b && b.error) || "Upload failed (" + r.status + ")"); e.status = r.status; throw e; }
      return b;
    };
    const promise = (async () => {
      if (!s) s = await call("/api/upload/media/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name || "upload", type, size: file.size }) });
      if (cb.onStart) cb.onStart({ uploadId: s.uploadId, mediaId: s.mediaId });
      let at = 0;
      if (resume) { const st = await call("/api/upload/media/session/" + encodeURIComponent(s.uploadId)); if (st.done) return st.mediaId; at = st.received; }
      if (cancelled) throw new Error("Upload cancelled.");
      return await new Promise((resolve, reject) => {
        watching[s.uploadId] = { cb, resolve, reject };
        Uploads.start({ uploadId: s.uploadId, uri: file.uri, size: file.size, offset: at, chunk: s.chunk || 5 * 1024 * 1024, server: this.server, token: this.token, name: file.name || "clip" })
          .catch((e) => { delete watching[s.uploadId]; reject(e); });
        askNotificationsOnce();
      });
    })();
    return { promise, cancel: () => { cancelled = true; if (s) Uploads.cancel({ uploadId: s.uploadId }).catch(() => {}); } };
  }
};
window.GlimpseApp = g;

// Picked from the phone: what the interface needs to trim it and upload it.
function phoneFile(i) {
  return { uri: i.uri, id: i.id, name: i.name || (i.kind === "video" ? "video.mp4" : "photo.jpg"), type: i.mime, size: i.size, taken: i.taken, duration: i.duration, width: i.width, height: i.height, kind: i.kind };
}

// The first background upload asks once to show notifications, so its progress can be seen outside the app.
async function askNotificationsOnce() {
  const k = await Preferences.get({ key: "askedNotifications" });
  if (k.value) return;
  await Preferences.set({ key: "askedNotifications", value: "1" });
  Uploads.askNotifications().catch(() => {});
}

// Native upload progress, passed on to whoever started each upload.
const watching = {};
if (g.native) {
  Uploads.addListener("upload", (e) => {
    const w = watching[e.uploadId];
    if (!w) return;
    if (e.state === "progress" && w.cb.onProgress) w.cb.onProgress(e.size ? (e.sending || e.received) / e.size : 0);
    else if (e.state === "waiting" && w.cb.onWaiting) w.cb.onWaiting(!!e.waiting);
    else if (e.state === "done") { delete watching[e.uploadId]; if (w.cb.onProgress) w.cb.onProgress(1); w.resolve(e.mediaId); }
    else if (e.state === "failed") { delete watching[e.uploadId]; w.reject(new Error(e.error || "Upload failed.")); }
  });
}

async function finishSso(url) {
  Browser.close().catch(() => {});
  const q = new URL(url.replace(/^glimpse:\/\//, "https://app/")).searchParams;
  const code = q.get("code");
  if (code && ssoVerifier) {
    try {
      const r = await fetch(g.server + "/api/auth/app-token", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, g.headers()), body: JSON.stringify({ code, verifier: ssoVerifier }) });
      const b = await r.json().catch(() => null);
      ssoVerifier = null;
      if (r.ok && b && b.token) { g.setToken(b.token); window.location.replace("/"); return; }
    } catch (e) { /* falls through to the sign-in screen */ }
  }
  window.location.replace("/login?error=" + encodeURIComponent(q.get("error") || "failed"));
}

if (g.native) {
  App.addListener("appUrlOpen", ({ url }) => { if (url.indexOf("glimpse://auth") === 0) finishSso(url); });
  // Android back: an open panel, sheet, gallery or player closes first (as Escape does); then one screen back, and
  // out of the app from the first one.
  // (The WebView's own canGoBack doesn't count the app's screens, so the interface decides through g.back.)
  const leave = () => { if (!(g.back && g.back())) App.exitApp(); };
  App.addListener("backButton", () => {
    const open = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    if (!open.length) { leave(); return; }
    const top = open[open.length - 1];
    const at = document.activeElement && top.contains(document.activeElement) ? document.activeElement : top;
    at.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
    // Anything that ignores Escape shouldn't trap the back button.
    setTimeout(() => { if (document.contains(top)) leave(); }, 250);
  });
}
export default g;
