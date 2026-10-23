#!/bin/sh
# Run as PUID:PGID (Unraid: 99:100) so files in /data are owned like the rest of appdata.
set -e
PUID="${PUID:-99}"
PGID="${PGID:-100}"
if [ "$(id -u)" = "0" ]; then
  if ! getent group "$PGID" >/dev/null 2>&1; then addgroup -g "$PGID" glimpse; fi
  GROUP="$(getent group "$PGID" | cut -d: -f1)"
  if ! getent passwd "$PUID" >/dev/null 2>&1; then adduser -D -H -u "$PUID" -G "$GROUP" -s /sbin/nologin glimpse; fi
  USER_NAME="$(getent passwd "$PUID" | cut -d: -f1)"
  mkdir -p "${DATA_DIR:-/data}/tmp" "${DATA_DIR:-/data}/backups"
  chown -R "$PUID:$PGID" "${DATA_DIR:-/data}" 2>/dev/null || echo "[glimpse] Couldn't change ownership of ${DATA_DIR:-/data}; continuing"
  # Local file storage: make sure the folder exists and Glimpse can write to it. Only the top folder is
  # changed (never recursive), so a big media share starts instantly and other files keep their owners.
  STORE="$(echo "${STORAGE:-}" | tr 'A-Z' 'a-z')"
  if [ "$STORE" = "local" ] || { [ -z "$STORE" ] && [ -z "${S3_ENDPOINT:-}" ]; }; then
    MEDIA="${MEDIA_DIR:-/media}"
    mkdir -p "$MEDIA"
    if [ "$(stat -c %u "$MEDIA")" = "0" ]; then chown "$PUID:$PGID" "$MEDIA" 2>/dev/null || true; fi
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
