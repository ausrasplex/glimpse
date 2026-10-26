// Resumable uploads for clips and photos. The file goes up in pieces; if the connection drops or the phone
// pauses the page, it waits and continues from the last piece the server has. The file and the capture draft
// are kept in IndexedDB while uploading, so a reloaded page can offer to carry on.
import { app, apiUrl, apiHeaders } from "./platform.js";

const req = async (path, opts) => {
  const o = Object.assign({ credentials: "same-origin" }, opts || {});
  o.headers = Object.assign({}, apiHeaders(), o.headers || {});
  const r = await fetch(apiUrl(path), o);
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  if (!r.ok) { const err = new Error((body && body.error) || "Upload failed (" + r.status + ")"); err.status = r.status; throw err; }
  return body;
};

// One piece through XHR, for progress events.
function putPiece(uploadId, offset, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", apiUrl("/api/upload/media/session/" + encodeURIComponent(uploadId)));
    const h = apiHeaders();
    Object.keys(h).forEach((k) => x.setRequestHeader(k, h[k]));
    x.setRequestHeader("X-Offset", String(offset));
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let b = null; try { b = JSON.parse(x.responseText); } catch (e) { b = null; }
      if (x.status >= 200 && x.status < 300) resolve(b);
      else { const err = new Error((b && b.error) || "Upload failed (" + x.status + ")"); err.status = x.status; reject(err); }
    };
    x.onerror = x.ontimeout = () => reject(new Error("offline"));
    x.timeout = 120000;
    x.send(blob);
  });
}

// Waits `ms`, or less if the connection comes back or the page becomes visible again.
function pause(ms) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); window.removeEventListener("online", done); document.removeEventListener("visibilitychange", vis); resolve(); };
    const vis = () => { if (!document.hidden) done(); };
    const t = setTimeout(done, ms);
    window.addEventListener("online", done);
    document.addEventListener("visibilitychange", vis);
  });
}

// Keep the screen on while an upload runs in the foreground (ignored where unsupported).
const awake = { lock: null, count: 0 };
async function grabLock() { try { if (awake.count && !awake.lock && !document.hidden && navigator.wakeLock) { awake.lock = await navigator.wakeLock.request("screen"); awake.lock.addEventListener("release", () => { awake.lock = null; }); } } catch (e) { /* not allowed */ } }
if (typeof document !== "undefined") document.addEventListener("visibilitychange", grabLock);
const holdAwake = () => { awake.count++; grabLock(); };
const letSleep = () => { awake.count = Math.max(0, awake.count - 1); if (!awake.count && awake.lock) { awake.lock.release().catch(() => {}); awake.lock = null; } };

/**
 * Upload `file` as `type`. Resumes `resume.uploadId` when given.
 * Callbacks: onStart({ uploadId, mediaId }), onProgress(0..1), onWaiting(bool) while waiting for a connection.
 * Returns { promise (resolves to the media id), cancel }.
 */
export function resumableUpload(file, type, cb, resume) {
  // In the app, a file from the phone's gallery or camera uploads natively and keeps going in the background.
  if (file && file.uri && app && app.upload) return app.upload(file, type, cb, resume);
  cb = cb || {};
  let cancelled = false;
  const run = async () => {
    holdAwake();
    try {
      let s = resume;
      if (!s) {
        s = await req("/api/upload/media/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name || "upload", type, size: file.size }) });
      }
      if (cb.onStart) cb.onStart({ uploadId: s.uploadId, mediaId: s.mediaId });
      const chunk = s.chunk || 5 * 1024 * 1024;
      let at = 0, fails = 0;
      if (resume) { const st = await req("/api/upload/media/session/" + encodeURIComponent(s.uploadId)); if (st.done) return st.mediaId; at = st.received; }
      while (true) {
        if (cancelled) throw new Error("Upload cancelled.");
        const end = Math.min(file.size, at + chunk);
        try {
          const r = await putPiece(s.uploadId, at, file.slice(at, end), (p) => cb.onProgress && cb.onProgress((at + p * (end - at)) / file.size));
          if (fails && cb.onWaiting) cb.onWaiting(false);
          fails = 0;
          if (r.done) { if (cb.onProgress) cb.onProgress(1); return r.mediaId; }
          at = r.received;
          if (cb.onProgress) cb.onProgress(at / file.size);
        } catch (e) {
          // A refusal from the server is final; anything else is a connection problem worth waiting out.
          if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
          fails++;
          if (cb.onWaiting) cb.onWaiting(true);
          await pause(Math.min(30000, 1000 * Math.pow(2, Math.min(fails, 5))));
          try { const st = await req("/api/upload/media/session/" + encodeURIComponent(s.uploadId)); if (st.done) return st.mediaId; at = st.received; }
          catch (e2) { if (e2.status === 404) throw new Error("This upload expired. Choose the file again."); }
        }
      }
    } finally { letSleep(); }
  };
  return { promise: run(), cancel: () => { cancelled = true; } };
}

// ---------- Saved uploads (IndexedDB) ----------
const DB_NAME = "glimpse-uploads", STORE = "pending";
const KEEP_FILE_MAX = 1024 * 1024 * 1024; // larger files are too big to copy into browser storage
function idb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "uploadId" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  try {
    const d = await idb();
    return await new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && out.result);
      t.onerror = () => reject(t.error);
    });
  } catch (e) { return null; }
}
export const savePending = (rec) => tx("readwrite", (s) => s.put(Object.assign({ at: Date.now() }, rec, { file: rec.file && (rec.file.uri || rec.file.size <= KEEP_FILE_MAX) ? rec.file : null })));
export async function updatePending(uploadId, patch) {
  const cur = await tx("readonly", (s) => s.get(uploadId));
  if (cur) await tx("readwrite", (s) => s.put(Object.assign(cur, patch)));
}
export const clearPending = (uploadId) => tx("readwrite", (s) => s.delete(uploadId));
// The newest saved upload from the last day, if any (older ones are cleared: the server forgets them too).
export async function latestPending() {
  const all = (await tx("readonly", (s) => s.getAll())) || [];
  const day = Date.now() - 24 * 3600e3;
  for (const r of all) if (r.at < day) await clearPending(r.uploadId);
  return all.filter((r) => r.at >= day && r.draft).sort((a, b) => b.at - a.at)[0] || null;
}
// What the server has of an upload, or null if it's gone.
export async function uploadState(uploadId) {
  try { return await req("/api/upload/media/session/" + encodeURIComponent(uploadId)); } catch (e) { return null; }
}
