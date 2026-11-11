# Deploying DDS Team

This guide covers four things: setting up Supabase, pointing the subdomain at the server, deploying the Docker container on **Dokploy** (Hostinger VPS) or **Coolify** (Oracle VPS), and checking that it all works.

The app is a static site, built once and served by nginx. All data, logins and security live in Supabase. The container holds no secrets.

> Placeholders used below: `team.ddsmarine.com` for the subdomain and `<project-ref>` for the Supabase project ID. Swap in the real values.

---

## 1. Supabase (one-time)

### 1.1 Create the project
1. In the Supabase dashboard, open the **DDS Marine** organisation and create a new project named `dds-team`.
   - Region: **Southeast Asia (Singapore)**, the closest to Penang.
   - Save the database password in your password manager.
2. Note the **Project URL** and the **anon / publishable key** from *Project Settings → API*. These two values are public and go into the Docker build.
3. Note the **service_role / secret key**. It is **never** used in the app or on the server. You need it only once, on your own computer, in step 1.5.

### 1.2 Apply the database
Install the Supabase CLI on your computer (`npm i -g supabase`), then from the repo root run:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push          # applies supabase/migrations/* (NOT seed.sql)
```

`supabase/seed.sql` holds demo accounts with a known password and is for local testing only. Never run it against production. `db push` does not run it by default.

### 1.3 Deploy the Edge Function

```bash
supabase functions deploy admin-users
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically, so there's nothing to set.

### 1.4 Auth settings (dashboard → Authentication)
- **Sign In / Providers → "Allow new users to sign up": OFF.** There's no public sign-up; the super admin creates accounts.
- **Email provider: keep ENABLED.** This is the email + password login. Turning the Email provider off blocks *all* logins, not just sign-ups.
- **URL Configuration → Site URL:** `https://team.ddsmarine.com`

### 1.5 Create the first super admin (you)
Run this on your own computer from the repo root, after `npm install`:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
node scripts/create-super-admin.mjs you@ddsmarine.com "Rishi"
```

It asks for a password. After that, add the MD and staff from the **Staff** screen in the app.

### 1.6 Notes
- **Free plan pausing:** free Supabase projects pause after about a week with **no** activity. Daily use keeps it awake. If it pauses, restore it from the dashboard. The Pro plan never pauses and adds daily backups.
- **Realtime** is switched on by the migrations (`profiles`, `attendance`, `tasks`, `task_activity`, `subtasks`, `checklist_items`), so there's nothing to toggle.

---

## 2. DNS at Hostinger

The `ddsmarine.com` DNS is managed in Hostinger (*hPanel → Domains → ddsmarine.com → DNS / Nameservers*).

Add an **A record**:

| Type | Name | Points to | TTL |
|---|---|---|---|
| A | `team` | public IPv4 of the chosen VPS | 3600 (or the default) |

- **Dokploy:** use the Hostinger KVM2 VPS IP.
- **Coolify:** use the Oracle Cloud VPS public IP.

Check it before requesting HTTPS:

```bash
dig +short team.ddsmarine.com    # should print the VPS IP
```

Let's Encrypt can only issue a certificate once this resolves, so wait for it first. This is usually a few minutes, sometimes up to an hour.

---

## 3a. Deploy on Dokploy (Hostinger VPS)

1. **Create → Project** (e.g. `DDS Team`), then **Create Service → Application**.
2. **Provider:** GitHub. Pick this repository and the branch to deploy (e.g. `main`).
3. **Build Type:** `Dockerfile`. Dockerfile path: `Dockerfile`, context `.`.
4. **Environment → Build-time arguments** (not runtime env, because these get baked into the bundle):
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
   ```
5. **Domains → Add domain:**
   - Host: `team.ddsmarine.com`
   - Container port: `80`
   - HTTPS: **on**, certificate provider **Let's Encrypt**
6. **Deploy.** The first build takes a few minutes.
7. Optional: turn on **Auto Deploy** so every push to the branch redeploys.

Poste.io on the same VPS keeps ports 25/465/587/993 and its own web hostname. Dokploy's Traefik routes `team.ddsmarine.com` to this container by hostname, so they don't clash. If Poste.io's web UI is bound directly to host ports 80/443 (outside Traefik), move it behind Traefik first. Only one service can own 80/443.

## 3b. Deploy on Coolify (Oracle VPS)

1. **+ New → Resource →** *Private Repository (with GitHub App)*, or *Public Repository* if the repo is public. Pick this repository and branch.
2. **Build Pack:** `Dockerfile`.
3. **Ports Exposes:** `80`.
4. **Domains:** `https://team.ddsmarine.com`. With `https://`, Coolify issues a Let's Encrypt certificate automatically.
5. **Environment Variables:** add both, and tick **"Build Variable"** on each:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
   ```
6. **Deploy.**

Oracle Cloud blocks ports by default. The VPS already serves the payslip dashboard, so 80/443 should already be open. If not, open TCP 80 and 443 in the instance's **VCN Security List** *and* the host firewall (`iptables`/`ufw`).

### Docker Hub rate limits
If a build fails with `429 Too Many Requests` pulling `node`/`nginx`, add these build arguments to use the identical official images from AWS's public mirror:
```
NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
NGINX_IMAGE=public.ecr.aws/docker/library/nginx:1.27-alpine
```

---

## 4. After the first deploy: check it works

1. `https://team.ddsmarine.com/healthz` returns `ok`.
2. Sign in as super admin and open **Settings**. Set work days, hours, grace minutes and (when decided) the lunch window, then save.
3. **Staff → Add person:** create the MD as `Admin` and the staff member as `Staff`. Send each person their sign-in details privately.
4. On a phone, sign in as staff and tap **Clock in**. On a laptop signed in as the MD, the **Live** page should change to *Online* within a couple of seconds, without a refresh.
5. Install to the home screen:
   - **Android (Chrome):** menu ⋮ → *Install app*.
   - **iPhone (Safari):** Share → *Add to Home Screen*. Notifications in Phase 2 need iOS 16.4+ and the app opened from the home screen.
6. Before go-live, staff must sign the PDPA monitoring notice (handled outside the app).

---

## 5. Updating

| Change | What to do |
|---|---|
| App code | Push to the deployed branch. Dokploy/Coolify rebuild (auto-deploy, or press *Redeploy*). Installed PWAs update on the next open. |
| Database | Add a new file in `supabase/migrations/`, test locally (`supabase db reset && supabase test db`), then `supabase db push`. |
| Edge Function | `supabase functions deploy admin-users` |
| Supabase URL or key | Change the build arguments and **redeploy** (they're baked in at build time). |

## 6. App icon / logo

The icons are generated from `assets/dds-logo.png` (the official DDS logo). To replace the logo:

```bash
cp new-logo.png assets/dds-logo.png
npm run icons      # regenerates public/icons/*
```

Commit the new files and redeploy.
