import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "../db";
import { id } from "../ids";
import { fail, notify, snapshot, checkMilestones, requireMember, membership } from "../core";
import { str, num, bool } from "../http";
import { isDayKey, dayKeyInTz, addDays } from "../../shared/dates";
import { enqueue } from "../queue";
import { clipMaxOf } from "../../shared/media";
import { gcMedia } from "./projects";
import type { Action } from "./types";

const MOTIONS = ["in", "out", "pan", "still"];
const PALETTE = ["#E8A33D", "#D9C04A", "#9BBF5A", "#6CC99B", "#5BA3A0", "#52BCCB", "#6FA8DC", "#7C89E3", "#9B87D6", "#B47AC9", "#E895C2", "#D9768F", "#EB8A72", "#D97757", "#C4A57F", "#8C96A3"];

async function myMedia(tx: Parameters<Action>[0]["db"], mediaId: string, userId: string) {
  const m = await tx.query.media.findFirst({ where: eq(schema.media.id, mediaId) });
  if (!m || m.ownerId !== userId) fail(404, "That clip wasn't found.");
  return m!;
}

// The part of a new upload a glimpse plays: a photo's length and movement, or a video's trim.
async function setClip(tx: Parameters<Action>[0]["db"], m: { id: string; kind: string }, a: Record<string, unknown>, clipLimit: Parameters<typeof clipMaxOf>[0]) {
  if (m.kind === "photo") {
    const len = num(a.len, 1, 5, 2);
    const motion = MOTIONS.includes(str(a.motion, 10)) ? str(a.motion, 10) : "in";
    await tx.update(schema.media).set({ clipStart: 0, clipEnd: len, motion }).where(eq(schema.media.id, m.id));
  } else {
    const start = num(a.start, 0, 36000, 0);
    const len = num(a.len, 0.5, clipMaxOf(clipLimit), 1);
    await tx.update(schema.media).set({ clipStart: Math.round(start * 10) / 10, clipEnd: Math.round((start + len) * 10) / 10 }).where(eq(schema.media.id, m.id));
  }
}

// Save a new glimpse: one media item shared by every chosen project.
export const saveCapture: Action = async ({ db, user, settings }, a) => {
  const mediaId = str(a.mediaId, 60);
  const projectIds = Array.isArray(a.projectIds) ? [...new Set(a.projectIds.map((x) => str(x, 60)))].slice(0, 30) : [];
  if (!projectIds.length) fail(400, "Pick at least one project.");
  const date = str(a.date, 10);
  if (!isDayKey(date)) fail(400, "That date isn't valid.");
  const today = dayKeyInTz(new Date(), user.tz);
  if (date > addDays(today, 1)) fail(400, "Glimpses can't be dated in the future.");
  const note = str(a.note, 500).trim();
  const moodLabel = str(a.mood, 40).trim() || null;
  const newColor = str(a.newMoodColor, 9);
  await db.transaction(async (tx) => {
    const m = await myMedia(tx, mediaId, user.id);
    if (m.status === "FAILED") fail(400, "That file couldn't be processed, so it can't be saved. Choose another one.");
    for (const pid of projectIds) await requireMember(tx, pid, user.id);
    await setClip(tx, m, a, settings.clipLimit);
    const before = await snapshot(tx, projectIds, user.tz);
    for (const pid of projectIds) {
      await tx.insert(schema.entries).values({ id: id("e_"), projectId: pid, mediaId: m.id, authorId: user.id, date, note, mood: moodLabel });
      const p = await tx.query.projects.findFirst({ where: eq(schema.projects.id, pid) });
      const others = await tx.select({ userId: schema.members.userId }).from(schema.members).where(and(eq(schema.members.projectId, pid), eq(schema.members.status, "ACTIVE")));
      for (const o of others) if (o.userId && o.userId !== user.id) await notify(tx, o.userId, { type: "NEW_CLIPS", title: `${user.name.split(" ")[0]} added a clip to ${p!.name}`, body: note || "Tap to see it", link: { route: "project", params: { projectId: pid } } });
    }
    // A mood typed in for the first time joins the person's mood list.
    if (moodLabel) {
      const mine = await tx.select().from(schema.moods).where(eq(schema.moods.userId, user.id));
      if (!mine.some((x) => x.label.toLowerCase() === moodLabel.toLowerCase())) {
        const color = PALETTE.includes(newColor) ? newColor : PALETTE[mine.length % PALETTE.length];
        await tx.insert(schema.moods).values({ id: id("md_"), userId: user.id, label: moodLabel, color, sort: mine.length });
      }
    }
    for (const pid of projectIds) await checkMilestones(tx, pid, before[pid], user.tz);
  });
};

// Swap the video or photo behind your own clip, everywhere it's used. The day, note, mood and projects stay.
export const replaceEntryMedia: Action = async ({ db, user, settings }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e || e.authorId !== user.id) fail(404, "That entry wasn't found.");
  await db.transaction(async (tx) => {
    const m = await myMedia(tx, str(a.mediaId, 60), user.id);
    if (m.status === "FAILED") fail(400, "That file couldn't be processed, so it can't be used. Choose another one.");
    if (m.id === e!.mediaId) fail(400, "That's the clip it already uses.");
    await setClip(tx, m, a, settings.clipLimit);
    await tx.update(schema.entries).set({ mediaId: m.id, trimStart: null, trimEnd: null }).where(and(eq(schema.entries.mediaId, e!.mediaId), eq(schema.entries.authorId, user.id)));
    await gcMedia(tx, [e!.mediaId]);
  });
};

// Adjust a clip's trim: just for this project (owners can do this to anyone's clip), or everywhere (own clips).
export const saveTrim: Action = async ({ db, user, settings }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e) fail(404, "That entry wasn't found.");
  const mem = await requireMember(db, e!.projectId, user.id);
  const mine = e!.authorId === user.id;
  if (!mine && mem.role !== "OWNER") fail(403, "Only the person who filmed it, or the project owner, can trim this clip.");
  const start = Math.round(num(a.start, 0, 36000, 0) * 10) / 10;
  const end = Math.round(num(a.end, start + 0.5, start + clipMaxOf(settings.clipLimit), start + 1) * 10) / 10;
  if (str(a.scope, 10) === "all" && mine) {
    await db.update(schema.media).set({ clipStart: start, clipEnd: end }).where(eq(schema.media.id, e!.mediaId));
    await db.update(schema.entries).set({ trimStart: null, trimEnd: null }).where(eq(schema.entries.mediaId, e!.mediaId));
  } else await db.update(schema.entries).set({ trimStart: start, trimEnd: end }).where(eq(schema.entries.id, e!.id));
};

export const savePhoto: Action = async ({ db, user }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e || e.authorId !== user.id) fail(404, "That entry wasn't found.");
  const motion = MOTIONS.includes(str(a.motion, 10)) ? str(a.motion, 10) : "in";
  await db.update(schema.media).set({ clipStart: 0, clipEnd: num(a.len, 1, 5, 2), motion }).where(eq(schema.media.id, e!.mediaId));
  await db.update(schema.entries).set({ trimStart: null, trimEnd: null }).where(eq(schema.entries.mediaId, e!.mediaId));
};

export const editEntry: Action = async ({ db, user }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e || e.authorId !== user.id) fail(404, "That entry wasn't found.");
  const moodLabel = str(a.mood, 40).trim() || null;
  await db.update(schema.entries).set({ note: str(a.note, 500).trim(), mood: moodLabel }).where(eq(schema.entries.id, e!.id));
  if (moodLabel && bool(a.addMood)) {
    const mine = await db.select().from(schema.moods).where(eq(schema.moods.userId, user.id));
    if (!mine.some((x) => x.label.toLowerCase() === moodLabel.toLowerCase())) {
      const c = str(a.newMoodColor, 9);
      await db.insert(schema.moods).values({ id: id("md_"), userId: user.id, label: moodLabel, color: PALETTE.includes(c) ? c : PALETTE[mine.length % PALETTE.length], sort: mine.length });
    }
  }
};

// Move one project's entry to another day. Owners can move anyone's clip in their project.
export const moveEntry: Action = async ({ db, user }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e) fail(404, "That entry wasn't found.");
  const mem = await requireMember(db, e!.projectId, user.id);
  if (e!.authorId !== user.id && mem.role !== "OWNER") fail(403, "You can only move your own clips.");
  const date = str(a.date, 10);
  if (!isDayKey(date) || date > addDays(dayKeyInTz(new Date(), user.tz), 1)) fail(400, "That date isn't valid.");
  await db.update(schema.entries).set({ date }).where(eq(schema.entries.id, e!.id));
};

// Remove an entry from one project. Returns a snapshot so the app can offer Undo.
export const deleteEntry: Action = async ({ db, user }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e) fail(404, "That entry wasn't found.");
  const mem = await requireMember(db, e!.projectId, user.id);
  if (e!.authorId !== user.id && mem.role !== "OWNER") fail(403, "You can only remove your own clips.");
  await db.delete(schema.entries).where(eq(schema.entries.id, e!.id));
  return { restore: { ...e, createdAt: e!.createdAt.getTime() } };
};

export const restoreEntry: Action = async ({ db, user }, a) => {
  const r = (a.restore || {}) as Record<string, unknown>;
  const projectId = str(r.projectId, 60), mediaId = str(r.mediaId, 60);
  const mem = await requireMember(db, projectId, user.id);
  const authorId = str(r.authorId, 60);
  if (authorId !== user.id && mem.role !== "OWNER") fail(403, "You can't restore that.");
  const m = await db.query.media.findFirst({ where: eq(schema.media.id, mediaId) });
  if (!m || m.ownerId !== authorId) fail(410, "That clip is gone for good.");
  if (!isDayKey(r.date)) fail(400, "Bad entry.");
  await db.insert(schema.entries).values({
    id: str(r.id, 60) || id("e_"), projectId, mediaId, authorId, date: r.date as string, note: str(r.note, 500), mood: str(r.mood, 40) || null,
    trimStart: typeof r.trimStart === "number" ? r.trimStart : null, trimEnd: typeof r.trimEnd === "number" ? r.trimEnd : null, createdAt: new Date(Number(r.createdAt) || Date.now())
  }).onConflictDoNothing();
};

// Delete your own clip everywhere it's used.
export const deleteClipEverywhere: Action = async ({ db, user }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e || e.authorId !== user.id) fail(404, "That entry wasn't found.");
  const m = await myMedia(db, e!.mediaId, user.id);
  await db.delete(schema.media).where(eq(schema.media.id, m.id)); // entries cascade
  await enqueue.deleteObjects([], [`media/${m.ownerId}/${m.id}/`]);
};

// Change which projects a clip is in (own clips only).
export const setEntryProjects: Action = async ({ db, user }, a) => {
  const e = await db.query.entries.findFirst({ where: eq(schema.entries.id, str(a.entryId, 60)) });
  if (!e || e.authorId !== user.id) fail(404, "That entry wasn't found.");
  const want = Array.isArray(a.projectIds) ? [...new Set(a.projectIds.map((x) => str(x, 60)))] : [];
  if (!want.length) fail(400, "Keep it in at least one project, or delete it instead.");
  await db.transaction(async (tx) => {
    for (const pid of want) await requireMember(tx, pid, user.id);
    const cur = await tx.select().from(schema.entries).where(and(eq(schema.entries.mediaId, e!.mediaId), eq(schema.entries.authorId, user.id)));
    for (const c of cur) if (!want.includes(c.projectId)) await tx.delete(schema.entries).where(eq(schema.entries.id, c.id));
    const before = await snapshot(tx, want, user.tz);
    for (const pid of want) if (!cur.find((c) => c.projectId === pid)) {
      await tx.insert(schema.entries).values({ id: id("e_"), projectId: pid, mediaId: e!.mediaId, authorId: user.id, date: e!.date, note: e!.note, mood: e!.mood });
      await checkMilestones(tx, pid, before[pid], user.tz);
    }
  });
};

export const markViewed: Action = async ({ db, user }, a) => {
  const m = await membership(db, str(a.projectId, 60), user.id);
  if (m) await db.update(schema.members).set({ lastViewedAt: new Date() }).where(eq(schema.members.id, m.id));
};

// Use a motion photo's video part instead of the still: a new video, made by the worker.
export const useMotionVideo: Action = async ({ db, user }, a) => {
  const f = await myMedia(db, str(a.mediaId, 60), user.id);
  if (f.kind !== "photo" || !f.motionVideo) fail(400, "That photo has no video part.");
  const mid = id("m_");
  await db.insert(schema.media).values({ id: mid, ownerId: user.id, kind: "video", status: "UPLOADING", fileName: f.fileName, takenDay: f.takenDay, takenAt: f.takenAt, clipStart: 0, clipEnd: 1 });
  await enqueue.motionVideo(mid, f.id);
  return { mediaId: mid };
};

// Copy a video or photo from the person's own Immich library.
export const immichImport: Action = async ({ db, user, settings }, a) => {
  if (!settings.immich.on) fail(400, "Immich import is turned off.");
  if (!user.immichKeyEnc) fail(400, "Connect your Immich account in Profile first.");
  const assetId = str(a.assetId, 80);
  if (!/^[\w-]+$/.test(assetId)) fail(400, "Bad asset.");
  const kind = str(a.kind, 10) === "photo" ? "photo" : "video";
  const mid = id("m_");
  await db.insert(schema.media).values({ id: mid, ownerId: user.id, kind, status: "UPLOADING", immichAssetId: assetId, motion: kind === "photo" ? "in" : null, clipStart: 0, clipEnd: kind === "photo" ? 2 : 1 });
  await enqueue.importImmich(mid, user.id, assetId);
  return { mediaId: mid };
};

