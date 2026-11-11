# Vendored from Supabase

Files under `volumes/` are copied unchanged from the official Supabase self-hosting setup:
<https://github.com/supabase/supabase/tree/master/docker> at commit `cd6b25614cca1f520c199c9164bf715b6a15425b` (2026-11-11).
They are Apache-2.0 licensed (see `UPSTREAM-LICENSE`).

`docker-compose.yml` is a trimmed version of that commit's compose file (see the header comment for what changed).
To upgrade, compare against a newer upstream `docker/` folder, bump image tags together, and test locally first.
