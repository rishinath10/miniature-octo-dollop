#!/bin/bash
# Applies supabase/migrations/*.sql that haven't been applied yet, in filename order.
# Each file runs in its own transaction; on any error nothing from that file is kept and the
# container exits non-zero (check `docker compose logs migrate`).
# Uses the same tracking table as the Supabase CLI (supabase_migrations.schema_migrations),
# so `supabase migration list --db-url ...` agrees with it.
set -euo pipefail

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

applied=0
shopt -s nullglob
for f in /migrations/*.sql; do
  file=$(basename "$f")
  version="${file%%_*}"
  name="${file#*_}"; name="${name%.sql}"
  if [ "$(psql -tAc "select 1 from supabase_migrations.schema_migrations where version = '${version}'")" = "1" ]; then
    continue
  fi
  echo "Applying ${file}..."
  {
    cat "$f"
    echo
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');"
  } | psql -v ON_ERROR_STOP=1 --single-transaction -q
  applied=$((applied + 1))
done

echo "Migrations up to date (${applied} applied this run)."
