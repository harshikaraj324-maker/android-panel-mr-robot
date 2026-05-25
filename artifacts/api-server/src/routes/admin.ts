import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import crypto from "crypto";

const router = Router();

// Hash password (simple sha256 + salt for app passwords)
function hashPassword(password: string, salt: string): string {
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── SETUP: Create all required tables ─────────────────────────────────────────
// Called once on app start and on demand
async function ensureTablesExist() {
  // 1. app_ids table — stores App IDs with login credentials
  const { error: e1 } = await supabaseAdmin.rpc("exec_ddl", {
    sql: `
      CREATE TABLE IF NOT EXISTS app_ids (
        id bigint generated always as identity primary key,
        app_id text not null unique,
        password_hash text not null,
        salt text not null,
        admin_label text,
        created_at timestamptz default now(),
        expires_at timestamptz,
        is_active boolean default true
      );
    `,
  });

  // 2. registered_devices table — all device data, shared across apps
  const { error: e2 } = await supabaseAdmin.rpc("exec_ddl", {
    sql: `
      CREATE TABLE IF NOT EXISTS registered_devices (
        id bigint generated always as identity primary key,
        app_id text not null,
        device_id text not null,
        device_name text,
        device_model text,
        android_version text,
        registered_at timestamptz default now(),
        is_active boolean default true,
        last_seen timestamptz,
        admin_id text
      );
    `,
  });

  return { appIdsError: e1, devicesError: e2 };
}

// ── INIT: Create tables via SQL (called via API) ───────────────────────────────
router.post("/admin/init", async (req, res) => {
  // Use Supabase admin to run raw SQL via postgres endpoint
  try {
    // Create app_ids table
    const { error: err1 } = await supabaseAdmin
      .from("app_ids")
      .select("id")
      .limit(1);

    const { error: err2 } = await supabaseAdmin
      .from("registered_devices")
      .select("id")
      .limit(1);

    const tablesExist = !err1 && !err2;

    res.json({
      ok: true,
      tables_exist: tablesExist,
      app_ids_error: err1?.message ?? null,
      devices_error: err2?.message ?? null,
      sql_to_run: tablesExist
        ? null
        : `
-- Run this SQL once in your Supabase SQL Editor:

CREATE TABLE IF NOT EXISTS app_ids (
  id bigint generated always as identity primary key,
  app_id text not null unique,
  password_hash text not null,
  salt text not null,
  admin_label text,
  created_at timestamptz default now(),
  expires_at timestamptz,
  is_active boolean default true
);

CREATE TABLE IF NOT EXISTS registered_devices (
  id bigint generated always as identity primary key,
  app_id text not null,
  device_id text not null,
  device_name text,
  device_model text,
  android_version text,
  registered_at timestamptz default now(),
  is_active boolean default true,
  last_seen timestamptz,
  admin_id text
);

ALTER TABLE app_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE registered_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_app_ids" ON app_ids FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_devices" ON registered_devices FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_devices" ON registered_devices FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_devices" ON registered_devices FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_devices" ON registered_devices FOR UPDATE TO anon USING (true);

CREATE INDEX IF NOT EXISTS idx_devices_app_id ON registered_devices(app_id);
CREATE INDEX IF NOT EXISTS idx_app_ids_app_id ON app_ids(app_id);
        `.trim(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── APP IDs: List all ──────────────────────────────────────────────────────────
router.get("/admin/app-ids", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("app_ids")
    .select("id,app_id,admin_label,created_at,expires_at,is_active")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Get device counts per app_id
  const { data: devices } = await supabaseAdmin
    .from("registered_devices")
    .select("app_id,is_active");

  const counts: Record<string, { total: number; active: number }> = {};
  for (const d of devices ?? []) {
    if (!counts[d.app_id]) counts[d.app_id] = { total: 0, active: 0 };
    counts[d.app_id].total++;
    if (d.is_active) counts[d.app_id].active++;
  }

  const result = (data ?? []).map((row) => ({
    ...row,
    device_count: counts[row.app_id]?.total ?? 0,
    active_count: counts[row.app_id]?.active ?? 0,
  }));

  res.json(result);
});

// ── APP IDs: Create ────────────────────────────────────────────────────────────
router.post("/admin/app-ids", async (req, res) => {
  const { app_id, password, admin_label, expires_at } = req.body as {
    app_id: string;
    password: string;
    admin_label?: string;
    expires_at?: string;
  };

  if (!app_id || !password) {
    return res.status(400).json({ error: "app_id and password are required" });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(app_id)) {
    return res.status(400).json({ error: "app_id must be alphanumeric (letters, numbers, _ and -)" });
  }

  const salt = generateSalt();
  const password_hash = hashPassword(password, salt);

  const { data, error } = await supabaseAdmin
    .from("app_ids")
    .insert({ app_id, password_hash, salt, admin_label: admin_label ?? null, expires_at: expires_at ?? null })
    .select("id,app_id,admin_label,created_at,is_active")
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: `App ID "${app_id}" already exists` });
    }
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});

// ── APP IDs: Change Password ───────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/password", async (req, res) => {
  const { appId } = req.params;
  const { current_password, new_password } = req.body as {
    current_password: string;
    new_password: string;
  };

  if (!current_password || !new_password) {
    return res.status(400).json({ error: "current_password and new_password are required" });
  }

  // Fetch existing record
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("app_ids")
    .select("salt,password_hash")
    .eq("app_id", appId)
    .single();

  if (fetchErr || !existing) {
    return res.status(404).json({ error: "App ID not found" });
  }

  // Verify current password
  const currentHash = hashPassword(current_password, existing.salt);
  if (currentHash !== existing.password_hash) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  // Update with new password
  const newSalt = generateSalt();
  const newHash = hashPassword(new_password, newSalt);

  const { error: updateErr } = await supabaseAdmin
    .from("app_ids")
    .update({ password_hash: newHash, salt: newSalt })
    .eq("app_id", appId);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  res.json({ ok: true, message: "Password updated successfully" });
});

// ── APP IDs: Toggle active ─────────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/toggle", async (req, res) => {
  const { appId } = req.params;
  const { is_active } = req.body as { is_active: boolean };

  const { error } = await supabaseAdmin
    .from("app_ids")
    .update({ is_active })
    .eq("app_id", appId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── APP IDs: Delete ────────────────────────────────────────────────────────────
router.delete("/admin/app-ids/:appId", async (req, res) => {
  const { appId } = req.params;

  // Delete all devices for this app_id first
  await supabaseAdmin.from("registered_devices").delete().eq("app_id", appId);

  // Delete the app_id record
  const { error } = await supabaseAdmin.from("app_ids").delete().eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

// ── DEVICES: List by app_id ────────────────────────────────────────────────────
router.get("/admin/devices", async (req, res) => {
  const { app_id } = req.query as { app_id?: string };

  let query = supabaseAdmin
    .from("registered_devices")
    .select("*")
    .order("registered_at", { ascending: false });

  if (app_id) query = query.eq("app_id", app_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json(data ?? []);
});

// ── DEVICES: Toggle active ─────────────────────────────────────────────────────
router.patch("/admin/devices/:id/toggle", async (req, res) => {
  const id = Number(req.params.id);
  const { is_active } = req.body as { is_active: boolean };

  const { error } = await supabaseAdmin
    .from("registered_devices")
    .update({ is_active })
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── DEVICES: Delete ────────────────────────────────────────────────────────────
router.delete("/admin/devices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supabaseAdmin.from("registered_devices").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── STATS: Dashboard summary ───────────────────────────────────────────────────
router.get("/admin/stats", async (req, res) => {
  const [{ data: appIds }, { data: devices }] = await Promise.all([
    supabaseAdmin.from("app_ids").select("app_id,is_active"),
    supabaseAdmin.from("registered_devices").select("app_id,is_active,registered_at"),
  ]);

  const totalApps = (appIds ?? []).length;
  const activeApps = (appIds ?? []).filter((a) => a.is_active).length;
  const totalDevices = (devices ?? []).length;
  const activeDevices = (devices ?? []).filter((d) => d.is_active).length;

  // Recent 7 days registrations
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentDevices = (devices ?? []).filter(
    (d) => d.registered_at && d.registered_at > sevenDaysAgo
  ).length;

  res.json({
    total_apps: totalApps,
    active_apps: activeApps,
    total_devices: totalDevices,
    active_devices: activeDevices,
    recent_devices_7d: recentDevices,
  });
});

export default router;
