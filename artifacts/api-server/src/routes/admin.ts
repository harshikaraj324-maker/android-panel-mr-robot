import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAT_FILE = path.resolve(__dirname, "../../../../.local/supabase-pat");

// ── Supabase Management API ────────────────────────────────────────────────────
const PROJECT_REF = "dvgcrxrnnezbdjpujjjt";

const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS app_ids (
  id bigint generated always as identity primary key,
  app_id text not null unique,
  name text,
  pin text not null default '1234',
  status text not null default 'active',
  created_at timestamptz default now(),
  expires_at timestamptz
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
`;

// ── PAT helpers (stored locally so user enters only once) ─────────────────────
function getStoredPat(): string | null {
  try {
    if (fs.existsSync(PAT_FILE)) {
      const v = fs.readFileSync(PAT_FILE, "utf8").trim();
      return v || null;
    }
  } catch {}
  return null;
}

function storePat(pat: string) {
  try {
    fs.mkdirSync(path.dirname(PAT_FILE), { recursive: true });
    fs.writeFileSync(PAT_FILE, pat.trim(), "utf8");
  } catch {}
}

async function createTablesViaPat(pat: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pat.trim()}`,
      },
      body: JSON.stringify({ query: SETUP_SQL }),
    }
  );
  const json = await res.json() as { message?: string; error?: string };
  if (!res.ok) return { ok: false, message: json.message ?? json.error ?? `HTTP ${res.status}` };
  return { ok: true, message: "Tables created" };
}

async function tablesExist(): Promise<boolean> {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabaseAdmin.from("app_ids").select("id").limit(1),
    supabaseAdmin.from("registered_devices").select("id").limit(1),
  ]);
  return !e1 && !e2;
}

// Auto-create tables on startup if PAT is stored ──────────────────────────────
(async () => {
  const pat = getStoredPat();
  if (!pat) return;
  if (await tablesExist()) return;
  await createTablesViaPat(pat);
})();

// ── App ID generator: WORD-WORD-XXXX@YYY ─────────────────────────────────────
const WORDS = [
  "MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","FOXTROT","GHOST","HAWK",
  "IRON","JADE","KING","LION","MAXIM","NOVA","ONYX","PRIME","QUICK","RAVEN",
  "SIGMA","TITAN","ULTRA","VIPER","WOLF","XRAY","YIELD","ZERO","BLAZE","CYBER",
  "DEMON","EAGLE","FLASH","GRAND","HYPER","INFRA","JUMBO","KRYPTO","LASER","METRO",
  "NINJA","ORBIT","PIXEL","QUARK","RAZOR","SPARK","TURBO","ULTRA","VAULT","WARP",
];
function randomLetters(n: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function generateAppId(): string {
  const w1 = WORDS[Math.floor(Math.random() * WORDS.length)];
  const w2 = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${w1}-${w2}-${randomLetters(4)}@${randomLetters(3)}`;
}

// ── SETUP: create tables (stores PAT for auto-use next time) ─────────────────
router.post("/admin/setup", async (req, res) => {
  const { pat } = req.body as { pat?: string };
  if (!pat?.trim()) return res.status(400).json({ ok: false, message: "Access token required" });

  if (await tablesExist()) {
    storePat(pat); // save for future auto-use
    return res.json({ ok: true, message: "Tables already exist" });
  }

  const result = await createTablesViaPat(pat);
  if (result.ok) storePat(pat); // persist PAT for future auto-use
  res.json(result);
});

// ── SETUP STATUS ──────────────────────────────────────────────────────────────
router.get("/admin/init-status", async (_req, res) => {
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabaseAdmin.from("app_ids").select("id").limit(1),
    supabaseAdmin.from("registered_devices").select("id").limit(1),
  ]);
  res.json({
    tables_exist: !e1 && !e2,
    has_pat: !!getStoredPat(),
    app_ids_error: e1?.message ?? null,
    devices_error: e2?.message ?? null,
  });
});

// ── GENERATE unique App ID ────────────────────────────────────────────────────
router.get("/admin/generate-app-id", async (_req, res) => {
  for (let i = 0; i < 10; i++) {
    const candidate = generateAppId();
    const { data } = await supabaseAdmin.from("app_ids").select("app_id").eq("app_id", candidate).single();
    if (!data) return res.json({ app_id: candidate });
  }
  res.json({ app_id: generateAppId() });
});

// ── APP IDs: List ─────────────────────────────────────────────────────────────
router.get("/admin/app-ids", async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from("app_ids")
    .select("id,app_id,name,pin,status,created_at,expires_at")
    .order("created_at", { ascending: false });

  if (error) {
    const missing = error.code === "PGRST205" || error.message.includes("does not exist");
    if (missing) return res.json({ needs_setup: true, rows: [] });
    return res.status(500).json({ error: error.message });
  }

  const { data: devices } = await supabaseAdmin.from("registered_devices").select("app_id,is_active");
  const counts: Record<string, { total: number; active: number }> = {};
  for (const d of devices ?? []) {
    if (!counts[d.app_id]) counts[d.app_id] = { total: 0, active: 0 };
    counts[d.app_id].total++;
    if (d.is_active) counts[d.app_id].active++;
  }

  res.json({
    needs_setup: false,
    rows: (data ?? []).map((row) => ({
      ...row,
      device_count: counts[row.app_id]?.total ?? 0,
      active_count: counts[row.app_id]?.active ?? 0,
    })),
  });
});

// ── APP IDs: Create ───────────────────────────────────────────────────────────
router.post("/admin/app-ids", async (req, res) => {
  const { app_id, pin = "1234", name, expires_at } = req.body as {
    app_id: string; pin?: string; name?: string; expires_at?: string;
  };
  if (!app_id) return res.status(400).json({ error: "app_id is required" });

  const expiresAt = expires_at ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("app_ids")
    .insert({ app_id, pin, name: name ?? null, status: "active", expires_at: expiresAt })
    .select("id,app_id,name,pin,status,created_at,expires_at")
    .single();

  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: `App ID "${app_id}" already exists` });
    const missing = error.code === "PGRST205" || error.message.includes("does not exist");
    if (missing) return res.status(503).json({ error: "needs_setup", message: "Tables not created yet" });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// ── APP IDs: Change PIN ───────────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/password", async (req, res) => {
  const { appId } = req.params;
  const { new_password } = req.body as { new_password: string };
  if (!new_password) return res.status(400).json({ error: "new_password required" });
  const { error } = await supabaseAdmin.from("app_ids").update({ pin: new_password }).eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── APP IDs: Reset PIN to 1234 ────────────────────────────────────────────────
router.post("/admin/app-ids/:appId/reset-password", async (req, res) => {
  const { appId } = req.params;
  const { error } = await supabaseAdmin.from("app_ids").update({ pin: "1234" }).eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── APP IDs: Extend +30 Days ──────────────────────────────────────────────────
router.post("/admin/app-ids/:appId/extend", async (req, res) => {
  const { appId } = req.params;
  const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from("app_ids").update({ expires_at: newExpiry }).eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, expires_at: newExpiry });
});

// ── APP IDs: Toggle Status ────────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/toggle", async (req, res) => {
  const { appId } = req.params;
  const { status } = req.body as { status: string };
  const { error } = await supabaseAdmin.from("app_ids").update({ status }).eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── APP IDs: Delete ───────────────────────────────────────────────────────────
router.delete("/admin/app-ids/:appId", async (req, res) => {
  const { appId } = req.params;
  await supabaseAdmin.from("registered_devices").delete().eq("app_id", appId);
  const { error } = await supabaseAdmin.from("app_ids").delete().eq("app_id", appId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── DEVICES ───────────────────────────────────────────────────────────────────
router.get("/admin/devices", async (req, res) => {
  const { app_id } = req.query as { app_id?: string };
  let q = supabaseAdmin.from("registered_devices").select("*").order("registered_at", { ascending: false });
  if (app_id) q = q.eq("app_id", app_id);
  const { data, error } = await q;
  if (error) {
    const missing = error.code === "PGRST205" || error.message.includes("does not exist");
    if (missing) return res.json([]);
    return res.status(500).json({ error: error.message });
  }
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

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get("/admin/stats", async (_req, res) => {
  const [{ data: appIds }, { data: devices }] = await Promise.all([
    supabaseAdmin.from("app_ids").select("app_id,status,expires_at"),
    supabaseAdmin.from("registered_devices").select("app_id,is_active,registered_at"),
  ]);
  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  res.json({
    total_apps: (appIds ?? []).length,
    active_apps: (appIds ?? []).filter((a) => a.status === "active").length,
    expired_apps: (appIds ?? []).filter((a) => a.expires_at && a.expires_at < now).length,
    total_devices: (devices ?? []).length,
    active_devices: (devices ?? []).filter((d) => d.is_active).length,
    recent_devices_7d: (devices ?? []).filter((d) => d.registered_at && d.registered_at > sevenDaysAgo).length,
  });
});

export default router;
