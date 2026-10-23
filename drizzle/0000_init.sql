-- Glimpse initial schema
CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'USER',
  color text NOT NULL DEFAULT '#E8A33D',
  avatar_key text,
  tz text NOT NULL DEFAULT 'UTC',
  quota_gb integer,
  disabled boolean NOT NULL DEFAULT false,
  password_hash text,
  oidc_sub text,
  sso_linked boolean NOT NULL DEFAULT false,
  immich_key_enc text,
  prefs jsonb NOT NULL DEFAULT '{}',
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (email);
CREATE UNIQUE INDEX users_oidc_sub_idx ON users (oidc_sub);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  via_sso boolean NOT NULL DEFAULT false,
  id_token text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE categories (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  daily boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0
);
CREATE INDEX categories_user_idx ON categories (user_id);

CREATE TABLE moods (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  color text NOT NULL,
  preset boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0
);
CREATE INDEX moods_user_idx ON moods (user_id);

CREATE TABLE projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  "desc" text NOT NULL DEFAULT '',
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cover_media_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  email text,
  invite_id text,
  role text NOT NULL DEFAULT 'CONTRIBUTOR',
  status text NOT NULL DEFAULT 'ACTIVE',
  category_id text,
  pinned boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  invited_by text,
  invited_at timestamptz,
  joined_at timestamptz,
  last_viewed_at timestamptz
);
CREATE INDEX members_project_idx ON project_members (project_id);
CREATE INDEX members_user_idx ON project_members (user_id);

CREATE TABLE media (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'video',
  status text NOT NULL DEFAULT 'UPLOADING',
  original_key text,
  playback_key text,
  poster_key text,
  strip_key text,
  file_name text,
  mime text,
  codec text,
  converted boolean NOT NULL DEFAULT false,
  size bigint NOT NULL DEFAULT 0,
  derived_size bigint NOT NULL DEFAULT 0,
  width integer,
  height integer,
  orient text NOT NULL DEFAULT 'portrait',
  duration real NOT NULL DEFAULT 0,
  clip_start real NOT NULL DEFAULT 0,
  clip_end real NOT NULL DEFAULT 1,
  motion text,
  taken_at timestamptz,
  immich_asset_id text,
  error text,
  progress integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_idx ON media (owner_id);

CREATE TABLE entries (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date text NOT NULL,
  note text NOT NULL DEFAULT '',
  mood text,
  trim_start real,
  trim_end real,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entries_project_date_idx ON entries (project_id, date);
CREATE INDEX entries_media_idx ON entries (media_id);

CREATE TABLE tracks (
  id text PRIMARY KEY,
  title text NOT NULL,
  artist text NOT NULL DEFAULT '',
  duration real NOT NULL DEFAULT 0,
  bpm real,
  detected_bpm real,
  lufs real,
  format text,
  key text,
  play_key text,
  size bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  added_by text REFERENCES users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE removal_requests (
  id text PRIMARY KEY,
  track_id text NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mashes (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE SET NULL,
  project_name text NOT NULL DEFAULT '',
  member_id text,
  title text NOT NULL,
  default_title text NOT NULL,
  range text NOT NULL,
  custom jsonb,
  entry_ids jsonb NOT NULL DEFAULT '[]',
  settings jsonb NOT NULL DEFAULT '{}',
  shared boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued',
  progress real NOT NULL DEFAULT 0,
  output_key text,
  poster_key text,
  size bigint NOT NULL DEFAULT 0,
  duration real NOT NULL DEFAULT 0,
  error text,
  remash_of text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX mashes_project_idx ON mashes (project_id);

CREATE TABLE mash_picks (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  excluded jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE invites (
  id text PRIMARY KEY,
  token_hash text NOT NULL,
  token_enc text,
  email text,
  invited_by text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id text
);
CREATE UNIQUE INDEX invites_token_idx ON invites (token_hash);

CREATE TABLE reminders (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time text NOT NULL,
  message text NOT NULL,
  rule text NOT NULL DEFAULT 'always',
  days jsonb NOT NULL DEFAULT '[1,1,1,1,1,1,1]',
  email boolean NOT NULL DEFAULT false,
  inapp boolean NOT NULL DEFAULT true,
  "on" boolean NOT NULL DEFAULT true,
  last_fired_day text
);
CREATE INDEX reminders_user_idx ON reminders (user_id);

CREATE TABLE notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link jsonb,
  action jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at);

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
