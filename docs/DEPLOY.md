# Deploying DDS Team on Dokploy (Hostinger VPS)

Everything runs on the Hostinger KVM2 VPS under Dokploy, as two services:

| Service | What it is | Address |
|---|---|---|
| **dds-supabase** (Dokploy *Compose*) | Self-hosted Supabase: database, login, API, realtime, Edge Function. `deploy/supabase/docker-compose.yml` | `https://api.team.ddsmarine.com` |
| **dds-team** (Dokploy *Application*) | The app: static files served by nginx. `Dockerfile` | `https://team.ddsmarine.com` |

Both deploy from this GitHub repo. A push plus redeploy updates them, and database migrations apply automatically when the Supabase service deploys.

**Memory:** the Supabase stack measured about **360 MB** (about **690 MB** with the optional Studio admin screen), plus about 10 MB for the app. That leaves plenty of room on the 8 GB VPS alongside Poste.io.

Set it up in this order: DNS → secrets → Supabase → first super admin → app → backups → checks.

---

## 1. DNS (Hostinger hPanel)

Go to *Domains → ddsmarine.com → DNS / Nameservers* and add two **A** records, both pointing at the VPS's public IPv4 address:

| Type | Name | Points to |
|---|---|---|
| A | `team` | VPS IP |
| A | `api.team` | VPS IP |

Check them from any computer before going further. Let's Encrypt can't issue certificates until these resolve.

```bash
dig +short team.ddsmarine.com
dig +short api.team.ddsmarine.com
```

## 2. Generate the Supabase secrets (on your computer)

Run this from the repo root (needs Node 18+, no install):

```bash
node deploy/supabase/generate-env.mjs https://api.team.ddsmarine.com https://team.ddsmarine.com
```

It prints a block like `POSTGRES_PASSWORD=…`, `JWT_SECRET=…`, `ANON_KEY=…`, `SERVICE_ROLE_KEY=…` and so on.

- **Save the whole block in your password manager.** If it's lost you can't recover the database password or keys.
- **`ANON_KEY` is public.** It goes into the app build.
- **`SERVICE_ROLE_KEY`, `JWT_SECRET` and `POSTGRES_PASSWORD` are full-access secrets.** Never put them in the app, in Git, or in chat.

## 3. Supabase on Dokploy (Compose service)

1. In Dokploy, open your project (e.g. *DDS Team*) and choose **Create Service → Compose**. Name it `dds-supabase`.
2. Set up the source:
   - **Provider:** GitHub, with this repository and the branch you deploy (e.g. `main`).
   - **Compose Path:** `./deploy/supabase/docker-compose.yml`
3. **Environment tab:** paste the block from step 2 and save.
4. **Domains tab → Add Domain:**
   - Service Name: **`api-gw`**
   - Host: `api.team.ddsmarine.com`
   - Path: `/`
   - Container Port: **`8000`**
   - HTTPS: **on**, Certificate: **Let's Encrypt**
5. **Deploy.** The first deploy pulls images and initialises the database. It takes a few minutes.
6. Check the **Logs** for each service:
   - `migrate` should end with `Migrations up to date (3 applied this run).` and then stop. That's normal: it's a one-shot job that runs on every deploy and applies only new files from `supabase/migrations/`. `seed.sql` is never applied.
   - `db`, `auth`, `rest`, `realtime`, `functions` and `api-gw` should all be running and healthy.
7. Test the API from your computer, using the `ANON_KEY` from step 2:

```bash
curl -s https://api.team.ddsmarine.com/auth/v1/health -H "apikey: <ANON_KEY>"
# → {"version":"…","name":"GoTrue",…}
```

**Already decided in the compose file, so there's nothing to set:**
- public sign-up is off;
- email + password login is on;
- accounts are created already confirmed (no emails are sent);
- the database and Studio are **not** exposed to the internet;
- database data is kept in a named Docker volume, so redeploys don't touch it.

### Optional: Supabase Studio (admin screen), via SSH tunnel only
1. In the compose service's Environment, set `COMPOSE_PROFILES=studio` and redeploy.
2. From your computer, run `ssh -L 54323:127.0.0.1:54323 root@<VPS IP>` and open <http://localhost:54323>.

Studio listens only on the VPS's loopback address. It is never reachable from the internet, not even through `api.team.ddsmarine.com`. Remove the setting and redeploy to turn it off again.

## 4. Create the first super admin (you)

Run this once, from the repo root on your computer, after `npm install`:

```bash
SUPABASE_URL=https://api.team.ddsmarine.com \
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from step 2> \
node scripts/create-super-admin.mjs you@ddsmarine.com "Rishi"
```

It asks you for a password. Everyone else is added later from the app's **Staff** screen.

## 5. The app on Dokploy (Application)

1. **Create Service → Application.** Name it `dds-team`.
2. Set up the source:
   - **Provider:** GitHub, same repo and branch.
   - **Build Type:** `Dockerfile`, path `Dockerfile`, context `.`.
3. **Environment → Build-time arguments** (these are baked into the bundle at build time):
   ```
   VITE_SUPABASE_URL=https://api.team.ddsmarine.com
   VITE_SUPABASE_ANON_KEY=<ANON_KEY from step 2>
   ```
4. **Domains → Add Domain:**
   - Host: `team.ddsmarine.com`
   - Container Port: **`80`**
   - HTTPS: **on**, Certificate: **Let's Encrypt**
5. **Deploy.** Then `https://team.ddsmarine.com/healthz` should return `ok`.

Optional: turn on **Auto Deploy** on both services so a push to the branch redeploys them.

**Docker Hub rate limits:** if a build or deploy fails with `429 Too Many Requests`, there are two fixes. For the **app**, add these build arguments to use the identical official images from AWS's public mirror:

```
NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
NGINX_IMAGE=public.ecr.aws/docker/library/nginx:1.27-alpine
```

For **Supabase**, log the VPS in to Docker Hub with a free account (`docker login`) and redeploy.

**Poste.io on the same VPS:** Dokploy's Traefik routes by hostname, so `team…` and `api.team…` don't clash with the mail server's hostname. If Poste.io's web UI binds host ports 80/443 directly, outside Traefik, move it behind Traefik first. Only one thing can own 80/443.

## 6. Backups

`deploy/supabase/backup.sh` dumps the whole database (app data and logins), gzips it, and keeps 14 days of dumps. It was tested by restoring a dump into a fresh Supabase database: users, data, all 23 security policies and the triggers came back intact.

Set it up on the VPS:

```bash
# as root on the VPS
curl -fsSL -o /root/dds-backup.sh https://raw.githubusercontent.com/<owner>/<repo>/<branch>/deploy/supabase/backup.sh
#   (or copy it over with scp if the repo is private)
chmod 700 /root/dds-backup.sh
/root/dds-backup.sh                       # run once now to check: prints "OK /var/backups/dds-team/…"
crontab -e                                # add this line:
15 3 * * * /root/dds-backup.sh >> /var/log/dds-backup.log 2>&1
```

> ⚠️ **Not go-live ready yet:** these dumps sit on the same VPS as the database. If the VPS is lost, the backups go with it. Before go-live, add an off-server copy, either a nightly `rsync` to the Oracle VPS or an upload to S3, Backblaze B2 or Cloudflare R2. This is still to be decided.

**Restore** (into the running stack, which replaces current data):

```bash
DB=$(docker ps --filter label=com.docker.compose.service=db --format '{{.Names}}' | grep -i supabase | head -1)
gunzip -c /var/backups/dds-team/dds-team-YYYYMMDD-HHMMSS.sql.gz | docker exec -i "$DB" psql -U supabase_admin -h localhost -d postgres
```

Test a restore every few months, ideally into a scratch copy, not production.

## 7. After the first deploy: check it works

1. Sign in at `https://team.ddsmarine.com` as super admin and open **Settings**. Set work days, hours, grace minutes and (when decided) the lunch window, then save.
2. **Staff → Add person:** create the MD as `Admin` and the staff member as `Staff`. Send each person their sign-in details privately. This also proves the Edge Function works.
3. On a phone, sign in as staff and tap **Clock in**. On a laptop signed in as the MD, the **Live** page should show *Online* within a couple of seconds, without a refresh. The very first realtime connection after the stack (re)starts can take a few seconds to warm up.
4. Install to the home screen:
   - **Android (Chrome):** menu ⋮ → *Install app*.
   - **iPhone (Safari):** Share → *Add to Home Screen*.
5. Before go-live, staff must sign the PDPA monitoring notice (handled outside the app).

## 8. Updating

| Change | What to do |
|---|---|
| App code | Push, then redeploy **dds-team**. Installed phone apps update the next time they're opened. |
| Database | Add a new file to `supabase/migrations/`, test locally (`supabase db reset && supabase test db`), push, then redeploy **dds-supabase**. The `migrate` job applies it. |
| Edge Function | Push, then redeploy **dds-supabase** (the function is mounted from the repo). |
| Supabase version | Follow `deploy/supabase/UPSTREAM.md`. Bump image tags together and test locally first. Back up before upgrading. |
| API URL or anon key | Change the app's build arguments and redeploy **dds-team**. |

## 9. App icon / logo

The icons are generated from `assets/dds-logo.png`. To replace them, run `npm run icons` after swapping the file, then commit and redeploy.

---

### Appendix: Supabase Cloud instead of self-hosting
If you ever move to Supabase Cloud:
1. Create a project in the DDS Marine organisation.
2. Run `supabase link --project-ref <ref>`, then `supabase db push` and `supabase functions deploy admin-users`.
3. In *Authentication*, turn **off** "Allow new users to sign up" and keep the **Email** provider **on**.
4. Point the app's two build arguments at the cloud URL and anon key.

The migrations are the same files. `supabase_migrations.schema_migrations` is the same tracking table the CLI uses.
