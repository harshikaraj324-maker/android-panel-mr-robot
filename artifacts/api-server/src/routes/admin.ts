import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { db, SETUP_SQL } from "../lib/supabase.js";
import { generateSecret } from "../lib/hmac.js";
import {
  sseClients,
  proxyMemLog, proxyMemStats, resetTodayStats,
  logProxyRequest, checkProxyRules,
  type RequestMeta,
} from "../lib/proxy.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../../../.local/data");

// ── Local auth helpers (password stays local, not in DB) ─────────────────────
function ensureDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readAuth(): { password_hash: string; admin_tokens: string[] } {
  try {
    ensureDir();
    const f = path.join(DATA_DIR, "auth.json");
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {}
  return { password_hash: "", admin_tokens: [] };
}
function writeAuth(data: { password_hash: string; admin_tokens: string[] }) {
  ensureDir();
  fs.writeFileSync(path.join(DATA_DIR, "auth.json"), JSON.stringify(data, null, 2));
}

const DEFAULT_PASSWORD = "admin1234";
function hashPw(pw: string) { return crypto.createHash("sha256").update(pw + "device-admin-salt").digest("hex"); }
function getAuth() {
  const a = readAuth();
  if (!a.password_hash) { a.password_hash = hashPw(DEFAULT_PASSWORD); writeAuth(a); }
  return a;
}
function validateToken(token: string | undefined): boolean {
  if (!token) return false;
  return getAuth().admin_tokens.includes(token);
}
function generateToken() { return crypto.randomBytes(32).toString("hex"); }

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: () => void) {
  if (!validateToken(req.headers["x-admin-token"] as string | undefined)) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  next();
}

// ── DB error handler ──────────────────────────────────────────────────────────
function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // PostgreSQL: 42P01 = undefined_table
  if (error.code === "42P01") return true;
  // PostgREST: schema cache miss
  if (error.message?.includes("Could not find the table") || error.message?.includes("in the schema cache")) return true;
  // PostgREST: relation does not exist
  if (error.message?.includes("relation") && error.message?.includes("does not exist")) return true;
  return false;
}

function dbErr(res: Response, error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (isTableMissing(error)) {
    res.status(503).json({ error: "Database tables not set up yet. Please run the setup from the Dashboard.", needs_setup: true });
    return true;
  }
  res.status(500).json({ error: error.message ?? "DB error" });
  return true;
}

// ── App ID generator ──────────────────────────────────────────────────────────
const WORDS = ["MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","GHOST","HAWK","IRON","JADE","KING","LION","NOVA","ONYX","PRIME","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","CYBER","EAGLE","FLASH","NINJA","ORBIT","SPARK","STORM","TURBO","VAULT","WARP","DARK","HYPER","LASER","METRO","PIXEL","QUARK","ULTRA"];
function rndChars(n: number) { const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:n},()=>c[Math.floor(Math.random()*c.length)]).join(""); }
function generateAppId() { return `${WORDS[Math.floor(Math.random()*WORDS.length)]}-${WORDS[Math.floor(Math.random()*WORDS.length)]}-${rndChars(4)}@${rndChars(3)}`; }

function getIp(req: Request) {
  return ((req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// SSE stream
router.get("/admin/proxy/stream", (req, res) => {
  if (!validateToken(req.query.token as string)) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");   // disable nginx proxy buffering
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  res.write(`event: connected\ndata: {"message":"Stream connected"}\n\n`);
  sseClients.add(res);

  // Heartbeat every 20s so the connection stays alive through idle proxies
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); sseClients.delete(res); }
  }, 20_000);

  req.on("close", () => { clearInterval(heartbeat); sseClients.delete(res); });
});

// Login
router.post("/admin/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) return res.status(400).json({ error: "Password required" });
  const auth = getAuth();
  if (hashPw(password) !== auth.password_hash) return res.status(401).json({ error: "Wrong password" });
  const token = generateToken();
  auth.admin_tokens = [...auth.admin_tokens.slice(-50), token];
  writeAuth(auth);
  res.json({ token });
});

// Logout
router.post("/admin/logout", (req, res) => {
  const token = req.headers["x-admin-token"] as string;
  if (token) { const a = getAuth(); a.admin_tokens = a.admin_tokens.filter((t) => t !== token); writeAuth(a); }
  res.json({ ok: true });
});

// DB setup info
router.get("/admin/db-setup-sql", requireAuth, (_req, res) => {
  res.json({ setup_sql: SETUP_SQL });
});

// Check if DB tables exist
router.get("/admin/db-status", requireAuth, async (_req, res) => {
  const { error } = await db.from("apps").select("id").limit(1);
  const ready = !error;
  res.json({ tables_ready: ready, error: error?.message ?? null, setup_sql: ready ? null : SETUP_SQL });
});

// Auto-run setup SQL
router.post("/admin/run-setup", requireAuth, async (_req, res) => {
  const { runSetupSql } = await import("../lib/supabase.js");
  const result = await runSetupSql();
  if (!result.ok) {
    return res.status(500).json({ ok: false, error: result.error, setup_sql: SETUP_SQL });
  }
  // Verify tables now exist
  const { error: checkErr } = await db.from("apps").select("id").limit(1);
  if (checkErr) return res.json({ ok: false, error: "SQL ran but tables still not found. Try manual method.", setup_sql: SETUP_SQL });
  res.json({ ok: true });
});

// ── Android: Register Device ──────────────────────────────────────────────────
router.post("/register-device", async (req, res) => {
  const body = req.body as { app_id?: string; sub_id?: string; device_id?: string; device_name?: string; device_model?: string; android_version?: string };
  const ip = getIp(req);
  const meta: RequestMeta = { endpoint: "register", app_id: body.app_id, sub_id: body.sub_id, device_id: body.device_id, ip };

  const { allowed, reason } = await checkProxyRules(meta);
  await logProxyRequest({ endpoint: "/api/register-device", app_id: body.app_id ?? null, sub_id: body.sub_id ?? null, device_id: body.device_id ?? null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: body.app_id, device_id: body.device_id, device_name: body.device_name } });

  if (!allowed) return res.status(403).json({ error: reason });
  if (!body.app_id || !body.device_id) return res.status(400).json({ error: "app_id and device_id required" });

  const { data: app } = await db.from("apps").select("*").eq("app_id", body.app_id).eq("status", "active").single();
  if (!app) return res.status(403).json({ error: "Invalid or inactive App ID" });
  if (app.expires_at && new Date(app.expires_at) < new Date()) return res.status(403).json({ error: "App ID expired" });

  const { data: existing } = await db.from("devices").select("*").eq("app_id", body.app_id).eq("device_id", body.device_id).single();
  if (existing) {
    await db.from("devices").update({ last_seen: new Date().toISOString() }).eq("id", existing.id);
    return res.json({ ok: true, device: existing });
  }

  const { data: newDev, error } = await db.from("devices").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, device_id: body.device_id, device_name: body.device_name ?? null, device_model: body.device_model ?? null, android_version: body.android_version ?? null, is_active: true, registered_at: new Date().toISOString(), last_seen: new Date().toISOString() }).select().single();
  if (dbErr(res, error)) return;
  res.status(201).json({ ok: true, device: newDev });
});

// ── Android: Send Message ─────────────────────────────────────────────────────
router.post("/send-message", async (req, res) => {
  const body = req.body as { app_id?: string; sub_id?: string; from_id?: string; content?: string; message_type?: string };
  const ip = getIp(req);
  const meta: RequestMeta = { endpoint: "message", app_id: body.app_id, sub_id: body.sub_id, message_type: body.message_type, ip };

  const { allowed, reason } = await checkProxyRules(meta);
  await logProxyRequest({ endpoint: "/api/send-message", app_id: body.app_id ?? null, sub_id: body.sub_id ?? null, device_id: null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: body.app_id, sub_id: body.sub_id, from_id: body.from_id, message_type: body.message_type, content: String(body.content ?? "").slice(0, 100) } });

  if (!allowed) return res.status(403).json({ error: reason });
  if (!body.app_id || !body.content) return res.status(400).json({ error: "app_id and content required" });

  const { data: app } = await db.from("apps").select("id").eq("app_id", body.app_id).single();
  if (!app) return res.status(403).json({ error: "Invalid App ID" });

  const { error } = await db.from("messages").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, from_id: body.from_id ?? null, content: body.content, message_type: body.message_type ?? "message", is_read: false, sent_at: new Date().toISOString() });
  if (dbErr(res, error)) return;
  res.status(201).json({ ok: true });
});

// ── Android: Submit Form ──────────────────────────────────────────────────────
router.post("/submit-form", async (req, res) => {
  const body = req.body as { app_id?: string; sub_id?: string; form_type?: string; data?: Record<string, unknown> };
  const ip = getIp(req);
  const meta: RequestMeta = { endpoint: "form", app_id: body.app_id, sub_id: body.sub_id, ip };

  const { allowed, reason } = await checkProxyRules(meta);
  await logProxyRequest({ endpoint: "/api/submit-form", app_id: body.app_id ?? null, sub_id: body.sub_id ?? null, device_id: null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: body.app_id, sub_id: body.sub_id, form_type: body.form_type } });

  if (!allowed) return res.status(403).json({ error: reason });
  if (!body.app_id) return res.status(400).json({ error: "app_id required" });

  const { error } = await db.from("form_data").insert({ app_id: body.app_id, sub_id: body.sub_id ?? null, form_type: body.form_type ?? "form", data: body.data ?? {}, submitted_at: new Date().toISOString() });
  if (dbErr(res, error)) return;
  res.status(201).json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// Change password
router.post("/admin/change-password", requireAuth, (req, res) => {
  const { old_password, new_password } = req.body as { old_password?: string; new_password?: string };
  if (!old_password || !new_password) return res.status(400).json({ error: "Both required" });
  const auth = getAuth();
  if (hashPw(old_password) !== auth.password_hash) return res.status(401).json({ error: "Current password wrong hai" });
  if (new_password.length < 4) return res.status(400).json({ error: "Min 4 characters" });
  auth.password_hash = hashPw(new_password);
  auth.admin_tokens = [];
  writeAuth(auth);
  res.json({ ok: true });
});

// Stats
router.get("/admin/stats", requireAuth, async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const d7 = new Date(Date.now() - 7 * 864e5).toISOString();

  const [apps, devices, sessions, messages] = await Promise.all([
    db.from("apps").select("*"),
    db.from("devices").select("*"),
    db.from("admin_sessions").select("*"),
    db.from("messages").select("*"),
  ]);

  if (apps.error?.code === "42P01") {
    return res.json({ total_apps: 0, active_apps: 0, inactive_apps: 0, expired_apps: 0, total_devices: 0, active_devices: 0, recent_devices_7d: 0, total_sessions: 0, active_sessions: 0, unread_messages: 0, proxy_blocked_today: 0, proxy_accepted_today: 0, needs_setup: true });
  }

  const now = new Date().toISOString();
  const appsData = apps.data ?? [];
  const devData = devices.data ?? [];
  const sessData = sessions.data ?? [];
  const msgData = messages.data ?? [];
  resetTodayStats();

  res.json({
    total_apps:        appsData.length,
    active_apps:       appsData.filter((a: { status: string }) => a.status === "active").length,
    inactive_apps:     appsData.filter((a: { status: string }) => a.status !== "active").length,
    expired_apps:      appsData.filter((a: { expires_at: string }) => a.expires_at && a.expires_at < now).length,
    total_devices:     devData.length,
    active_devices:    devData.filter((d: { is_active: boolean }) => d.is_active).length,
    recent_devices_7d: devData.filter((d: { registered_at: string }) => d.registered_at > d7).length,
    total_sessions:    sessData.length,
    active_sessions:   sessData.filter((s: { is_valid: boolean }) => s.is_valid).length,
    unread_messages:   msgData.filter((m: { is_read: boolean }) => !m.is_read).length,
    proxy_blocked_today:  proxyMemStats.todayBlocked,
    proxy_accepted_today: proxyMemStats.todayAccepted,
  });
});

// Generate App ID
router.get("/admin/generate-app-id", requireAuth, async (_req, res) => {
  const { data } = await db.from("apps").select("app_id");
  const existing = new Set((data ?? []).map((a: { app_id: string }) => a.app_id));
  for (let i = 0; i < 20; i++) { const c = generateAppId(); if (!existing.has(c)) return res.json({ app_id: c }); }
  res.json({ app_id: generateAppId() });
});

// ── APP IDs ───────────────────────────────────────────────────────────────────
router.get("/admin/app-ids", requireAuth, async (_req, res) => {
  const { data: apps, error } = await db.from("apps").select("*").order("created_at", { ascending: false });
  if (dbErr(res, error)) return;
  const { data: devices } = await db.from("devices").select("app_id, is_active");
  const { data: sessions } = await db.from("admin_sessions").select("app_id, is_valid");

  const dc: Record<string, { total: number; active: number }> = {};
  const sc: Record<string, number> = {};
  for (const d of devices ?? []) {
    const x = d as { app_id: string; is_active: boolean };
    if (!dc[x.app_id]) dc[x.app_id] = { total: 0, active: 0 };
    dc[x.app_id].total++;
    if (x.is_active) dc[x.app_id].active++;
  }
  for (const s of sessions ?? []) {
    const x = s as { app_id: string; is_valid: boolean };
    if (x.is_valid) sc[x.app_id] = (sc[x.app_id] ?? 0) + 1;
  }
  res.json({ needs_setup: false, rows: (apps ?? []).map((a: { app_id: string }) => ({ ...a, device_count: dc[a.app_id]?.total ?? 0, active_count: dc[a.app_id]?.active ?? 0, active_sessions: sc[a.app_id] ?? 0 })) });
});

router.post("/admin/app-ids", requireAuth, async (req, res) => {
  const { app_id, pin = "1234", name, expires_at } = req.body as { app_id: string; pin?: string; name?: string; expires_at?: string };
  if (!app_id) return res.status(400).json({ error: "app_id required" });
  const secret_key = generateSecret();
  const { data, error } = await db.from("apps").insert({ app_id, name: name ?? null, pin, status: "active", secret_key, signing_required: false, created_at: new Date().toISOString(), expires_at: expires_at ?? new Date(Date.now() + 30 * 864e5).toISOString() }).select().single();
  if (error?.code === "23505") return res.status(409).json({ error: `"${app_id}" already exists` });
  if (dbErr(res, error)) return;
  res.status(201).json(data);
});

// ── Rotate HMAC secret key ─────────────────────────────────────────────────────
router.post("/admin/app-ids/:appId/rotate-secret", requireAuth, async (req, res) => {
  const secret_key = generateSecret();
  const { error } = await db.from("apps").update({ secret_key }).eq("app_id", req.params.appId);
  if (dbErr(res, error)) return;
  res.json({ ok: true, secret_key });
});

// ── Toggle HMAC signing enforcement ───────────────────────────────────────────
router.patch("/admin/app-ids/:appId/signing", requireAuth, async (req, res) => {
  const { signing_required } = req.body as { signing_required: boolean };
  const { error } = await db.from("apps").update({ signing_required: !!signing_required }).eq("app_id", req.params.appId);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.patch("/admin/app-ids/:appId/password", requireAuth, async (req, res) => {
  const { new_password } = req.body as { new_password: string };
  if (!new_password) return res.status(400).json({ error: "new_password required" });
  const { error } = await db.from("apps").update({ pin: new_password }).eq("app_id", req.params.appId);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.post("/admin/app-ids/:appId/reset-password", requireAuth, async (req, res) => {
  const { error } = await db.from("apps").update({ pin: "1234" }).eq("app_id", req.params.appId);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.post("/admin/app-ids/:appId/extend", requireAuth, async (req, res) => {
  const { data: app } = await db.from("apps").select("expires_at").eq("app_id", req.params.appId).single();
  if (!app) return res.status(404).json({ error: "Not found" });
  const base = new Date(Math.max(new Date(app.expires_at).getTime(), Date.now()));
  const expires_at = new Date(base.getTime() + 30 * 864e5).toISOString();
  await db.from("apps").update({ expires_at }).eq("app_id", req.params.appId);
  res.json({ ok: true, expires_at });
});

router.patch("/admin/app-ids/:appId/toggle", requireAuth, async (req, res) => {
  const { status } = req.body as { status: string };
  const { error } = await db.from("apps").update({ status }).eq("app_id", req.params.appId);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.delete("/admin/app-ids/:appId", requireAuth, async (req, res) => {
  const { appId } = req.params;
  await Promise.all([
    db.from("apps").delete().eq("app_id", appId),
    db.from("devices").delete().eq("app_id", appId),
    db.from("admin_sessions").delete().eq("app_id", appId),
    db.from("messages").delete().eq("app_id", appId),
    db.from("form_data").delete().eq("app_id", appId),
  ]);
  res.json({ ok: true });
});

// ── DEVICES ───────────────────────────────────────────────────────────────────
router.get("/admin/devices", requireAuth, async (req, res) => {
  let q = db.from("devices").select("*").order("registered_at", { ascending: false });
  if (req.query.app_id) q = q.eq("app_id", req.query.app_id as string);
  if (req.query.sub_id) q = q.eq("sub_id", req.query.sub_id as string);
  const { data, error } = await q;
  if (dbErr(res, error)) return;
  res.json(data ?? []);
});

router.patch("/admin/devices/:id/toggle", requireAuth, async (req, res) => {
  const { is_active } = req.body as { is_active: boolean };
  const { error } = await db.from("devices").update({ is_active }).eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.delete("/admin/devices/:id", requireAuth, async (req, res) => {
  const { error } = await db.from("devices").delete().eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

// ── SESSIONS ──────────────────────────────────────────────────────────────────
router.get("/admin/sessions", requireAuth, async (req, res) => {
  let q = db.from("admin_sessions").select("*").order("login_time", { ascending: false });
  if (req.query.app_id) q = q.eq("app_id", req.query.app_id as string);
  if (req.query.sub_id) q = q.eq("sub_id", req.query.sub_id as string);
  const { data, error } = await q;
  if (dbErr(res, error)) return;
  res.json(data ?? []);
});

router.post("/admin/sessions/:id/invalidate", requireAuth, async (req, res) => {
  const { error } = await db.from("admin_sessions").update({ is_valid: false }).eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.delete("/admin/sessions/:id", requireAuth, async (req, res) => {
  const { error } = await db.from("admin_sessions").delete().eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.delete("/admin/sessions/app/:appId/all", requireAuth, async (req, res) => {
  await db.from("admin_sessions").delete().eq("app_id", req.params.appId);
  res.json({ ok: true });
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────
router.get("/admin/messages", requireAuth, async (req, res) => {
  let q = db.from("messages").select("*").order("sent_at", { ascending: false });
  if (req.query.app_id) q = q.eq("app_id", req.query.app_id as string);
  if (req.query.sub_id) q = q.eq("sub_id", req.query.sub_id as string);
  const { data, error } = await q;
  if (dbErr(res, error)) return;
  res.json(data ?? []);
});

router.patch("/admin/messages/:id/read", requireAuth, async (req, res) => {
  const { error } = await db.from("messages").update({ is_read: true }).eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.delete("/admin/messages/:id", requireAuth, async (req, res) => {
  const { error } = await db.from("messages").delete().eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

// ── FORM DATA ─────────────────────────────────────────────────────────────────
router.get("/admin/form-data", requireAuth, async (req, res) => {
  let q = db.from("form_data").select("*").order("submitted_at", { ascending: false });
  if (req.query.app_id) q = q.eq("app_id", req.query.app_id as string);
  if (req.query.sub_id) q = q.eq("sub_id", req.query.sub_id as string);
  const { data, error } = await q;
  if (dbErr(res, error)) return;
  res.json(data ?? []);
});

router.delete("/admin/form-data/:id", requireAuth, async (req, res) => {
  const { error } = await db.from("form_data").delete().eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

// ── PROXY RULES ───────────────────────────────────────────────────────────────
router.get("/admin/proxy/rules", requireAuth, async (_req, res) => {
  const { data, error } = await db.from("proxy_rules").select("*").order("created_at", { ascending: false });
  if (dbErr(res, error)) return;
  res.json(data ?? []);
});

router.post("/admin/proxy/rules", requireAuth, async (req, res) => {
  const body = req.body as { action: string; field: string; value: string; endpoints?: string; note?: string };
  if (!body.action || !body.field || !body.value) return res.status(400).json({ error: "action, field, value required" });
  const { data, error } = await db.from("proxy_rules").insert({ action: body.action, field: body.field, value: body.value, endpoints: body.endpoints ?? "all", note: body.note ?? "", created_at: new Date().toISOString() }).select().single();
  if (dbErr(res, error)) return;
  res.status(201).json(data);
});

router.delete("/admin/proxy/rules/:id", requireAuth, async (req, res) => {
  const { error } = await db.from("proxy_rules").delete().eq("id", req.params.id);
  if (dbErr(res, error)) return;
  res.json({ ok: true });
});

router.get("/admin/proxy/log", requireAuth, (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  const entries = statusFilter ? proxyMemLog.filter(e => e.status === statusFilter) : proxyMemLog;
  res.json({
    entries: entries.slice(0, 200),
    total: proxyMemLog.length,
    blocked: proxyMemStats.blocked,
    accepted: proxyMemStats.accepted,
  });
});

router.delete("/admin/proxy/log", requireAuth, (_req, res) => {
  proxyMemLog.splice(0, proxyMemLog.length);
  proxyMemStats.accepted = 0; proxyMemStats.blocked = 0;
  proxyMemStats.todayAccepted = 0; proxyMemStats.todayBlocked = 0;
  res.json({ ok: true });
});

router.get("/admin/proxy/stats", requireAuth, async (_req, res) => {
  resetTodayStats();
  const { count: rules }  = await db.from("proxy_rules").select("*", { count: "exact", head: true });
  const { count: blockR } = await db.from("proxy_rules").select("*", { count: "exact", head: true }).eq("action", "block");
  const { count: allowR } = await db.from("proxy_rules").select("*", { count: "exact", head: true }).eq("action", "allow");
  res.json({
    total: proxyMemLog.length,
    blocked: proxyMemStats.blocked,
    accepted: proxyMemStats.accepted,
    today_total: proxyMemStats.todayAccepted + proxyMemStats.todayBlocked,
    today_blocked: proxyMemStats.todayBlocked,
    today_accepted: proxyMemStats.todayAccepted,
    active_rules: rules ?? 0,
    block_rules: blockR ?? 0,
    allow_rules: allowR ?? 0,
    connected_clients: sseClients.size,
  });
});

export default router;
