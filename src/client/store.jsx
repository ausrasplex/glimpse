"use client";
import React from "react";
import { GRADS } from "./util.js";
import * as S from "./sel.js";

const { createContext, useContext, useState, useEffect, useRef, useCallback } = React;
const Ctx = createContext(null);

// Object URLs for files picked this session, so trimming can start before the upload finishes.
export const live = { video: {}, audio: {} };

// ---------- Server calls ----------
export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ credentials: "same-origin" }, opts || {}));
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  if (!r.ok) { const err = new Error((body && body.error) || "Couldn't reach the server. Check your connection."); err.status = r.status; throw err; }
  return body;
}
export const post = (path, data) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });

// Upload a file with progress. Returns the server's JSON.
export function upload(path, file, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", path);
    Object.keys(headers || {}).forEach((k) => x.setRequestHeader(k, headers[k]));
    x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.setRequestHeader("X-File-Name", encodeURIComponent(file.name || "upload"));
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => { let b = null; try { b = JSON.parse(x.responseText); } catch (e) { b = null; } if (x.status >= 200 && x.status < 300) resolve(b); else reject(new Error((b && b.error) || "Upload failed (" + x.status + ")")); };
    x.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    x.send(file);
  });
}

// ---------- URL <-> screen ----------
const PATHS = { home: "/", login: "/login", setup: "/setup" };
export function pathFor(name, params) {
  if (name === "signup" && params && params.token) return "/invite/" + encodeURIComponent(params.token);
  if (name === "reset" && params && params.token) return "/reset/" + encodeURIComponent(params.token);
  const base = PATHS[name] || "/" + name;
  const q = Object.keys(params || {}).filter((k) => params[k] !== undefined && params[k] !== null && typeof params[k] !== "object").map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k])).join("&");
  return base + (q ? "?" + q : "");
}
export function parseLocation() {
  if (typeof window === "undefined") return { name: "home", params: {} };
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = {};
  new URLSearchParams(window.location.search).forEach((v, k) => { params[k] = v; });
  let m;
  if ((m = path.match(/^\/invite\/([^/]+)$/))) return { name: "signup", params: { token: decodeURIComponent(m[1]) } };
  if ((m = path.match(/^\/reset\/([^/]+)$/))) return { name: "reset", params: { token: decodeURIComponent(m[1]) } };
  if (path === "/") return { name: "home", params };
  return { name: path.slice(1).split("/")[0], params };
}

function normalize(d) {
  if (!d) return d;
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  d.media.forEach((m) => { m.grad = GRADS[hash(m.id) % GRADS.length]; });
  d.tracks.forEach((t) => { if (!t.bpm) t.bpm = t.detectedBpm || 96; if (!t.duration) t.duration = 1; });
  return d;
}

export function AppProvider({ initial, children }) {
  const [db, setDb] = useState(() => normalize(initial));
  const [stack, setStack] = useState(() => [parseLocation()]);
  const [toastState, setToast] = useState(null);
  const [draft, setDraft] = useState(null);
  const [mashDraft, setMashDraft] = useState(null);
  const toastTimer = useRef(null);
  const dbRef = useRef(db); dbRef.current = db;

  const toast = useCallback((text, action, kind) => {
    clearTimeout(toastTimer.current);
    setToast({ text, action, kind, id: Date.now() });
    // Radix Toast handles the timer (and pauses it while hovered or focused).
  }, []);

  const refresh = useCallback(async () => {
    try { const d = await api("/api/bootstrap"); setDb(normalize(d)); return d; }
    catch (e) {
      if (e.status === 401) { try { const p = await api("/api/public"); setDb(normalize(p)); } catch (e2) { /* offline */ } }
      return null;
    }
  }, []);

  // Run a server action, then reload the data. Errors show as a toast and are re-thrown.
  const act = useCallback(async (type, args, opts) => {
    try {
      const r = await post("/api/act", { type, args: args || {} });
      if (!(opts && opts.noRefresh)) await refresh();
      return r && r.result;
    } catch (e) {
      if (!(opts && opts.quiet)) toast(e.message, null, "warn");
      throw e;
    }
  }, [refresh, toast]);

  // Optimistic local change (applied now), then a debounced save to the server.
  const local = useCallback((fn) => setDb((prev) => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next; }), []);
  const timers = useRef({});
  const actSoon = useCallback((key, type, args, ms) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { act(type, args, { noRefresh: true }).catch(() => refresh()); }, ms || 600);
  }, [act, refresh]);

  // Browser history mirrors the screen stack.
  const push = (s) => { try { window.history.pushState({ g: 1 }, "", pathFor(s.name, s.params)); } catch (e) { /* ignore */ } };
  const repl = (s) => { try { window.history.replaceState({ g: 1 }, "", pathFor(s.name, s.params)); } catch (e) { /* ignore */ } };
  useEffect(() => {
    const onPop = () => {
      const loc = parseLocation();
      setStack((s) => {
        const i = s.map((x) => pathFor(x.name, x.params)).lastIndexOf(pathFor(loc.name, loc.params));
        return i >= 0 ? s.slice(0, i + 1) : [loc];
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const nav = {
    go: (name, params) => { const s = { name, params: params || {} }; push(s); setStack((st) => st.concat([s])); },
    replace: (name, params) => { const s = { name, params: params || {} }; repl(s); setStack((st) => st.slice(0, -1).concat([s])); },
    back: () => { if (stack.length > 1) { window.history.back(); } else { const s = { name: "home", params: {} }; repl(s); setStack([s]); } },
    reset: (name, params) => { const s = { name, params: params || {} }; repl(s); setStack([s]); },
    backTo: (name) => {
      const i = stack.map((x) => x.name).lastIndexOf(name);
      if (i >= 0) { const steps = stack.length - 1 - i; if (steps > 0) window.history.go(-steps); }
      else { const s = { name, params: {} }; repl(s); setStack([s]); }
    },
    current: stack[stack.length - 1],
    depth: stack.length
  };

  // While uploads, conversions or renders are running, keep the data fresh.
  useEffect(() => {
    const t = setInterval(() => {
      const d = dbRef.current;
      if (!d || document.hidden) return;
      const busy = d.mashes.some((m) => m.status === "rendering" || m.status === "queued") || d.media.some((m) => m.status === "PROCESSING" || m.status === "UPLOADING") || d.tracks.some((t) => t.status === "processing");
      if (busy) refresh().then((nd) => {
        if (!nd) return;
        nd.mashes.forEach((m) => {
          const was = d.mashes.find((x) => x.id === m.id);
          if (was && was.status !== "ready" && m.status === "ready" && m.ownerId === nd.session.userId) toast("“" + m.title + "” is ready to watch");
          if (was && was.status !== "failed" && m.status === "failed" && m.ownerId === nd.session.userId) toast("“" + m.title + "” couldn't be rendered", null, "warn");
        });
      });
    }, 2500);
    const slow = setInterval(() => { if (dbRef.current && !document.hidden) refresh(); }, 60000);
    return () => { clearInterval(t); clearInterval(slow); };
  }, [refresh, toast]);

  const meUser = db ? S.me(db) : null;
  const accent = meUser ? S.prefs(db, meUser.id).accent : "#E8A33D";
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    const n = parseInt(accent.slice(1), 16);
    document.documentElement.style.setProperty("--accent-soft", "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + ",0.14)");
  }, [accent]);

  const value = { db, setDb, refresh, act, local, actSoon, nav, toast, toastState, setToast, me: meUser, draft, setDraft, mashDraft, setMashDraft, accent };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
