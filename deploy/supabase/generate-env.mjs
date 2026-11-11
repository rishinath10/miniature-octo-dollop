// Generates the secrets for the self-hosted Supabase stack and prints a ready-to-paste
// block for Dokploy's Environment tab. Needs only Node 18+ (no packages).
//
//   node deploy/supabase/generate-env.mjs https://api.team.ddsmarine.com https://team.ddsmarine.com
//
// Keep the output in your password manager. Anyone with JWT_SECRET or SERVICE_ROLE_KEY has
// full access to the database. Never commit it.
import { createHmac, randomBytes } from "node:crypto";

const [apiUrl = "https://api.team.ddsmarine.com", siteUrl = "https://team.ddsmarine.com"] = process.argv.slice(2);
const b64url = (b) => Buffer.from(b).toString("base64url");
const hex = (n) => randomBytes(n).toString("hex");

const jwtSecret = hex(32); // 64 chars
const now = Math.floor(Date.now() / 1000);
const exp = now + 10 * 365 * 24 * 3600; // 10 years
const sign = (payload) => {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", jwtSecret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};

const env = {
  SUPABASE_PUBLIC_URL: apiUrl.replace(/\/$/, ""),
  SITE_URL: siteUrl.replace(/\/$/, ""),
  POSTGRES_PASSWORD: hex(24),
  JWT_SECRET: jwtSecret,
  JWT_EXPIRY: "3600",
  ANON_KEY: sign({ role: "anon", iss: "supabase", iat: now, exp }),
  SERVICE_ROLE_KEY: sign({ role: "service_role", iss: "supabase", iat: now, exp }),
  SECRET_KEY_BASE: randomBytes(48).toString("base64"),
  REALTIME_DB_ENC_KEY: hex(8), // must be exactly 16 characters
  PG_META_CRYPTO_KEY: hex(16),
  DASHBOARD_USERNAME: "dds",
  DASHBOARD_PASSWORD: hex(16),
  // Set to "studio" to run Supabase Studio (reachable only through an SSH tunnel).
  COMPOSE_PROFILES: "",
};

console.log("# --- DDS Team Supabase secrets (generated " + new Date().toISOString() + ") ---");
for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
console.error(
  "\nPaste the block above into Dokploy → your Supabase compose service → Environment.\n" +
  "The app's Docker build needs only:  VITE_SUPABASE_URL=" + env.SUPABASE_PUBLIC_URL + "  and  VITE_SUPABASE_ANON_KEY=<ANON_KEY>",
);
