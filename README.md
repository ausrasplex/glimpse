# Glimpse

A self-hosted "one second a day" video diary. Capture a short clip (or a photo) each day, file it into projects — a diary, a trip, a new puppy — share projects with family, and mash them into short films with music, beat sync and date stamps.

- Invite-only, with optional single sign-on (any OpenID Connect provider: Authentik, Authelia, Keycloak, Pocket ID, Zitadel…)
- Imports videos and photos from your own Immich library
- iPhone HEVC and other formats are converted to a playback copy that every browser plays; originals are kept for mashes
- Mashes in portrait, landscape or square, with blurred/cropped/barred fill, a customisable date stamp, a music tracklist, crossfades and beat sync
- Reminders, streaks, milestones, "On this day"
- Runs as one container (web app + render worker) next to PostgreSQL and Redis. Files go in an Unraid share, or optionally S3-compatible storage

---

## 1. Publish the image to GHCR

1. Create a GitHub repository called `glimpse` and push this folder to its `main` branch.
2. Replace `YOUR_GITHUB_USER` with your GitHub username in `unraid/glimpse.xml`, `Dockerfile` and `docker-compose.example.yml`:
   ```sh
   grep -rl YOUR_GITHUB_USER . | xargs sed -i 's/YOUR_GITHUB_USER/your-username/g'
   ```
3. The **Build and publish image** workflow (`.github/workflows/docker.yml`) runs on every push to `main`. It builds for `linux/amd64` and `linux/arm64` and pushes `ghcr.io/<you>/glimpse:latest` (and `:1.2.3` tags when you push a `v1.2.3` git tag).
4. On GitHub, open **your profile › Packages › glimpse › Package settings** and set visibility to **Public**, so Unraid can pull it without logging in.

`package-lock.json` is included, so every build installs exactly the versions this release was tested with.

The workflow also runs the unit tests and the TypeScript check. Those are reported separately and don't block the image.

## 2. Set up on Unraid

Glimpse needs two companion containers. Install them from **Apps** (Community Applications):

| Container | Suggested app | Notes |
|---|---|---|
| PostgreSQL 15 or newer | `postgresql17` (or the official `postgres`) | Create a database `glimpse` and a user with a strong password |
| Redis 7+ | `redis` | Default settings are fine |

Then create a share for your media in **Shares › Add Share**, e.g. `glimpse-media`:

- **Primary storage:** your cache pool (fast uploads and renders)
- **Secondary storage:** Array, with mover action **Cache → Array** (or no secondary storage if you'd rather keep everything on the SSDs; use a mirrored pool or back it up)
- Keep SMB export off or private. Glimpse checks who can see each clip, but anyone with direct share access bypasses that.

Then install Glimpse itself:

1. **Docker › Add Container › Template repositories**, add `https://github.com/<you>/glimpse` — or copy `unraid/glimpse.xml` to `/boot/config/plugins/dockerMan/templates-user/my-glimpse.xml`.
2. **Add Container**, pick **Glimpse**, and fill in:
   - **Public web address** (`APP_URL`): the address people will use, e.g. `https://glimpse.yourdomain.com`
   - **Secret key** (`SECRET_KEY`): run `openssl rand -hex 32` in the Unraid terminal and paste the result. **Never change it later** — it encrypts stored secrets.
   - **Database URL**: `postgresql://USER:PASSWORD@UNRAID-IP:5432/glimpse`
   - **Redis URL**: `redis://UNRAID-IP:6379`
   - **Media**: `/mnt/user/glimpse-media`. Always a `/mnt/user/...` path, never `/mnt/cache/...`, so files stay visible after the mover runs
   - **File storage**: `local`
   - **App data**: `/mnt/user/appdata/glimpse` (database backups and temporary render files)
3. Start it and open the container's **Logs**. You'll see:
   ```
   [glimpse] No admin found, first-run setup enabled
   [glimpse] Setup code: 482-913
   ```
4. Open the WebUI and enter that code. The setup wizard creates your admin account, checks the database, Redis, file storage and the render worker, and optionally sets up email and single sign-on.

### Reverse proxy (internet access)

Put Glimpse behind SWAG, Nginx Proxy Manager, Caddy or Traefik with HTTPS. Two things matter:

- **Allow large uploads.** Phone videos can be hundreds of MB. In Nginx Proxy Manager add `client_max_body_size 4096M;` under **Advanced**; in SWAG put it in the site config. Caddy and Traefik have no limit by default.
- **Pass the original host** (`proxy_set_header Host $host;` — the default in SWAG and NPM).

Only Glimpse needs to be exposed. Browsers never touch your media share, S3, Immich or the identity provider's back end directly; uploads and playback stream through Glimpse.

## 3. Single sign-on (optional)

In your provider, create an OpenID Connect app with:

- **Redirect URI:** `https://glimpse.yourdomain.com/api/auth/callback/oidc`
- **Scopes:** `openid email profile` (plus `groups` if you use group rules)

Then either fill in **Settings › Sign-in**, or set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` on the container (this locks the fields in Settings).

- By default SSO only signs in people who already have an account or a pending invite, matched by email. **Anyone in a group** lets members of a provider group create an account on first sign-in.
- An optional **admin group** makes its members admins when they sign in. It never removes admin rights.
- If the provider marks the email as unverified (`email_verified: false`), Glimpse won't match on it. A missing claim is trusted, since you chose to trust the provider.
- **SSO only** hides the password form. If your provider breaks, restart the container: the log prints a one-time recovery link that lets an admin sign in with a password.

## 4. S3 storage instead of a share (optional)

Most Unraid setups should keep **File storage** on `local`. Use S3 if your storage lives on another machine or you already run an S3 store. Set **File storage** to `s3`, then fill in the S3 settings under **Show more settings**. For Garage, the endpoint is usually `http://UNRAID-IP:3900`, and the region must match Garage's config (often `garage`). Moving between local and S3 later means copying the files across yourself. Glimpse doesn't migrate them.

## 5. Email (optional, recommended)

**Settings › Email** sets up SMTP for invites and password resets. Without it, Glimpse still works:

- **Invites:** as admin, open **Settings › People › Invites**, tap the invite and choose **Copy link**, then send it yourself. Project owners who aren't admins can still invite. The admin copies the link for them, so owners never learn whether an address already has an account.
- **Password resets:** as admin, open the person in **Settings › People** and choose **Make reset link**.

## 6. Immich import (optional)

**Settings › Immich**: turn it on and enter the address Glimpse's server uses to reach Immich, e.g. `http://192.168.1.10:2283` or `http://immich-server:2283` on a shared Docker network. Each person then adds their own Immich API key in **Profile** (Immich › Account settings › API keys; give it read access to assets), so they only ever see their own library. Picked items are copied into Glimpse.

## 7. Backups

- **Database:** Glimpse runs `pg_dump` on the schedule set in **Settings › Backups** into `/mnt/user/appdata/glimpse/backups`.
- **Media:** clips, photos, music and mashes live in your media share (`/mnt/user/glimpse-media`), as normal files you can back up with anything. With S3 storage, back up the S3 container's data folder instead.

Restore: create an empty database and run `pg_restore --no-owner -d "$DATABASE_URL" glimpse-YYYY-MM-DD-HH-MM.dump`. Backups are written by `pg_dump` 17, which older `pg_restore` versions can't read, so run the restore from inside the Glimpse container (it has version 17), even if your database is older: `docker exec glimpse sh -c 'pg_restore --no-owner -d "$DATABASE_URL" /data/backups/glimpse-YYYY-MM-DD-HH-MM.dump'`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | yes | Public address, used in links, emails and the SSO redirect |
| `SECRET_KEY` | yes | 32+ random characters; signs sessions and encrypts stored secrets |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `REDIS_URL` | yes | Redis connection string |
| `STORAGE` | no | `local` (default): files in the folder mapped to `/media`. `s3`: S3-compatible storage |
| `MEDIA_DIR` | no | Folder for local storage inside the container. Default `/media` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | with `s3` | S3-compatible storage |
| `S3_REGION` | no | Default `us-east-1` (Garage: usually `garage`) |
| `TZ` | no | Server timezone (backups, default for new people) |
| `PUID` / `PGID` | no | File owner for `/data` (Unraid: 99/100) |
| `GLIMPSE_WORKER` | no | `false` to run the web app only (run a second container with it `true` for a separate worker) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | no | Single sign-on from the environment |

## Development

```sh
npm install
docker compose -f docker-compose.example.yml up -d postgres redis
export DATABASE_URL=postgresql://glimpse:glimpse@localhost:5432/glimpse REDIS_URL=redis://localhost:6379 \
  STORAGE=local MEDIA_DIR=./media \
  SECRET_KEY=$(openssl rand -hex 32) APP_URL=http://localhost:3000 DATA_DIR=./data
npm run build && node dist/start.js   # or: npm run dev (web only) + node dist/worker.js
npm test
```

Layout:

- `src/app` — Next.js routes (one page for the app, `/api/*` for everything else)
- `src/client` — the app's screens (React)
- `src/server` — auth, sessions, settings, storage, the bootstrap data and every action (`src/server/actions`)
- `src/worker` — FFmpeg jobs: playback copies, photos, Immich import, music analysis, mash rendering, reminders, backups
- `src/shared` — rules shared by app and worker (beat sync, date stamp, dates)
- `drizzle/*.sql` — database migrations, applied automatically at start-up
