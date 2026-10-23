import { and, eq, inArray } from "drizzle-orm";
import { schema } from "../db";
import { id } from "../ids";
import { fail, notifyAdmins, requireMember } from "../core";
import { str, bool, num } from "../http";
import { enqueue } from "../queue";
import { STAMP_DEFAULT, QUALITIES, type MashSettings, type Quality } from "../../shared/mash";
import type { Action } from "./types";

const pickOne = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

function cleanSettings(raw: Record<string, unknown>, defaultQuality: Quality): MashSettings {
  const st = (raw.stamp || {}) as Record<string, unknown>;
  const tracks = Array.isArray(raw.tracks) ? raw.tracks.slice(0, 8).map((t) => {
    const x = (t || {}) as Record<string, unknown>;
    return { trackId: str(x.trackId, 60), start: num(x.start, 0, 3600, 0), fadeIn: num(x.fadeIn, 0, 10, 0), fadeOut: num(x.fadeOut, 0, 10, 2) };
  }).filter((t) => t.trackId) : [];
  return {
    shape: pickOne(raw.shape, ["portrait", "landscape", "square"] as const, "portrait"),
    fill: pickOne(raw.fill, ["blur", "crop", "bars"] as const, "blur"),
    clipMode: pickOne(raw.clipMode, ["trimmed", "cap"] as const, "trimmed"),
    cap: num(raw.cap, 0.5, 10, 1),
    stamp: {
      on: st.on !== false, show: pickOne(st.show, ["date", "dateNote", "day"] as const, STAMP_DEFAULT.show), format: pickOne(st.format, ["short", "long", "num"] as const, "short"),
      pos: pickOne(st.pos, ["tl", "tr", "bl", "br"] as const, "tr"), style: pickOne(st.style, ["pill", "plain", "bold"] as const, "pill"), size: pickOne(st.size, ["s", "m", "l"] as const, "m")
    },
    tracks, crossfade: num(raw.crossfade, 0, 8, 2), whenEnds: pickOne(raw.whenEnds, ["loop", "fade"] as const, "loop"),
    audio: pickOne(raw.audio, ["both", "music", "clips"] as const, "both"), level: num(raw.level, 0, 100, 40),
    sync: pickOne(raw.sync, ["off", "auto", "fixed"] as const, "off"), beats: Math.round(num(raw.beats, 1, 8, 1)),
    stretch: raw.stretch !== false, musicLabel: raw.musicLabel !== false,
    quality: pickOne(raw.quality, QUALITIES, defaultQuality)
  };
}

export const createMash: Action = async ({ db, user, settings: server }, a) => {
  const pid = str(a.projectId, 60);
  await requireMember(db, pid, user.id);
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, pid) });
  const ids = Array.isArray(a.entryIds) ? [...new Set(a.entryIds.map((x) => str(x, 60)))].slice(0, 5000) : [];
  if (!ids.length) fail(400, "There are no clips to mash in that range.");
  const rows = await db.select({ id: schema.entries.id, date: schema.entries.date, createdAt: schema.entries.createdAt }).from(schema.entries).where(and(eq(schema.entries.projectId, pid), inArray(schema.entries.id, ids)));
  // Mashes always play oldest to newest, whatever order the client sent.
  const entryIds = rows.sort((x, y) => String(x.date).localeCompare(String(y.date)) || +new Date(x.createdAt) - +new Date(y.createdAt)).map((r) => r.id);
  if (!entryIds.length) fail(400, "Those clips aren't in this project any more.");
  const settings = cleanSettings((a.settings || {}) as Record<string, unknown>, server.mashQuality || "high");
  if (settings.tracks.length) {
    const ts = await db.select({ id: schema.tracks.id }).from(schema.tracks).where(and(inArray(schema.tracks.id, settings.tracks.map((t) => t.trackId)), eq(schema.tracks.status, "ready")));
    settings.tracks = settings.tracks.filter((t) => ts.find((x) => x.id === t.trackId));
  }
  const title = str(a.title, 60).trim() || "Mash";
  const mid = id("ms_");
  const custom = a.custom && typeof a.custom === "object" ? { from: str((a.custom as Record<string, unknown>).from, 10), to: str((a.custom as Record<string, unknown>).to, 10) } : null;
  await db.insert(schema.mashes).values({
    id: mid, ownerId: user.id, projectId: pid, projectName: p!.name, memberId: str(a.memberId, 60) || null, title, defaultTitle: str(a.defaultTitle, 80) || title,
    range: str(a.range, 10) || "custom", custom, entryIds, settings, shared: bool(a.shared), status: "queued", remashOf: str(a.remashOf, 60) || null
  });
  const excluded = a.excluded && typeof a.excluded === "object" ? Object.fromEntries(Object.entries(a.excluded as Record<string, unknown>).slice(0, 5000).filter(([, v]) => v === true)) : {};
  await db.insert(schema.mashPicks).values({ userId: user.id, projectId: pid, excluded }).onConflictDoUpdate({ target: [schema.mashPicks.userId, schema.mashPicks.projectId], set: { excluded } });
  await enqueue.renderMash(mid);
  return { mashId: mid };
};

async function myMash(db: Parameters<Action>[0]["db"], mashId: string, userId: string) {
  const m = await db.query.mashes.findFirst({ where: eq(schema.mashes.id, mashId) });
  if (!m || m.ownerId !== userId) fail(404, "That mash wasn't found.");
  return m!;
}

export const renameMash: Action = async ({ db, user }, a) => {
  const m = await myMash(db, str(a.mashId, 60), user.id);
  const title = str(a.title, 60).trim();
  if (!title) fail(400, "The name can't be empty.");
  await db.update(schema.mashes).set({ title }).where(eq(schema.mashes.id, m.id));
};
export const setMashShared: Action = async ({ db, user }, a) => {
  const m = await myMash(db, str(a.mashId, 60), user.id);
  if (!m.projectId) fail(400, "This mash's project was deleted, so it can't be shared.");
  await db.update(schema.mashes).set({ shared: bool(a.shared) }).where(eq(schema.mashes.id, m.id));
};
export const deleteMash: Action = async ({ db, user }, a) => {
  const m = await db.query.mashes.findFirst({ where: eq(schema.mashes.id, str(a.mashId, 60)) });
  if (!m) return;
  if (m.ownerId !== user.id && user.role !== "ADMIN") fail(404, "That mash wasn't found.");
  await db.delete(schema.mashes).where(eq(schema.mashes.id, m.id));
  await enqueue.deleteObjects([m.outputKey, m.posterKey].filter((k): k is string => !!k));
};
export const retryMash: Action = async ({ db, user }, a) => {
  const m = await myMash(db, str(a.mashId, 60), user.id);
  if (m.status !== "failed") return;
  await db.update(schema.mashes).set({ status: "queued", progress: 0, error: null }).where(eq(schema.mashes.id, m.id));
  await enqueue.renderMash(m.id);
};

// ---------- Music library ----------
export const updateTrack: Action = async ({ db, user }, a) => {
  const t = await db.query.tracks.findFirst({ where: eq(schema.tracks.id, str(a.trackId, 60)) });
  if (!t) fail(404, "That track wasn't found.");
  if (t!.addedBy !== user.id && user.role !== "ADMIN") fail(403, "Only the person who added it, or an admin, can edit this track.");
  const bpm = typeof a.bpm === "number" && a.bpm > 30 && a.bpm < 260 ? Math.round(a.bpm * 10) / 10 : t!.bpm;
  await db.update(schema.tracks).set({ title: str(a.title, 120).trim() || t!.title, artist: str(a.artist, 120).trim(), bpm }).where(eq(schema.tracks.id, t!.id));
};
export const deleteTrack: Action = async ({ db, user }, a) => {
  const t = await db.query.tracks.findFirst({ where: eq(schema.tracks.id, str(a.trackId, 60)) });
  if (!t) return;
  // Uploaders can withdraw a track they just added; otherwise only admins delete.
  const fresh = t.addedBy === user.id && Date.now() - t.addedAt.getTime() < 3600e3;
  if (user.role !== "ADMIN" && !fresh) fail(403, "Only admins can delete tracks. Ask for removal instead.");
  await db.update(schema.removalRequests).set({ status: "approved" }).where(eq(schema.removalRequests.trackId, t.id));
  await db.delete(schema.tracks).where(eq(schema.tracks.id, t.id));
  await enqueue.deleteObjects([], [`tracks/${t.id}/`]);
};
export const requestTrackRemoval: Action = async ({ db, user }, a) => {
  const t = await db.query.tracks.findFirst({ where: eq(schema.tracks.id, str(a.trackId, 60)) });
  if (!t) fail(404, "That track wasn't found.");
  const open = await db.query.removalRequests.findFirst({ where: and(eq(schema.removalRequests.trackId, t!.id), eq(schema.removalRequests.status, "open")) });
  if (open) return;
  const reason = str(a.reason, 300).trim();
  await db.insert(schema.removalRequests).values({ id: id("rr_"), trackId: t!.id, userId: user.id, reason });
  await notifyAdmins(db, { type: "TRACK_REMOVAL_REQUEST", title: `${user.name.split(" ")[0]} asked to remove ${t!.title}`, body: reason ? `“${reason}”` : "No reason given", link: { route: "settings", params: { open: "music" } } }, user.id);
};
