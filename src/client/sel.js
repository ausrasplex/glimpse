import { todayKey, addDays, diffDays, uid } from "./util.js";

// Read helpers over the shared data. Nothing here mutates.
export const user = (db, id) => db.users.find((u) => u.id === id);
export const me = (db) => user(db, db.session.userId);
export const firstName = (u) => (u ? u.name.split(" ")[0] : "");
export const initial = (u) => (u ? (u.name || u.email || "?").trim().charAt(0).toUpperCase() : "?");
export const isAdmin = (db, id) => { const u = user(db, id); return !!u && u.role === "ADMIN"; };
const PREF_DEFAULTS = { accent: "#E8A33D", badge: "dot", milestones: true, fill: "blur", onThisDay: true };
export const prefs = (db, id) => Object.assign({}, PREF_DEFAULTS, (db.prefs && db.prefs[id]) || {});

export const project = (db, id) => db.projects.find((p) => p.id === id);
export const membership = (db, pid, userId) => db.members.find((m) => m.projectId === pid && m.userId === userId && m.status === "ACTIVE");
export const activeMembers = (db, pid) => db.members.filter((m) => m.projectId === pid && m.status === "ACTIVE");
export const pendingMembers = (db, pid) => db.members.filter((m) => m.projectId === pid && m.status === "INVITED");
export const category = (db, id) => db.categories.find((c) => c.id === id);
export const userCategories = (db, userId) => db.categories.filter((c) => c.userId === userId);
export const projectEntries = (db, pid) => db.entries.filter((e) => e.projectId === pid);
export const media = (db, id) => db.media.find((m) => m.id === id);
export const entry = (db, id) => db.entries.find((e) => e.id === id);
export const track = (db, id) => db.tracks.find((t) => t.id === id);
export const mash = (db, id) => db.mashes.find((m) => m.id === id);

export function isDailyFor(db, pid, userId) {
  const m = membership(db, pid, userId);
  const c = m && category(db, m.categoryId);
  return !!(c && c.daily);
}

// Streaks count a day if anyone in the project filmed it. Still alive until midnight if today is empty.
export function streak(db, pid) {
  const days = new Set(projectEntries(db, pid).map((e) => e.date));
  const t = todayKey();
  let k = days.has(t) ? t : addDays(t, -1);
  let n = 0;
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

export function lastActivity(db, pid) {
  let last = 0;
  projectEntries(db, pid).forEach((e) => { if (e.createdAt > last) last = e.createdAt; });
  return last || (project(db, pid) || {}).createdAt || 0;
}

export function coverOf(db, pid) {
  const p = project(db, pid);
  if (p && p.cover) { const m = media(db, p.cover); if (m) return m; }
  const es = projectEntries(db, pid).slice().sort((a, b) => b.createdAt - a.createdAt);
  return es.length ? media(db, es[0].mediaId) : null;
}

// Projects the user can see, with their own category, pin and archive state.
export function myProjects(db, userId, opts) {
  opts = opts || {};
  return db.members.filter((m) => m.userId === userId && m.status === "ACTIVE" && (opts.archived ? m.archived : !m.archived)).map((m) => {
    const p = project(db, m.projectId);
    if (!p) return null;
    const cat = category(db, m.categoryId) || { name: "Freestyle", color: "#5BA3A0", daily: false };
    const count = projectEntries(db, p.id).length;
    const others = activeMembers(db, p.id);
    return { p, m, cat, count, members: others, shared: others.length > 1, streak: cat.daily ? streak(db, p.id) : 0, last: lastActivity(db, p.id), cover: coverOf(db, p.id) };
  }).filter(Boolean);
}
export const sortProjects = (list) => list.slice().sort((a, b) => (b.m.pinned - a.m.pinned) || (b.last - a.last));

export function moodColor(db, ownerId, label) {
  if (!label) return null;
  const list = db.moods[ownerId] || [];
  const m = list.find((x) => x.label.toLowerCase() === String(label).toLowerCase());
  return m ? m.color : "#8C96A3";
}

// The section of the clip used in this project (project override wins).
export function clipOf(db, e) {
  const m = media(db, e.mediaId) || { clipStart: 0, clipEnd: 1, duration: 1, grad: "" };
  const start = e.trim ? e.trim.start : m.clipStart;
  const end = e.trim ? e.trim.end : m.clipEnd;
  return { m, start, end, len: +(end - start).toFixed(1) };
}

export const unreadCount = (db, userId) => db.notifications.filter((n) => n.userId === userId && !n.read).length;

export function usage(db, userId) {
  const clips = db.media.filter((m) => m.ownerId === userId).reduce((a, m) => a + (m.size || 0), 0);
  const mashes = db.mashes.filter((m) => m.ownerId === userId && m.status === "ready").reduce((a, m) => a + mashSize(m), 0);
  const music = db.tracks.filter((t) => t.addedBy === userId).reduce((a, t) => a + (t.size || 0), 0);
  return { clips, mashes, music, total: clips + mashes + music };
}
export const mashSize = (m) => m.size || 0;

export function mashLength(db, m) {
  const es = m.entryIds.map((id) => entry(db, id)).filter(Boolean);
  if (m.clipMode === "cap") return es.length * m.cap;
  if (m.sync === "fixed" && m.tracks.length && m.audio !== "clips") { const t = track(db, m.tracks[0].trackId); return es.length * m.beats * 60 / ((t && t.bpm) || 96); }
  return es.reduce((a, e) => a + clipOf(db, e).len, 0);
}

export function canEditEntry(db, e, userId) { return e.authorId === userId; }
export function isOwner(db, pid, userId) { const m = membership(db, pid, userId); return !!m && m.role === "OWNER"; }

// Mash date ranges.
export function rangeFor(id, custom) {
  const t = todayKey();
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const key = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  if (id === "this") return { from: key(first), to: t };
  if (id === "last") { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); const b = new Date(d.getFullYear(), d.getMonth(), 0); return { from: key(a), to: key(b) }; }
  if (id === "week") return { from: addDays(t, -7), to: t };
  if (id === "year") return { from: addDays(t, -365), to: t };
  if (id === "all") return { from: "2000-01-01", to: t };
  return custom || { from: addDays(t, -30), to: t };
}

export function entriesInRange(db, pid, from, to, memberId) {
  return projectEntries(db, pid).filter((e) => e.date >= from && e.date <= to && (!memberId || e.authorId === memberId)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
}

export function missedDays(db, pid, from, to) {
  const days = new Set(projectEntries(db, pid).map((e) => e.date));
  const first = projectEntries(db, pid).reduce((a, e) => (a && a < e.date ? a : e.date), null);
  if (!first) return [];
  let k = from < first ? first : from;
  const end = to > todayKey() ? todayKey() : to;
  const out = [];
  let guard = 0;
  while (k <= end && guard++ < 800) { if (!days.has(k) && k !== todayKey()) out.push(k); k = addDays(k, 1); }
  return out;
}

export { uid, diffDays };
