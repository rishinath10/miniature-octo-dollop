#!/bin/bash
# Nightly backup of the DDS Team database. Run on the VPS (as root) from cron:
#   15 3 * * * /root/dds-backup.sh >> /var/log/dds-backup.log 2>&1
#
# Writes a compressed pg_dump to $BACKUP_DIR and keeps $KEEP_DAYS days of them.
# IMPORTANT: these files are on the same VPS as the database. Copy them off the server
# (e.g. rsync/scp to the Oracle VPS, or upload to S3/B2/R2) before go-live. See docs/DEPLOY.md.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/dds-team}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# Find the Supabase Postgres container started by Dokploy (or set DB_CONTAINER yourself).
if [ -z "${DB_CONTAINER:-}" ]; then
  mapfile -t found < <(docker ps --filter "label=com.docker.compose.service=db" --format '{{.Names}} {{.Image}}' | awk '$2 ~ /^supabase\/postgres:/ {print $1}')
  if [ "${#found[@]}" -ne 1 ]; then
    echo "$(date -Is) ERROR: expected 1 Supabase db container, found ${#found[@]} (${found[*]:-none}). Set DB_CONTAINER." >&2
    exit 1
  fi
  DB_CONTAINER="${found[0]}"
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/dds-team-$(date +%Y%m%d-%H%M%S).sql.gz"

# Full dump (all schemas incl. auth users) as the superuser, plain SQL, gzip'd.
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -h localhost -d postgres \
  --clean --if-exists --no-owner --quote-all-identifiers \
  | gzip -9 > "$file.partial"
mv "$file.partial" "$file"
chmod 600 "$file"

find "$BACKUP_DIR" -name 'dds-team-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "$(date -Is) OK $file ($(du -h "$file" | cut -f1))"
