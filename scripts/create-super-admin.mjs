// One-off bootstrap: creates the first super admin (Rishi).
// Run from your own computer, never in the browser:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/create-super-admin.mjs you@ddsmarine.com "Your Name"
// You will be asked for a password. After that, create everyone else from the Staff screen.
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const [email, fullName] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !email || !fullName) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-super-admin.mjs <email> "<full name>"');
  process.exit(1);
}

let password = process.env.SUPER_ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Password (8+ characters): ");
  rl.close();
}
if (!password || password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { role: "super_admin", work_mode: "office" },
  user_metadata: { full_name: fullName },
});
if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}
console.log(`Super admin created: ${data.user.email} (${data.user.id})`);
