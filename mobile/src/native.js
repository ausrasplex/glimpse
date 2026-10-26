// The bridge between the Glimpse interface and the phone. Sets window.GlimpseApp, which ../../src/client/platform.js
// looks for: in a browser it's missing and the interface behaves as the website does.
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Clipboard } from "@capacitor/clipboard";
import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";

// Glimpse's own native pieces (android/app/src/main/java/app/glimpse/mobile).
const Media = registerPlugin("GlimpseMedia");
const Uploads = registerPlugin("GlimpseUploads");
const Update = registerPlugin("GlimpseUpdate");

// App releases on GitHub: tagged app-vX.Y.Z, each with the APK and its .sha256 (see .github/workflows/android.yml).
const RELEASES = "https://api.github.com/repos/ausrasplex/glimpse/releases?per_page=30";
const verParts = (v) => String(v || "0").replace(/^app-v|^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const DAY = 22 * 3600e3;

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
    if (!t) { this.fileKey = null; reminders.clear(); }
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
  openAppSettings: () => Media.openSettings(),
  copy(text) { return Clipboard.write({ string: text }); },

  // Daily reminders as phone notifications (see reminders below).
  reminders: null,
  // Save a finished mash to the phone's gallery, or share it. Downloads it first, with progress 0..1.
  mash: !Capacitor.isNativePlatform() ? null : {
    async save(url, title, onProgress) { const path = await fetchVideo(url, title, onProgress); await Media.saveToGallery({ path, name: fileName(title) }); },
    async share(url, title, onProgress) { const path = await fetchVideo(url, title, onProgress); await Share.share({ title, files: ["file://" + path], dialogTitle: "Share " + title }); }
  },
  // A glimpse:// link to join a server: { server, token } for start-up (mobile/src/boot.jsx) to act on.
  takeInvite: async () => { const v = (await Preferences.get({ key: "pendingInvite" })).value; if (v) await Preferences.remove({ key: "pendingInvite" }); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } },

  // Updates from GitHub Releases. A release looks like { version, notes, url, sha256, size, page }.
  updates: {
    // The newest app release, or null if there isn't one. Asked by Android itself: GitHub's files don't allow pages to fetch them.
    async latest() {
      let r;
      try { r = await CapacitorHttp.get({ url: RELEASES, headers: { Accept: "application/vnd.github+json" }, responseType: "json" }); }
      catch (e) { throw new Error("Couldn't reach GitHub. Check your connection."); }
      if (r.status === 403 || r.status === 429) throw new Error("GitHub is limiting update checks right now. Try again in an hour.");
      if (r.status !== 200) throw new Error("GitHub answered " + r.status + ". Try again later.");
      const list = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      const rel = (list || []).find((x) => !x.draft && !x.prerelease && /^app-v\d+\.\d+\.\d+$/.test(x.tag_name));
      const apk = rel && rel.assets.find((a) => /\.apk$/.test(a.name));
      if (!apk) return null;
      const sum = rel.assets.find((a) => /\.sha256$/.test(a.name));
      let sha256 = "";
      if (sum) {
        try { const s = await CapacitorHttp.get({ url: sum.browser_download_url, responseType: "text" }); sha256 = ((String(s.data).match(/[0-9a-f]{64}/i) || [])[0] || "").toLowerCase(); } catch (e) { sha256 = ""; }
      }
      const out = { version: rel.tag_name.replace(/^app-v/, ""), notes: rel.body || "", url: apk.browser_download_url, sha256, size: apk.size, page: rel.html_url };
      await Preferences.set({ key: "updateLatest", value: JSON.stringify(out) });
      await Preferences.set({ key: "updateCheckedAt", value: String(Date.now()) });
      return out;
    },
    isNewer: (rel) => !!rel && newer(rel.version, g.version),
    // Once a day at most (unless turned off): a newer release, or null.
    async daily() {
      if ((await Preferences.get({ key: "updateChecks" })).value === "off") return null;
      const at = Number((await Preferences.get({ key: "updateCheckedAt" })).value || 0);
      let rel = null;
      if (Date.now() - at < DAY) { try { rel = JSON.parse((await Preferences.get({ key: "updateLatest" })).value || "null"); } catch (e) { rel = null; } }
      else { try { rel = await this.latest(); } catch (e) { return null; } }
      return rel && newer(rel.version, g.version) ? rel : null;
    },
    async dailyOn() { return (await Preferences.get({ key: "updateChecks" })).value !== "off"; },
    setDaily: (on) => Preferences.set({ key: "updateChecks", value: on ? "on" : "off" }),
    canInstall: () => Update.canInstall().then((r) => r.allowed),
    openInstallSettings: () => Update.openInstallSettings(),
    // Download (with progress 0..1), check the checksum, then open Android's installer.
    async install(rel, onProgress) {
      const sub = await Update.addListener("progress", (p) => { if (onProgress && p.total > 0) onProgress(p.received / p.total); });
      try {
        const { path } = await Update.download({ url: rel.url, sha256: rel.sha256, version: rel.version });
        if (onProgress) onProgress(1);
        await Update.install({ path });
      } finally { sub.remove(); }
    },
    openPage: (rel) => Browser.open({ url: rel.page })
  },
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

// ---------- Mashes ----------
const fileName = (title) => (String(title || "Glimpse").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Glimpse") + ".mp4";
async function fetchVideo(url, title, onProgress) {
  const sub = await Media.addListener("download", (p) => { if (onProgress && p.total > 0) onProgress(p.received / p.total); });
  try { return (await Media.fetchToCache({ url, name: fileName(title) })).path; } finally { sub.remove(); }
}

// ---------- Reminders ----------
// The phone schedules the next two weeks of each reminder that's on and set to "in-app", so they arrive even when the
// server or the connection is down. Redone whenever the data changes; "only if I haven't filmed" skips today once
// you have. Tapping one opens capture.
const reminders = {
  last: "",
  permission: () => (g.native ? LocalNotifications.checkPermissions().then((r) => r.display) : Promise.resolve("denied")),
  ask: () => LocalNotifications.requestPermissions().then((r) => r.display),
  async clear() {
    reminders.last = "";
    if (!g.native) return;
    const p = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
    if (p.notifications.length) await LocalNotifications.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) }).catch(() => {});
  },
  async sync(list, filmedToday) {
    if (!g.native) return;
    const now = new Date();
    const plan = [];
    for (const r of list || []) {
      if (!r.on || !r.inapp || !/^\d{2}:\d{2}$/.test(r.time)) continue;
      const [hh, mm] = r.time.split(":").map(Number);
      for (let d = 0; d < 14; d++) {
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hh, mm, 0, 0);
        if (at <= now) continue;
        if (!(r.days || [])[(at.getDay() + 6) % 7]) continue;
        if (d === 0 && r.rule === "check" && filmedToday) continue;
        plan.push({ r, at });
      }
    }
    const key = plan.map((p) => p.r.id + "@" + p.at.getTime() + ":" + p.r.message).join("|");
    if (key === reminders.last) return;
    if ((await reminders.permission()) !== "granted") return;
    reminders.last = key;
    await reminders.clear();
    reminders.last = key;
    if (!plan.length) return;
    await LocalNotifications.createChannel({ id: "reminders", name: "Daily reminders", description: "Your Glimpse reminders", importance: 4 }).catch(() => {});
    const id = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 2000000000; };
    await LocalNotifications.schedule({
      notifications: plan.map((p) => ({
        id: id(p.r.id + p.at.toDateString()), channelId: "reminders",
        title: p.r.message, body: p.r.rule === "check" ? "No glimpse yet today. Tap to film one." : "Tap to film today's glimpse.",
        schedule: { at: p.at, allowWhileIdle: true }, extra: { route: "capture" }
      }))
    }).catch(() => { reminders.last = ""; });
  }
};
g.reminders = reminders;
if (g.native) {
  // A reminder tapped: the interface opens capture (g.openCapture is set by the interface once it's running).
  LocalNotifications.addListener("localNotificationActionPerformed", (e) => {
    if (!e.notification || !e.notification.extra || e.notification.extra.route !== "capture") return;
    if (g.openCapture) g.openCapture(); else g.pendingCapture = true;
  });
}

// ---------- Invite links ----------
// glimpse://invite?server=https://…&token=… (from the invite page's "Open in the Glimpse app" button).
async function openInvite(url) {
  const q = new URL(url.replace(/^glimpse:\/\//, "https://app/")).searchParams;
  const server = q.get("server"), token = q.get("token");
  if (!server || !/^https?:\/\/[^/]+$/.test(server) || !token || !/^[\w-]+$/.test(token)) return;
  await Preferences.set({ key: "pendingInvite", value: JSON.stringify({ server, token }) });
  window.location.replace("/");
}

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
  App.addListener("appUrlOpen", ({ url }) => {
    if (url.indexOf("glimpse://auth") === 0) finishSso(url);
    else if (url.indexOf("glimpse://invite") === 0) openInvite(url);
  });
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
// Opened from a link while the app wasn't running.
export async function launchLink() {
  if (!g.native) return;
  const l = await App.getLaunchUrl().catch(() => null);
  if (l && l.url && l.url.indexOf("glimpse://invite") === 0 && !sessionStorage.getItem("launch:" + l.url)) {
    sessionStorage.setItem("launch:" + l.url, "1");
    const q = new URL(l.url.replace(/^glimpse:\/\//, "https://app/")).searchParams;
    if (q.get("server") && q.get("token")) await Preferences.set({ key: "pendingInvite", value: JSON.stringify({ server: q.get("server"), token: q.get("token") }) });
  }
}
export default g;
