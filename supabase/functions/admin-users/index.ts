// Staff account management. Only an active super_admin may call this.
// Uses the service role key, which lives only in the Edge Function environment.
//
// POST body:
//   { action: "create", email, password, full_name, role, work_mode }
//   { action: "update", user_id, full_name?, role?, work_mode?, is_active? }
//   { action: "set_password", user_id, password }
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const ROLES = ["super_admin", "admin", "staff"] as const;
const MODES = ["office", "wfh"] as const;
const BAN_FOREVER = "876000h"; // 100 years

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function str(v: unknown, field: string, { min = 1, max = 200 } = {}): string {
  if (typeof v !== "string" || v.trim().length < min || v.length > max) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return v.trim();
}

function oneOf<T extends readonly string[]>(v: unknown, list: T, field: string): T[number] {
  if (typeof v !== "string" || !list.includes(v)) throw new HttpError(400, `Invalid ${field}`);
  return v as T[number];
}

function password(v: unknown): string {
  if (typeof v !== "string" || v.length < 8 || v.length > 72) {
    throw new HttpError(400, "Password must be 8–72 characters");
  }
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Who is calling?
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Not signed in");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) throw new HttpError(401, "Not signed in");

    const { data: caller } = await admin
      .from("profiles")
      .select("role, is_active")
      .eq("id", userData.user.id)
      .single();
    if (!caller || caller.role !== "super_admin" || !caller.is_active) {
      throw new HttpError(403, "Only the super admin can manage staff");
    }

    const body = await req.json().catch(() => {
      throw new HttpError(400, "Invalid JSON");
    });

    switch (body.action) {
      case "create": {
        const email = str(body.email, "email", { max: 254 }).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Invalid email");
        const full_name = str(body.full_name, "name");
        const role = oneOf(body.role ?? "staff", ROLES, "role");
        const work_mode = oneOf(body.work_mode ?? "office", MODES, "work mode");

        const { data, error } = await admin.auth.admin.createUser({
          email,
          password: password(body.password),
          email_confirm: true,
          app_metadata: { role, work_mode },
          user_metadata: { full_name },
        });
        if (error) throw new HttpError(400, error.message);
        return json({ user_id: data.user.id });
      }

      case "update": {
        const user_id = str(body.user_id, "user_id");
        const patch: Record<string, unknown> = {};
        if (body.full_name !== undefined) patch.full_name = str(body.full_name, "name");
        if (body.role !== undefined) patch.role = oneOf(body.role, ROLES, "role");
        if (body.work_mode !== undefined) patch.work_mode = oneOf(body.work_mode, MODES, "work mode");
        if (body.is_active !== undefined) {
          if (typeof body.is_active !== "boolean") throw new HttpError(400, "Invalid is_active");
          if (!body.is_active && user_id === userData.user.id) {
            throw new HttpError(400, "You cannot deactivate yourself");
          }
          patch.is_active = body.is_active;
        }
        if (Object.keys(patch).length === 0) throw new HttpError(400, "Nothing to update");

        const { error } = await admin.from("profiles").update(patch).eq("id", user_id);
        if (error) throw new HttpError(400, error.message);

        // Keep auth in step: role in app_metadata, and deactivated users can't sign in.
        const authPatch: Record<string, unknown> = {};
        if (patch.role || patch.work_mode) {
          const { data: u } = await admin.auth.admin.getUserById(user_id);
          authPatch.app_metadata = {
            ...(u.user?.app_metadata ?? {}),
            ...(patch.role ? { role: patch.role } : {}),
            ...(patch.work_mode ? { work_mode: patch.work_mode } : {}),
          };
        }
        if (patch.is_active !== undefined) {
          authPatch.ban_duration = patch.is_active ? "none" : BAN_FOREVER;
        }
        if (Object.keys(authPatch).length) {
          const { error: aErr } = await admin.auth.admin.updateUserById(user_id, authPatch);
          if (aErr) throw new HttpError(400, aErr.message);
        }
        return json({ ok: true });
      }

      case "set_password": {
        const user_id = str(body.user_id, "user_id");
        const { error } = await admin.auth.admin.updateUserById(user_id, {
          password: password(body.password),
        });
        if (error) throw new HttpError(400, error.message);
        return json({ ok: true });
      }

      default:
        throw new HttpError(400, "Unknown action");
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
});
