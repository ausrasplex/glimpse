// Everything one signed-in person is allowed to see, in the shape the app's screens use.
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { getSettings, publicSettings } from "./settings";
import { ms } from "./core";
import { dayKeyInTz } from "../shared/dates";

type User = typeof schema.users.$inferSelect;
const avatarUrl = (u: { id: string; avatarKey: string | null }) => (u.avatarKey ? `/api/files/avatar/${u.id}?v=${encodeURIComponent(u.avatarKey.slice(-12))}` : null);

export function mediaOut(m: typeof schema.media.$inferSelect, mine: boolean) {
  const v = m.status === "READY" ? "" : "?s=" + m.status;
  return {
    id: m.id, ownerId: m.ownerId, kind: m.kind, status: m.status, progress: m.progress, error: m.error,
    thumb: m.posterKey ? `/api/files/media/${m.id}/poster${v}` : null,
    src: m.kind === "video" && m.playbackKey ? `/api/files/media/${m.id}/playback` : null,
    strip: m.stripKey ? `/api/files/media/${m.id}/strip` : null,
    duration: m.duration, clipStart: m.clipStart, clipEnd: m.clipEnd, orient: m.orient, motion: m.motion,
    converted: m.converted ? m.codec || "original" : null, immichId: m.immichAssetId,
    width: m.width, height: m.height, size: mine ? m.size + m.derivedSize : 0, createdAt: ms(m.createdAt),
    takenDay: m.takenDay ?? null, takenAt: m.takenAt ? ms(m.takenAt) : null,
    motionVideo: m.kind === "photo" && m.motionVideo ? m.motionDuration || 0 : null
  };
}

export function mashOut(m: typeof schema.mashes.$inferSelect) {
  const s = (m.settings || {}) as Record<string, unknown>;
  return {
    ...s, id: m.id, ownerId: m.ownerId, projectId: m.projectId, projectName: m.projectName, memberId: m.memberId, title: m.title, defaultTitle: m.defaultTitle,
    range: m.range, custom: m.custom, entryIds: m.entryIds, shared: m.shared, status: m.status, progress: m.progress,
    size: m.size, duration: m.duration, error: m.error, remashOf: m.remashOf, createdAt: ms(m.finishedAt || m.createdAt),
    src: m.outputKey ? `/api/files/mash/${m.id}` : null, poster: m.posterKey ? `/api/files/mash/${m.id}/poster` : null,
    overlay: ((s.stamp as { on?: boolean }) || {}).on !== false
  };
}

export function userOut(u: User, self: boolean, admin: boolean) {
  return {
    id: u.id, name: u.name, color: u.color, photo: avatarUrl(u), role: u.role, deleted: u.email.endsWith("@glimpse.invalid") || undefined,
    email: self || admin ? u.email : "", tz: self || admin ? u.tz : undefined,
    joinedAt: ms(u.joinedAt), lastActive: self || admin ? ms(u.lastActiveAt) : undefined,
    quota: self || admin ? u.quotaGb : undefined, disabled: u.disabled,
    sso: self || admin ? u.ssoLinked : undefined, hasPassword: self ? !!u.passwordHash : undefined,
    immich: self ? !!u.immichKeyEnc : undefined, locked: admin ? !!(u.lockedUntil && u.lockedUntil > new Date()) : undefined
  };
}

export async function buildBootstrap(me: User) {
  const admin = me.role === "ADMIN";
  const settings = await getSettings();

  const myMembers = await db.select().from(schema.members).where(eq(schema.members.userId, me.id));
  const projectIds = [...new Set(myMembers.map((m) => m.projectId))];
  const activeIds = myMembers.filter((m) => m.status === "ACTIVE").map((m) => m.projectId);
  const ownerOf = new Set(myMembers.filter((m) => m.status === "ACTIVE" && m.role === "OWNER").map((m) => m.projectId));

  // Projects I've only been invited to show their name and counts, nothing else, until I accept.
  const projects = projectIds.length ? await db.select().from(schema.projects).where(inArray(schema.projects.id, projectIds)) : [];
  const invitedOnly = projectIds.filter((x) => !activeIds.includes(x));
  const members = activeIds.length ? await db.select().from(schema.members).where(inArray(schema.members.projectId, activeIds)) : [];
  members.push(...myMembers.filter((m) => !activeIds.includes(m.projectId)));
  const entries = activeIds.length ? await db.select().from(schema.entries).where(inArray(schema.entries.projectId, activeIds)) : [];
  const inviteCounts: Record<string, { members: number; clips: number }> = {};
  for (const pid of invitedOnly) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.members).where(and(eq(schema.members.projectId, pid), eq(schema.members.status, "ACTIVE")));
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(schema.entries).where(eq(schema.entries.projectId, pid));
    inviteCounts[pid] = { members: n, clips: c };
  }
  const mediaIds = [...new Set(entries.map((e) => e.mediaId))];
  const mediaRows = await db.select().from(schema.media).where(mediaIds.length ? or(eq(schema.media.ownerId, me.id), inArray(schema.media.id, mediaIds)) : eq(schema.media.ownerId, me.id));

  // An invite sent by email is shown by the email typed, never as the account behind it,
  // so an owner can't tell whether that address already has an account here.
  const byEmail = (m: (typeof members)[number]) => m.status === "INVITED" && !!m.email && m.userId !== me.id;
  const coIds = [...new Set(members.filter((m) => !byEmail(m)).map((m) => m.userId).filter((x): x is string => !!x).concat(entries.map((e) => e.authorId)).concat([me.id]))];
  const users = admin ? await db.select().from(schema.users) : await db.select().from(schema.users).where(inArray(schema.users.id, coIds));
  // Invite senders shown on invite cards.
  const inviterIds = members.filter((m) => m.userId === me.id && m.invitedBy).map((m) => m.invitedBy!) ;
  const extra = inviterIds.filter((x) => !users.find((u) => u.id === x));
  if (extra.length) users.push(...(await db.select().from(schema.users).where(inArray(schema.users.id, extra))));

  const moodRows = await db.select().from(schema.moods).where(inArray(schema.moods.userId, coIds)).orderBy(schema.moods.sort);
  const categories = await db.select().from(schema.categories).where(eq(schema.categories.userId, me.id)).orderBy(schema.categories.sort);
  const mashes = activeIds.length
    ? await db.select().from(schema.mashes).where(or(eq(schema.mashes.ownerId, me.id), and(inArray(schema.mashes.projectId, activeIds), eq(schema.mashes.shared, true))))
    : await db.select().from(schema.mashes).where(eq(schema.mashes.ownerId, me.id));
  const tracks = await db.select().from(schema.tracks).where(or(eq(schema.tracks.status, "ready"), eq(schema.tracks.addedBy, me.id))).orderBy(desc(schema.tracks.addedAt));
  const removalRequests = admin ? await db.select().from(schema.removalRequests) : await db.select().from(schema.removalRequests).where(eq(schema.removalRequests.userId, me.id));
  const invites = admin ? await db.select().from(schema.invites).orderBy(desc(schema.invites.createdAt)) : [];
  const reminders = await db.select().from(schema.reminders).where(eq(schema.reminders.userId, me.id));
  const notifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, me.id)).orderBy(desc(schema.notifications.createdAt)).limit(150);
  const picks = await db.select().from(schema.mashPicks).where(eq(schema.mashPicks.userId, me.id));
  const today = dayKeyInTz(new Date(), me.tz);
  // Every project invite adds a member row, whether or not the person has an account, so count those.
  const [sentToday] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.members).where(and(eq(schema.members.invitedBy, me.id), sql`${schema.members.invitedAt} > now() - interval '1 day'`));

  const adminRow = await db.query.users.findFirst({ where: and(eq(schema.users.role, "ADMIN"), eq(schema.users.disabled, false)) });
  const adminExtra = admin ? await adminData() : undefined;
  const moods: Record<string, unknown[]> = {};
  for (const m of moodRows) (moods[m.userId] ??= []).push({ id: m.id, label: m.label, color: m.color, preset: m.preset, hidden: m.hidden });

  return {
    v: 1,
    today,
    users: users.map((u) => userOut(u, u.id === me.id, admin)),
    categories: categories.map((c) => ({ id: c.id, userId: c.userId, name: c.name, color: c.color, daily: c.daily, isDefault: c.isDefault })),
    moods,
    projects: projects.map((p) => ({ id: p.id, name: p.name, desc: p.desc, ownerId: p.ownerId, createdAt: ms(p.createdAt), cover: inviteCounts[p.id] ? null : p.coverMediaId, invite: inviteCounts[p.id] })),
    members: members.map((m) => ({
      id: m.id, projectId: m.projectId, userId: byEmail(m) && !admin ? null : m.userId, role: m.role, status: m.status, inviteId: admin ? m.inviteId : null,
      email: m.userId === me.id || ownerOf.has(m.projectId) || admin ? m.email : null,
      categoryId: m.userId === me.id ? m.categoryId : null, pinned: m.userId === me.id ? m.pinned : false, archived: m.userId === me.id ? m.archived : false,
      invitedBy: m.invitedBy, invitedAt: ms(m.invitedAt), joinedAt: ms(m.joinedAt), lastViewed: ms(m.lastViewedAt)
    })),
    media: mediaRows.map((m) => mediaOut(m, m.ownerId === me.id)),
    entries: entries.map((e) => ({ id: e.id, projectId: e.projectId, mediaId: e.mediaId, authorId: e.authorId, date: e.date, createdAt: ms(e.createdAt), note: e.note, mood: e.mood, trim: e.trimStart != null && e.trimEnd != null ? { start: e.trimStart, end: e.trimEnd } : null })),
    mashes: mashes.map(mashOut),
    tracks: tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, bpm: t.bpm, detectedBpm: t.detectedBpm, addedBy: t.addedBy, addedAt: ms(t.addedAt), size: t.size, format: t.format, lufs: t.lufs, status: t.status, peaks: t.peaks ?? null, src: t.playKey || t.key ? `/api/files/track/${t.id}` : null })),
    removalRequests: removalRequests.map((r) => ({ id: r.id, trackId: r.trackId, userId: r.userId, reason: r.reason, status: r.status, at: ms(r.createdAt) })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, invitedBy: i.invitedBy, projectId: i.projectId, status: i.status, at: ms(i.createdAt), expiresAt: ms(i.expiresAt), acceptedAt: ms(i.acceptedAt) })),
    reminders: reminders.map((r) => ({ id: r.id, userId: r.userId, time: r.time, message: r.message, rule: r.rule, days: r.days, email: r.email, inapp: r.inapp, on: r.on })),
    notifications: notifications.map((n) => {
      const a = (n.action || {}) as { projectId?: string; answered?: string; label?: string };
      return { id: n.id, userId: n.userId, type: n.type, title: n.title, body: n.body, link: n.link, action: a.label ? n.action : null, projectId: a.projectId, answered: a.answered, read: n.read, at: ms(n.createdAt) };
    }),
    server: { ...publicSettings(settings, admin), adminName: adminRow?.name ?? null },
    admin: adminExtra,
    prefs: { [me.id]: me.prefs },
    mashPicks: Object.fromEntries(picks.map((p) => [p.projectId, p.excluded])),
    invitesSentToday: { [me.id]: sentToday?.n ?? 0 },
    session: { userId: me.id }
  };
}

// What the sign-in, invite and setup pages get before anyone is signed in.
export async function publicBootstrap() {
  const settings = await getSettings();
  return {
    v: 1, today: dayKeyInTz(new Date(), settings.tz), public: true,
    users: [], categories: [], moods: {}, projects: [], members: [], media: [], entries: [], mashes: [], tracks: [],
    removalRequests: [], invites: [], reminders: [], notifications: [], prefs: {}, mashPicks: {}, invitesSentToday: {},
    server: publicSettings(settings, false), session: { userId: null }
  };
}

// Server-wide numbers only admins see: storage per person, the render queue, worker health.
async function adminData() {
  const { redis } = await import("./queue");
  const { statfs } = await import("node:fs/promises");
  const { env } = await import("./env");
  const media = await db.select({ ownerId: schema.media.ownerId, s: sql<string>`sum(${schema.media.size} + ${schema.media.derivedSize})` }).from(schema.media).groupBy(schema.media.ownerId);
  const mashes = await db.select({ ownerId: schema.mashes.ownerId, s: sql<string>`sum(${schema.mashes.size})` }).from(schema.mashes).groupBy(schema.mashes.ownerId);
  const tracks = await db.select({ addedBy: schema.tracks.addedBy, s: sql<string>`sum(${schema.tracks.size})` }).from(schema.tracks).groupBy(schema.tracks.addedBy);
  const usage: Record<string, { clips: number; mashes: number; music: number; total: number }> = {};
  const add = (id: string | null, k: "clips" | "mashes" | "music", v: string) => { if (!id) return; const u = (usage[id] ??= { clips: 0, mashes: 0, music: 0, total: 0 }); u[k] += Number(v || 0); u.total += Number(v || 0); };
  media.forEach((r) => add(r.ownerId, "clips", r.s)); mashes.forEach((r) => add(r.ownerId, "mashes", r.s)); tracks.forEach((r) => add(r.addedBy, "music", r.s));
  const totals = Object.values(usage).reduce((a, u) => ({ clips: a.clips + u.clips, mashes: a.mashes + u.mashes, music: a.music + u.music }), { clips: 0, mashes: 0, music: 0 });
  const tm = await db.select({ s: sql<string>`coalesce(sum(${schema.tracks.size}),0)` }).from(schema.tracks).where(sql`${schema.tracks.addedBy} is null`);
  totals.music += Number(tm[0]?.s || 0);
  const q = await db.select({ id: schema.mashes.id, title: schema.mashes.title, ownerId: schema.mashes.ownerId, status: schema.mashes.status, progress: schema.mashes.progress, createdAt: schema.mashes.createdAt, ownerName: schema.users.name })
    .from(schema.mashes).innerJoin(schema.users, eq(schema.users.id, schema.mashes.ownerId)).where(or(eq(schema.mashes.status, "rendering"), eq(schema.mashes.status, "queued")));
  const shared = await db.execute(sql`select m.user_id as uid, count(*)::int as n from project_members m where m.status = 'ACTIVE' and (select count(*) from project_members o where o.project_id = m.project_id and o.status = 'ACTIVE') > 1 group by m.user_id`);
  let worker = { ok: false, ffmpeg: null as string | null };
  try { const hb = await redis().get("glimpse:worker"); const w = hb ? JSON.parse(hb) : null; if (w && Date.now() - w.at < 60e3) worker = { ok: true, ffmpeg: w.ffmpeg }; } catch { /* redis down */ }
  let dataFree: string | null = null;
  try { const st = await statfs(env.dataDir); const b = st.bavail * st.bsize; dataFree = b >= 1e12 ? (b / 1e12).toFixed(1) + " TB" : Math.round(b / 1e9) + " GB"; } catch { dataFree = null; }
  // Free space where media is kept, in bytes; null on S3, where it can't be measured.
  let mediaFree: number | null = null;
  try { const { storageInfo } = await import("./storage"); mediaFree = (await storageInfo()).free; } catch { mediaFree = null; }
  const [imm] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(sql`${schema.users.immichKeyEnc} is not null`);
  return {
    usage, totals, worker, dataFree, mediaFree, immichConnected: imm?.n ?? 0,
    queue: q.map((x) => ({ ...x, createdAt: ms(x.createdAt), ownerName: x.ownerName.split(" ")[0] })),
    sharedProjects: Object.fromEntries((shared.rows as { uid: string; n: number }[]).map((r) => [r.uid, r.n]))
  };
}
