import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import crypto from "crypto";
import pg from "pg";

const router = Router();

// ── Postgres client for DDL (table creation) ──────────────────────────────────
function getPgClient() {
  return new pg.Client({ connectionString: process.env["SUPABASE_DB_URL"] });
}

// ── Password helpers ───────────────────────────────────────────────────────────
function hashPassword(password: string, salt: string): string {
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}
function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── App ID auto-generator: format MR-ROBOT-NSSW@NDJ ──────────────────────────
const WORDS = [
  "MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","FOXTROT","GHOST","HAWK",
  "IRON","JADE","KING","LION","MAXIM","NOVA","ONYX","PRIME","QUICK","RAVEN",
  "SIGMA","TITAN","ULTRA","VIPER","WOLF","XRAY","YIELD","ZERO","BLAZE","CYBER",
  "DEMON","EAGLE","FLASH","GRAND","HYPER","INFRA","JUMBO","KRYPTO","LASER","METRO",
  "NINJA","ORBIT","PIXEL","QUARK","RAZOR","SPARK","TURBO","ULTRA","VAULT","WARP",
];

function randomLetters(n: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function generateAppId(): string {
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const part1 = randomLetters(4);
  const part2 = randomLetters(3);
  return `${w1}-${w2}-${part1}@${part2}`;
}

// ── Create Tables (called via /admin/init) ────────────────────────────────────
async function createTables(): Promise<{ ok: boolean; message: string }> {
  if (!process.env["SUPABASE_DB_URL"]) {
    return { ok: false, message: "SUPABASE_DB_URL not set" };
  }
  const client = getPgClient();
  try {
    await client.connect();
    await client.query(`
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

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_ids' AND policyname='service_role_all_app_ids') THEN
          CREATE POLICY "service_role_all_app_ids" ON app_ids FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='registered_devices' AND policyname='service_role_all_devices') THEN
          CREATE POLICY "service_role_all_devices" ON registered_devices FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='registered_devices' AND policyname='anon_read_devices') THEN
          CREATE POLICY "anon_read_devices" ON registered_devices FOR SELECT TO anon USING (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='registered_devices' AND policyname='anon_write_devices') THEN
          CREATE POLICY "anon_write_devices" ON registered_devices FOR INSERT TO anon WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='registered_devices' AND policyname='anon_update_devices') THEN
          CREATE POLICY "anon_update_devices" ON registered_devices FOR UPDATE TO anon USING (true);
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_devices_app_id ON registered_devices(app_id);
      CREATE INDEX IF NOT EXISTS idx_app_ids_app_id ON app_ids(app_id);
    `);
    return { ok: true, message: "Tables created successfully" };
  } catch (err) {
    return { ok: false, message: String(err) };
  } finally {
    await client.end();
  }
}

// ── INIT: Check + Create Tables ────────────────────────────────────────────────
router.post("/admin/init", async (req, res) => {
  // Check if tables already exist via Supabase client
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabaseAdmin.from("app_ids").select("id").limit(1),
    supabaseAdmin.from("registered_devices").select("id").limit(1),
  ]);

  const tablesExist = !e1 && !e2;

  if (tablesExist) {
    return res.json({ ok: true, tables_exist: true, message: "Tables already exist" });
  }

  // Create them
  const result = await createTables();
  res.json({ ok: result.ok, tables_exist: result.ok, message: result.message });
});

router.get("/admin/init-status", async (req, res) => {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabaseAdmin.from("app_ids").select("id").limit(1),
    supabaseAdmin.from("registered_devices").select("id").limit(1),
  ]);
  res.json({ tables_exist: !e1 && !e2, app_ids_error: e1?.message ?? null, devices_error: e2?.message ?? null });
});

// ── Generate a unique App ID ───────────────────────────────────────────────────
router.get("/admin/generate-app-id", async (_req, res) => {
  // Generate and check uniqueness
  for (let i = 0; i < 10; i++) {
    const candidate = generateAppId();
    const { data } = await supabaseAdmin.from("app_ids").select("app_id").eq("app_id", candidate).single();
    if (!data) return res.json({ app_id: candidate });
  }
  res.json({ app_id: generateAppId() }); // fallback (collision extremely unlikely)
});

// ── APP IDs: List ──────────────────────────────────────────────────────────────
router.get("/admin/app-ids", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("app_ids")
    .select("id,app_id,admin_label,created_at,expires_at,is_active")
    .order("created_at", { ascending: false });

  // Tables don't exist yet — return empty instead of crashing the UI
  if (error) {
    const isTableMissing = error.message.includes("does not exist") || error.code === "PGRST205" || error.code === "42P01";
    if (isTableMissing) return res.json([]);
    return res.status(500).json({ error: error.message });
  }

  const { data: devices } = await supabaseAdmin.from("registered_devices").select("app_id,is_active");

  const counts: Record<string, { total: number; active: number }> = {};
  for (const d of devices ?? []) {
    if (!counts[d.app_id]) counts[d.app_id] = { total: 0, active: 0 };
    counts[d.app_id].total++;
    if (d.is_active) counts[d.app_id].active++;
  }

  res.json((data ?? []).map((row) => ({
    ...row,
    device_count: counts[row.app_id]?.total ?? 0,
    active_count: counts[row.app_id]?.active ?? 0,
  })));
});

// ── APP IDs: Create (auto-generated ID, default password 1234, 30-day expiry) ─
router.post("/admin/app-ids", async (req, res) => {
  const {
    app_id,
    password = "1234",
    admin_label,
    expires_at,
  } = req.body as {
    app_id: string;
    password?: string;
    admin_label?: string;
    expires_at?: string;
  };

  if (!app_id) return res.status(400).json({ error: "app_id is required" });

  // Default 30-day expiry if not provided
  const expiresAt = expires_at ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const salt = generateSalt();
  const password_hash = hashPassword(password, salt);

  const { data, error } = await supabaseAdmin
    .from("app_ids")
    .insert({ app_id, password_hash, salt, admin_label: admin_label ?? null, expires_at: expiresAt })
    .select("id,app_id,admin_label,created_at,expires_at,is_active")
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: `App ID "${app_id}" already exists` });
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});

// ── APP IDs: Change Password ───────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/password", async (req, res) => {
  const { appId } = req.params;
  const { current_password, new_password } = req.body as { current_password: string; new_password: string };

  if (!current_password || !new_password)
    return res.status(400).json({ error: "current_password and new_password required" });

  const { data: existing } = await supabaseAdmin
    .from("app_ids").select("salt,password_hash").eq("app_id", appId).single();

  if (!existing) return res.status(404).json({ error: "App ID not found" });

  if (hashPassword(current_password, existing.salt) !== existing.password_hash)
    return res.status(401).json({ error: "Current password galat hai" });

  const newSalt = generateSalt();
  const { error } = await supabaseAdmin
    .from("app_ids")
    .update({ password_hash: hashPassword(new_password, newSalt), salt: newSalt })
    .eq("app_id", appId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: "Password update ho gaya" });
});

// ── APP IDs: Reset Password to 1234 ───────────────────────────────────────────
router.post("/admin/app-ids/:appId/reset-password", async (req, res) => {
  const { appId } = req.params;
  const newSalt = generateSalt();
  const { error } = await supabaseAdmin
    .from("app_ids")
    .update({ password_hash: hashPassword("1234", newSalt), salt: newSalt })
    .eq("app_id", appId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, message: "Password reset to 1234" });
});

// ── APP IDs: Extend Session (+ 30 days) ───────────────────────────────────────
router.post("/admin/app-ids/:appId/extend", async (req, res) => {
  const { appId } = req.params;
  const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from("app_ids").update({ expires_at: newExpiry }).eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, expires_at: newExpiry });
});

// ── APP IDs: Toggle ────────────────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/toggle", async (req, res) => {
  const { appId } = req.params;
  const { is_active } = req.body as { is_active: boolean };
  const { error } = await supabaseAdmin.from("app_ids").update({ is_active }).eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── APP IDs: Delete ────────────────────────────────────────────────────────────
router.delete("/admin/app-ids/:appId", async (req, res) => {
  const { appId } = req.params;
  await supabaseAdmin.from("registered_devices").delete().eq("app_id", appId);
  const { error } = await supabaseAdmin.from("app_ids").delete().eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── DEVICES ────────────────────────────────────────────────────────────────────
router.get("/admin/devices", async (req, res) => {
  const { app_id } = req.query as { app_id?: string };
  let query = supabaseAdmin.from("registered_devices").select("*").order("registered_at", { ascending: false });
  if (app_id) query = query.eq("app_id", app_id);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

router.patch("/admin/devices/:id/toggle", async (req, res) => {
  const id = Number(req.params.id);
  const { is_active } = req.body as { is_active: boolean };
  const { error } = await supabaseAdmin.from("registered_devices").update({ is_active }).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.delete("/admin/devices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await supabaseAdmin.from("registered_devices").delete().eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── STATS ──────────────────────────────────────────────────────────────────────
router.get("/admin/stats", async (_req, res) => {
  const [{ data: appIds }, { data: devices }] = await Promise.all([
    supabaseAdmin.from("app_ids").select("app_id,is_active,expires_at"),
    supabaseAdmin.from("registered_devices").select("app_id,is_active,registered_at"),
  ]);

  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  res.json({
    total_apps: (appIds ?? []).length,
    active_apps: (appIds ?? []).filter((a) => a.is_active).length,
    expired_apps: (appIds ?? []).filter((a) => a.expires_at && a.expires_at < now).length,
    total_devices: (devices ?? []).length,
    active_devices: (devices ?? []).filter((d) => d.is_active).length,
    recent_devices_7d: (devices ?? []).filter((d) => d.registered_at && d.registered_at > sevenDaysAgo).length,
  });
});

export default router;
