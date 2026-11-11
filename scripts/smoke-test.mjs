// End-to-end smoke test against a LOCAL Supabase stack (supabase start + supabase functions serve).
// Exercises: bootstrap super admin, staff creation via Edge Function, no public sign-up,
// clock-in via RPC, staff isolation, realtime delivery to the admin dashboard, deactivation.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run smoke
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anon || !service) throw new Error("Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("Smoke test only runs against a local stack");

const run = Date.now();
const pw = "Test-password-123";
const svc = createClient(url, service, { auth: { persistSession: false } });
const client = () => createClient(url, anon, { auth: { persistSession: false } });
const functionsUrl = process.env.FUNCTIONS_URL ?? `${url}/functions/v1`;
// Calls the admin-users Edge Function as the signed-in user of client `c`.
async function adminUsers(c, body) {
  const { data: { session } } = await c.auth.getSession();
  const res = await fetch(`${functionsUrl}/admin-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return res.ok ? { data: json, error: null } : { data: null, error: { status: res.status, message: json.error } };
}
let passed = 0;
const step = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};

const superEmail = `super+${run}@test.local`;
const adminEmail = `md+${run}@test.local`;
const staffEmail = `staff+${run}@test.local`;
const su = client(), md = client(), st = client();
let staffId;

await step("bootstrap super admin with service role", async () => {
  // Demote any super admins left by earlier runs is not needed; just add another.
  const { error } = await svc.auth.admin.createUser({
    email: superEmail, password: pw, email_confirm: true,
    app_metadata: { role: "super_admin" }, user_metadata: { full_name: "Smoke Super" },
  });
  assert.ifError(error);
  const r = await su.auth.signInWithPassword({ email: superEmail, password: pw });
  assert.ifError(r.error);
});

await step("public sign-up is disabled", async () => {
  const { error } = await client().auth.signUp({ email: `rogue+${run}@test.local`, password: pw });
  assert.ok(error, "sign-up should fail");
});

await step("super admin creates admin and staff via Edge Function", async () => {
  for (const [email, role, full_name] of [[adminEmail, "admin", "Smoke MD"], [staffEmail, "staff", "Smoke Staff"]]) {
    const { data, error } = await adminUsers(su, { action: "create", email, password: pw, full_name, role, work_mode: "wfh" });
    if (error) throw new Error(error.message);
    if (role === "staff") staffId = data.user_id;
  }
  assert.ifError((await md.auth.signInWithPassword({ email: adminEmail, password: pw })).error);
  assert.ifError((await st.auth.signInWithPassword({ email: staffEmail, password: pw })).error);
  const { data: me } = await st.from("profiles").select("role, work_mode").single();
  assert.deepEqual(me, { role: "staff", work_mode: "wfh" });
});

await step("admin and staff cannot use the staff management function", async () => {
  for (const c of [md, st]) {
    const { error } = await adminUsers(c, { action: "create", email: `x+${run}@test.local`, password: pw, full_name: "X", role: "super_admin" });
    assert.ok(error, "should be refused");
    assert.equal(error.status, 403);
  }
});

await step("admin dashboard receives staff clock-in via Realtime", async () => {
  const got = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no realtime event within 10s")), 10000);
    const ch = md.channel(`smoke-${run}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, (p) => {
        if (p.new?.staff_id === staffId) { clearTimeout(t); md.removeChannel(ch); resolve(p); }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await new Promise((r) => setTimeout(r, 500));
          const { error } = await st.rpc("clock_in");
          if (error) reject(error);
        }
      });
  });
  const payload = await got;
  assert.equal(payload.eventType, "INSERT");
  const { data } = await md.rpc("live_status");
  const me = data.find((r) => r.staff_id === staffId);
  assert.equal(me.status, "online");
});

await step("staff cannot see other people's attendance or presence", async () => {
  const { data: att } = await st.from("attendance").select("staff_id");
  assert.ok(att.every((r) => r.staff_id === staffId));
  const { data: profs } = await st.from("profiles").select("id, last_activity_at");
  assert.equal(profs.length, 1);
  const { error } = await st.rpc("live_status");
  assert.ok(error);
});

await step("invalid sequences are blocked", async () => {
  const { error } = await st.rpc("clock_in");
  assert.match(error.message, /already clocked in/);
  const { error: e2 } = await st.rpc("end_lunch");
  assert.match(e2.message, /Lunch has not started/);
  assert.ifError((await st.rpc("start_lunch")).error);
  const { error: e3 } = await st.rpc("clock_out");
  assert.match(e3.message, /End your lunch/);
  assert.ifError((await st.rpc("end_lunch")).error);
  assert.ifError((await st.rpc("clock_out")).error);
});

await step("deactivated staff can no longer sign in", async () => {
  const { error } = await adminUsers(su, { action: "update", user_id: staffId, is_active: false });
  assert.ifError(error);
  const r = await client().auth.signInWithPassword({ email: staffEmail, password: pw });
  assert.ok(r.error, "sign-in should be refused");
});

console.log(`\nAll ${passed} smoke steps passed`);
await Promise.all([su, md, st].map((c) => c.removeAllChannels()));
process.exit(0);
