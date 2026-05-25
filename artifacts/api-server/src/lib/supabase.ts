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
  id               BIGSERIAL PRIMARY KEY,
  app_id           TEXT        NOT NULL,
  sub_id           TEXT,
  device_id        TEXT        NOT NULL,
  device_name      TEXT,
  device_model     TEXT,
  android_version  TEXT,
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  last_seen        TIMESTAMPTZ,
  UNIQUE(app_id, device_id)
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

-- Proxy request log
CREATE TABLE IF NOT EXISTS proxy_log (
  id              BIGSERIAL PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  endpoint        TEXT        NOT NULL,
  app_id          TEXT,
  sub_id          TEXT,
  device_id       TEXT,
  ip              TEXT        NOT NULL,
  status          TEXT        NOT NULL,
  reason          TEXT        NOT NULL,
  payload_preview JSONB       NOT NULL DEFAULT '{}'
);
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
