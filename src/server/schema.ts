// Database schema (Drizzle ORM, PostgreSQL). The matching SQL lives in /drizzle/*.sql.
import { pgTable, text, integer, boolean, timestamp, jsonb, real, bigint, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("USER"), // ADMIN | USER
  color: text("color").notNull().default("#E8A33D"),
  avatarKey: text("avatar_key"),
  tz: text("tz").notNull().default("UTC"),
  quotaGb: integer("quota_gb"), // null = unlimited
  disabled: boolean("disabled").notNull().default(false),
  passwordHash: text("password_hash"),
  oidcSub: text("oidc_sub"),
  ssoLinked: boolean("sso_linked").notNull().default(false),
  immichKeyEnc: text("immich_key_enc"),
  prefs: jsonb("prefs").notNull().default({}),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  joinedAt: ts("joined_at").notNull().defaultNow(),
  lastActiveAt: ts("last_active_at").notNull().defaultNow()
}, (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_oidc_sub_idx").on(t.oidcSub)]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  userAgent: text("user_agent"),
  viaSso: boolean("via_sso").notNull().default(false),
  idToken: text("id_token")
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  daily: boolean("daily").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  sort: integer("sort").notNull().default(0)
}, (t) => [index("categories_user_idx").on(t.userId)]);

export const moods = pgTable("moods", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  color: text("color").notNull(),
  preset: boolean("preset").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  sort: integer("sort").notNull().default(0)
}, (t) => [index("moods_user_idx").on(t.userId)]);

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  desc: text("desc").notNull().default(""),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  coverMediaId: text("cover_media_id"),
  createdAt: ts("created_at").notNull().defaultNow()
});

export const members = pgTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email"), // for people invited who don't have an account yet
  inviteId: text("invite_id"),
  role: text("role").notNull().default("CONTRIBUTOR"), // OWNER | CONTRIBUTOR
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | INVITED
  categoryId: text("category_id"),
  pinned: boolean("pinned").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  invitedBy: text("invited_by"),
  invitedAt: ts("invited_at"),
  joinedAt: ts("joined_at"),
  lastViewedAt: ts("last_viewed_at")
}, (t) => [index("members_project_idx").on(t.projectId), index("members_user_idx").on(t.userId)]);

export const media = pgTable("media", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("video"), // video | photo
  status: text("status").notNull().default("UPLOADING"), // UPLOADING | PROCESSING | READY | FAILED
  originalKey: text("original_key"),
  playbackKey: text("playback_key"),
  posterKey: text("poster_key"),
  stripKey: text("strip_key"),
  fileName: text("file_name"),
  mime: text("mime"),
  codec: text("codec"),
  converted: boolean("converted").notNull().default(false),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  derivedSize: bigint("derived_size", { mode: "number" }).notNull().default(0),
  width: integer("width"),
  height: integer("height"),
  orient: text("orient").notNull().default("portrait"),
  duration: real("duration").notNull().default(0),
  clipStart: real("clip_start").notNull().default(0),
  clipEnd: real("clip_end").notNull().default(1),
  motion: text("motion"),
  takenAt: ts("taken_at"),
  takenDay: text("taken_day"),
  immichAssetId: text("immich_asset_id"),
  error: text("error"),
  progress: integer("progress").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow()
}, (t) => [index("media_owner_idx").on(t.ownerId)]);

export const entries = pgTable("entries", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  mediaId: text("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD in the author's timezone
  note: text("note").notNull().default(""),
  mood: text("mood"),
  trimStart: real("trim_start"),
  trimEnd: real("trim_end"),
  createdAt: ts("created_at").notNull().defaultNow()
}, (t) => [index("entries_project_date_idx").on(t.projectId, t.date), index("entries_media_idx").on(t.mediaId)]);

export const tracks = pgTable("tracks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  duration: real("duration").notNull().default(0),
  bpm: real("bpm"),
  detectedBpm: real("detected_bpm"),
  lufs: real("lufs"),
  format: text("format"),
  key: text("key"),
  playKey: text("play_key"),
  peaks: jsonb("peaks").$type<number[]>(),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("processing"), // processing | ready | failed
  addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
  addedAt: ts("added_at").notNull().defaultNow()
});

export const removalRequests = pgTable("removal_requests", {
  id: text("id").primaryKey(),
  trackId: text("track_id").notNull().references(() => tracks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("open"),
  createdAt: ts("created_at").notNull().defaultNow()
});

export const mashes = pgTable("mashes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
  projectName: text("project_name").notNull().default(""),
  memberId: text("member_id"),
  title: text("title").notNull(),
  defaultTitle: text("default_title").notNull(),
  range: text("range").notNull(),
  custom: jsonb("custom"),
  entryIds: jsonb("entry_ids").notNull().default([]),
  settings: jsonb("settings").notNull().default({}),
  shared: boolean("shared").notNull().default(false),
  status: text("status").notNull().default("queued"), // queued | rendering | ready | failed
  progress: real("progress").notNull().default(0),
  outputKey: text("output_key"),
  posterKey: text("poster_key"),
  size: bigint("size", { mode: "number" }).notNull().default(0),
  duration: real("duration").notNull().default(0),
  error: text("error"),
  remashOf: text("remash_of"),
  createdAt: ts("created_at").notNull().defaultNow(),
  finishedAt: ts("finished_at")
}, (t) => [index("mashes_project_idx").on(t.projectId)]);

export const mashPicks = pgTable("mash_picks", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  excluded: jsonb("excluded").notNull().default({})
}, (t) => [primaryKey({ columns: [t.userId, t.projectId] })]);

export const invites = pgTable("invites", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  tokenEnc: text("token_enc"),
  email: text("email"),
  invitedBy: text("invited_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // needs | pending | accepted | revoked | declined
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  acceptedUserId: text("accepted_user_id")
}, (t) => [uniqueIndex("invites_token_idx").on(t.tokenHash)]);

export const reminders = pgTable("reminders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  time: text("time").notNull(), // HH:MM local
  message: text("message").notNull(),
  rule: text("rule").notNull().default("always"), // always | check
  days: jsonb("days").notNull().default([1, 1, 1, 1, 1, 1, 1]),
  email: boolean("email").notNull().default(false),
  inapp: boolean("inapp").notNull().default(true),
  on: boolean("on").notNull().default(true),
  lastFiredDay: text("last_fired_day")
}, (t) => [index("reminders_user_idx").on(t.userId)]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  link: jsonb("link"),
  action: jsonb("action"),
  read: boolean("read").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow()
}, (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)]);

export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at")
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull()
});
