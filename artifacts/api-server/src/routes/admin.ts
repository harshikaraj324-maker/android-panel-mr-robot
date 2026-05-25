import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../../../.local/data");

// ── JSON helpers ──────────────────────────────────────────────────────────────
function ensureDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJson<T>(file: string, fallback: T): T {
  try { ensureDir(); if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch {}
  return fallback;
}
function writeJson(file: string, data: unknown) {
  ensureDir(); fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
function nextId(arr: { id: number }[]): number {
  return arr.length === 0 ? 1 : Math.max(...arr.map((r) => r.id)) + 1;
}

const FILES = {
  apps:       path.join(DATA_DIR, "apps.json"),
  devices:    path.join(DATA_DIR, "devices.json"),
  sessions:   path.join(DATA_DIR, "sessions.json"),
  formData:   path.join(DATA_DIR, "form_data.json"),
  messages:   path.join(DATA_DIR, "messages.json"),
  auth:       path.join(DATA_DIR, "auth.json"),
  proxyRules: path.join(DATA_DIR, "proxy_rules.json"),
  proxyLog:   path.join(DATA_DIR, "proxy_log.json"),
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface AppRecord    { id: number; app_id: string; name: string | null; pin: string; status: "active" | "inactive" | "disabled"; created_at: string; expires_at: string; }
interface DeviceRecord { id: number; app_id: string; sub_id: string | null; device_id: string; device_name: string | null; device_model: string | null; android_version: string | null; registered_at: string; is_active: boolean; last_seen: string | null; }
interface SessionRecord{ id: number; app_id: string; sub_id: string | null; login_time: string; last_active: string; user_agent: string | null; ip: string | null; is_valid: boolean; }
interface MessageRecord{ id: number; app_id: string; sub_id: string | null; from_id: string | null; content: string; message_type: string; sent_at: string; is_read: boolean; }
interface AuthData     { password_hash: string; admin_tokens: string[]; }

export interface ProxyRule {
  id: number;
  action: "block" | "allow";            // block = blacklist this; allow = whitelist only this
  field: "app_id" | "sub_id" | "ip" | "message_type" | "device_id" | "all";
  value: string;                         // exact match or "*" for all
  endpoints: "all" | "register" | "message" | "form";
  note: string;
  created_at: string;
}

export interface ProxyLogEntry {
  id: number;
  timestamp: string;
  endpoint: string;
  app_id: string | null;
  sub_id: string | null;
  device_id: string | null;
  ip: string;
  status: "accepted" | "blocked";
  reason: string;
  payload_preview: Record<string, unknown>;
}

// ── SSE clients ───────────────────────────────────────────────────────────────
const sseClients = new Set<Response>();

function broadcastSSE(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
const DEFAULT_PASSWORD = "admin1234";
function hashPw(pw: string): string {
  return crypto.createHash("sha256").update(pw + "device-admin-salt").digest("hex");
}
function getAuth(): AuthData {
  const data = readJson<AuthData>(FILES.auth, { password_hash: "", admin_tokens: [] });
  if (!data.password_hash) { data.password_hash = hashPw(DEFAULT_PASSWORD); writeJson(FILES.auth, data); }
  return data;
}
function generateToken() { return crypto.randomBytes(32).toString("hex"); }
function validateToken(token: string | undefined): boolean {
  if (!token) return false;
  return getAuth().admin_tokens.includes(token);
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: () => void) {
  const token = req.headers["x-admin-token"] as string | undefined;
  if (!validateToken(token)) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

// ── Proxy rule checker ────────────────────────────────────────────────────────
interface RequestMeta {
  endpoint: "register" | "message" | "form";
  app_id?: string;
  sub_id?: string;
  device_id?: string;
  message_type?: string;
  ip: string;
}

function checkProxyRules(meta: RequestMeta): { allowed: boolean; reason: string } {
  const rules = readJson<ProxyRule[]>(FILES.proxyRules, []);

  // Separate block and allow rules
  const blockRules = rules.filter((r) => r.action === "block");
  const allowRules = rules.filter((r) => r.action === "allow");

  function matchesRule(r: ProxyRule): boolean {
    if (r.endpoints !== "all" && r.endpoints !== meta.endpoint) return false;
    if (r.field === "all") return true;
    const val = r.value === "*" ? true : (() => {
      switch (r.field) {
        case "app_id":      return meta.app_id === r.value;
        case "sub_id":      return meta.sub_id === r.value;
        case "device_id":   return meta.device_id === r.value;
        case "message_type":return meta.message_type === r.value;
        case "ip":          return meta.ip === r.value;
        default:            return false;
      }
    })();
    return val === true || val;
  }

  // 1. Check block rules first
  for (const r of blockRules) {
    if (matchesRule(r)) {
      return { allowed: false, reason: `Blocked by rule #${r.id}: ${r.field}=${r.value}${r.note ? ` (${r.note})` : ""}` };
    }
  }

  // 2. If there are allow rules for this endpoint, request must match at least one
  const relevantAllowRules = allowRules.filter((r) => r.endpoints === "all" || r.endpoints === meta.endpoint);
  if (relevantAllowRules.length > 0) {
    const matched = relevantAllowRules.some((r) => matchesRule(r));
    if (!matched) {
      return { allowed: false, reason: `Whitelist mode: no allow rule matched for ${meta.endpoint}` };
    }
  }

  return { allowed: true, reason: "accepted" };
}

// ── Log incoming request ──────────────────────────────────────────────────────
function logRequest(entry: Omit<ProxyLogEntry, "id">) {
  const log = readJson<ProxyLogEntry[]>(FILES.proxyLog, []);
  const rec = { id: nextId(log), ...entry };
  log.unshift(rec);
  // Keep last 500 entries
  writeJson(FILES.proxyLog, log.slice(0, 500));
  broadcastSSE("proxy-event", rec);
}

// ── App ID generator ──────────────────────────────────────────────────────────
const WORDS = ["MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","GHOST","HAWK","IRON","JADE","KING","LION","NOVA","ONYX","PRIME","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","CYBER","EAGLE","FLASH","NINJA","ORBIT","SPARK","STORM","TURBO","VAULT","WARP","DARK","HYPER","LASER","METRO","PIXEL","QUARK","ULTRA"];
function randomChars(n: number) { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: n }, () => c[Math.floor(Math.random()*c.length)]).join(""); }
function generateAppId() { return `${WORDS[Math.floor(Math.random()*WORDS.length)]}-${WORDS[Math.floor(Math.random()*WORDS.length)]}-${randomChars(4)}@${randomChars(3)}`; }

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ── SSE stream (token via query param since EventSource can't set headers) ───
router.get("/admin/proxy/stream", (req, res) => {
  const token = req.query.token as string | undefined;
  if (!validateToken(token)) { res.status(401).json({ error: "Unauthorized" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send initial ping
  res.write(`event: connected\ndata: {"message":"Stream connected"}\n\n`);

  sseClients.add(res);

  req.on("close", () => { sseClients.delete(res); });
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post("/admin/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) return res.status(400).json({ error: "Password required" });
  const auth = getAuth();
  if (hashPw(password) !== auth.password_hash) return res.status(401).json({ error: "Wrong password" });
  const token = generateToken();
  auth.admin_tokens = [...auth.admin_tokens.slice(-50), token];
  writeJson(FILES.auth, auth);
  res.json({ token });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/admin/logout", (req, res) => {
  const token = req.headers["x-admin-token"] as string;
  if (token) { const auth = getAuth(); auth.admin_tokens = auth.admin_tokens.filter((t) => t !== token); writeJson(FILES.auth, auth); }
  res.json({ ok: true });
});

// ── Android: Register Device (through proxy) ─────────────────────────────────
router.post("/register-device", (req, res) => {
  const body = req.body as Partial<DeviceRecord>;
  const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const meta: RequestMeta = { endpoint: "register", app_id: body.app_id, sub_id: body.sub_id ?? undefined, device_id: body.device_id, ip };

  const { allowed, reason } = checkProxyRules(meta);
  logRequest({ timestamp: new Date().toISOString(), endpoint: "/api/register-device", app_id: body.app_id ?? null, sub_id: body.sub_id ?? null, device_id: body.device_id ?? null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: body.app_id, device_id: body.device_id, device_name: body.device_name, device_model: body.device_model } });

  if (!allowed) return res.status(403).json({ error: reason });

  const { app_id, sub_id, device_id, device_name, device_model, android_version } = body;
  if (!app_id || !device_id) return res.status(400).json({ error: "app_id and device_id required" });

  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const app = apps.find((a) => a.app_id === app_id && a.status === "active");
  if (!app) return res.status(403).json({ error: "Invalid or inactive App ID" });
  if (app.expires_at && new Date(app.expires_at) < new Date()) return res.status(403).json({ error: "App ID expired" });

  const devices = readJson<DeviceRecord[]>(FILES.devices, []);
  const existing = devices.findIndex((d) => d.app_id === app_id && d.device_id === device_id);
  if (existing >= 0) {
    devices[existing].last_seen = new Date().toISOString();
    writeJson(FILES.devices, devices);
    return res.json({ ok: true, device: devices[existing] });
  }
  const rec: DeviceRecord = { id: nextId(devices), app_id, sub_id: sub_id ?? null, device_id, device_name: device_name ?? null, device_model: device_model ?? null, android_version: android_version ?? null, registered_at: new Date().toISOString(), is_active: true, last_seen: new Date().toISOString() };
  devices.unshift(rec); writeJson(FILES.devices, devices);
  res.status(201).json({ ok: true, device: rec });
});

// ── Android: Send Message (through proxy) ────────────────────────────────────
router.post("/send-message", (req, res) => {
  const body = req.body as Partial<MessageRecord>;
  const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const meta: RequestMeta = { endpoint: "message", app_id: body.app_id, sub_id: body.sub_id ?? undefined, message_type: body.message_type, ip };

  const { allowed, reason } = checkProxyRules(meta);
  logRequest({ timestamp: new Date().toISOString(), endpoint: "/api/send-message", app_id: body.app_id ?? null, sub_id: body.sub_id ?? null, device_id: null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: body.app_id, sub_id: body.sub_id, from_id: body.from_id, message_type: body.message_type, content: String(body.content ?? "").slice(0, 100) } });

  if (!allowed) return res.status(403).json({ error: reason });

  const { app_id, sub_id, from_id, content, message_type } = body;
  if (!app_id || !content) return res.status(400).json({ error: "app_id and content required" });

  const apps = readJson<AppRecord[]>(FILES.apps, []);
  if (!apps.some((a) => a.app_id === app_id)) return res.status(403).json({ error: "Invalid App ID" });

  const data = readJson<MessageRecord[]>(FILES.messages, []);
  const rec: MessageRecord = { id: nextId(data), app_id, sub_id: sub_id ?? null, from_id: from_id ?? null, content, message_type: message_type ?? "message", sent_at: new Date().toISOString(), is_read: false };
  data.unshift(rec); writeJson(FILES.messages, data);
  res.status(201).json({ ok: true });
});

// ── Android: Submit Form Data (through proxy) ─────────────────────────────────
router.post("/submit-form", (req, res) => {
  interface FormBody { app_id?: string; sub_id?: string; form_type?: string; data?: Record<string, unknown>; }
  const body = req.body as FormBody;
  const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const meta: RequestMeta = { endpoint: "form", app_id: body.app_id, sub_id: body.sub_id, ip };

  const { allowed, reason } = checkProxyRules(meta);
  logRequest({ timestamp: new Date().toISOString(), endpoint: "/api/submit-form", app_id: body.app_id ?? null, sub_id: body.sub_id ?? null, device_id: null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: body.app_id, sub_id: body.sub_id, form_type: body.form_type } });

  if (!allowed) return res.status(403).json({ error: reason });

  const { app_id, sub_id, form_type, data: formData } = body;
  if (!app_id) return res.status(400).json({ error: "app_id required" });

  interface FormDataRecord { id: number; app_id: string; sub_id: string | null; form_type: string; data: Record<string, unknown>; submitted_at: string; }
  const records = readJson<FormDataRecord[]>(FILES.formData, []);
  const rec: FormDataRecord = { id: nextId(records), app_id, sub_id: sub_id ?? null, form_type: form_type ?? "form", data: formData ?? {}, submitted_at: new Date().toISOString() };
  records.unshift(rec); writeJson(FILES.formData, records);
  res.status(201).json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES
// ═════════════════════════════════════════════════════════════════════════════

router.post("/admin/change-password", requireAuth, (req, res) => {
  const { old_password, new_password } = req.body as { old_password?: string; new_password?: string };
  if (!old_password || !new_password) return res.status(400).json({ error: "Both required" });
  const auth = getAuth();
  if (hashPw(old_password) !== auth.password_hash) return res.status(401).json({ error: "Current password wrong hai" });
  if (new_password.length < 4) return res.status(400).json({ error: "Min 4 characters" });
  auth.password_hash = hashPw(new_password);
  auth.admin_tokens = [];
  writeJson(FILES.auth, auth);
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get("/admin/stats", requireAuth, (_req, res) => {
  const apps     = readJson<AppRecord[]>(FILES.apps, []);
  const devices  = readJson<DeviceRecord[]>(FILES.devices, []);
  const sessions = readJson<SessionRecord[]>(FILES.sessions, []);
  const messages = readJson<MessageRecord[]>(FILES.messages, []);
  const log      = readJson<ProxyLogEntry[]>(FILES.proxyLog, []);
  const now      = new Date().toISOString();
  const d7       = new Date(Date.now() - 7 * 864e5).toISOString();
  res.json({
    total_apps: apps.length, active_apps: apps.filter((a) => a.status === "active").length,
    inactive_apps: apps.filter((a) => a.status !== "active").length,
    expired_apps: apps.filter((a) => a.expires_at && a.expires_at < now).length,
    total_devices: devices.length, active_devices: devices.filter((d) => d.is_active).length,
    recent_devices_7d: devices.filter((d) => d.registered_at > d7).length,
    total_sessions: sessions.length, active_sessions: sessions.filter((s) => s.is_valid).length,
    unread_messages: messages.filter((m) => !m.is_read).length,
    proxy_blocked_today: log.filter((l) => l.status === "blocked" && l.timestamp > new Date().toISOString().slice(0, 10)).length,
    proxy_accepted_today: log.filter((l) => l.status === "accepted" && l.timestamp > new Date().toISOString().slice(0, 10)).length,
  });
});

// ── Generate App ID ───────────────────────────────────────────────────────────
router.get("/admin/generate-app-id", requireAuth, (_req, res) => {
  const existing = new Set(readJson<AppRecord[]>(FILES.apps, []).map((a) => a.app_id));
  for (let i = 0; i < 20; i++) { const c = generateAppId(); if (!existing.has(c)) return res.json({ app_id: c }); }
  res.json({ app_id: generateAppId() });
});

// ── PROXY RULES ───────────────────────────────────────────────────────────────
router.get("/admin/proxy/rules", requireAuth, (_req, res) => {
  res.json(readJson<ProxyRule[]>(FILES.proxyRules, []));
});

router.post("/admin/proxy/rules", requireAuth, (req, res) => {
  const body = req.body as Omit<ProxyRule, "id" | "created_at">;
  if (!body.action || !body.field || !body.value) return res.status(400).json({ error: "action, field, value required" });
  const rules = readJson<ProxyRule[]>(FILES.proxyRules, []);
  const rec: ProxyRule = { id: nextId(rules), action: body.action, field: body.field, value: body.value, endpoints: body.endpoints ?? "all", note: body.note ?? "", created_at: new Date().toISOString() };
  rules.push(rec);
  writeJson(FILES.proxyRules, rules);
  res.status(201).json(rec);
});

router.delete("/admin/proxy/rules/:id", requireAuth, (req, res) => {
  const rules = readJson<ProxyRule[]>(FILES.proxyRules, []);
  writeJson(FILES.proxyRules, rules.filter((r) => r.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.get("/admin/proxy/log", requireAuth, (req, res) => {
  const log = readJson<ProxyLogEntry[]>(FILES.proxyLog, []);
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  const status = req.query.status as string | undefined;
  const filtered = status ? log.filter((l) => l.status === status) : log;
  res.json({ entries: filtered.slice(0, limit), total: log.length, blocked: log.filter((l) => l.status === "blocked").length, accepted: log.filter((l) => l.status === "accepted").length });
});

router.delete("/admin/proxy/log", requireAuth, (_req, res) => {
  writeJson(FILES.proxyLog, []);
  res.json({ ok: true });
});

router.get("/admin/proxy/stats", requireAuth, (_req, res) => {
  const log = readJson<ProxyLogEntry[]>(FILES.proxyLog, []);
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = log.filter((l) => l.timestamp.startsWith(today));
  const rules = readJson<ProxyRule[]>(FILES.proxyRules, []);
  res.json({
    total: log.length, blocked: log.filter((l) => l.status === "blocked").length, accepted: log.filter((l) => l.status === "accepted").length,
    today_total: todayLog.length, today_blocked: todayLog.filter((l) => l.status === "blocked").length, today_accepted: todayLog.filter((l) => l.status === "accepted").length,
    active_rules: rules.length, block_rules: rules.filter((r) => r.action === "block").length, allow_rules: rules.filter((r) => r.action === "allow").length,
    connected_clients: sseClients.size,
  });
});

// ── APP IDs ───────────────────────────────────────────────────────────────────
router.get("/admin/app-ids", requireAuth, (_req, res) => {
  const apps    = readJson<AppRecord[]>(FILES.apps, []);
  const devices = readJson<DeviceRecord[]>(FILES.devices, []);
  const sessions= readJson<SessionRecord[]>(FILES.sessions, []);
  const dc: Record<string, { total: number; active: number }> = {};
  const sc: Record<string, number> = {};
  for (const d of devices) { if (!dc[d.app_id]) dc[d.app_id] = { total: 0, active: 0 }; dc[d.app_id].total++; if (d.is_active) dc[d.app_id].active++; }
  for (const s of sessions) { if (s.is_valid) sc[s.app_id] = (sc[s.app_id] ?? 0) + 1; }
  res.json({ needs_setup: false, rows: apps.map((a) => ({ ...a, device_count: dc[a.app_id]?.total ?? 0, active_count: dc[a.app_id]?.active ?? 0, active_sessions: sc[a.app_id] ?? 0 })) });
});

router.post("/admin/app-ids", requireAuth, (req, res) => {
  const { app_id, pin = "1234", name, expires_at } = req.body as { app_id: string; pin?: string; name?: string; expires_at?: string };
  if (!app_id) return res.status(400).json({ error: "app_id required" });
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  if (apps.some((a) => a.app_id === app_id)) return res.status(409).json({ error: `"${app_id}" already exists` });
  const rec: AppRecord = { id: nextId(apps), app_id, name: name ?? null, pin, status: "active", created_at: new Date().toISOString(), expires_at: expires_at ?? new Date(Date.now() + 30*864e5).toISOString() };
  apps.unshift(rec); writeJson(FILES.apps, apps); res.status(201).json(rec);
});

router.patch("/admin/app-ids/:appId/password", requireAuth, (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  apps[idx].pin = (req.body as { new_password: string }).new_password;
  writeJson(FILES.apps, apps); res.json({ ok: true });
});

router.post("/admin/app-ids/:appId/reset-password", requireAuth, (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  apps[idx].pin = "1234"; writeJson(FILES.apps, apps); res.json({ ok: true });
});

router.post("/admin/app-ids/:appId/extend", requireAuth, (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const base = new Date(Math.max(new Date(apps[idx].expires_at).getTime(), Date.now()));
  apps[idx].expires_at = new Date(base.getTime() + 30*864e5).toISOString();
  writeJson(FILES.apps, apps); res.json({ ok: true, expires_at: apps[idx].expires_at });
});

router.patch("/admin/app-ids/:appId/toggle", requireAuth, (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  apps[idx].status = (req.body as { status: string }).status as AppRecord["status"];
  writeJson(FILES.apps, apps); res.json({ ok: true });
});

router.delete("/admin/app-ids/:appId", requireAuth, (req, res) => {
  const { appId } = req.params;
  writeJson(FILES.apps,    readJson<AppRecord[]>(FILES.apps, []).filter((a) => a.app_id !== appId));
  writeJson(FILES.devices, readJson<DeviceRecord[]>(FILES.devices, []).filter((d) => d.app_id !== appId));
  writeJson(FILES.sessions,readJson<SessionRecord[]>(FILES.sessions, []).filter((s) => s.app_id !== appId));
  writeJson(FILES.messages,readJson<MessageRecord[]>(FILES.messages, []).filter((m) => m.app_id !== appId));
  res.json({ ok: true });
});

// ── DEVICES ───────────────────────────────────────────────────────────────────
router.get("/admin/devices", requireAuth, (req, res) => {
  let data = readJson<DeviceRecord[]>(FILES.devices, []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((d) => d.app_id === app_id);
  if (sub_id) data = data.filter((d) => d.sub_id === sub_id);
  res.json(data);
});

router.patch("/admin/devices/:id/toggle", requireAuth, (req, res) => {
  const data = readJson<DeviceRecord[]>(FILES.devices, []);
  const idx = data.findIndex((d) => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx].is_active = (req.body as { is_active: boolean }).is_active;
  writeJson(FILES.devices, data); res.json({ ok: true });
});

router.delete("/admin/devices/:id", requireAuth, (req, res) => {
  writeJson(FILES.devices, readJson<DeviceRecord[]>(FILES.devices, []).filter((d) => d.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ── SESSIONS ──────────────────────────────────────────────────────────────────
router.get("/admin/sessions", requireAuth, (req, res) => {
  let data = readJson<SessionRecord[]>(FILES.sessions, []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((s) => s.app_id === app_id);
  if (sub_id) data = data.filter((s) => s.sub_id === sub_id);
  res.json(data);
});

router.delete("/admin/sessions/:id", requireAuth, (req, res) => {
  writeJson(FILES.sessions, readJson<SessionRecord[]>(FILES.sessions, []).filter((s) => s.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.post("/admin/sessions/:id/invalidate", requireAuth, (req, res) => {
  const data = readJson<SessionRecord[]>(FILES.sessions, []);
  const idx = data.findIndex((s) => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx].is_valid = false; writeJson(FILES.sessions, data); res.json({ ok: true });
});

router.delete("/admin/sessions/app/:appId/all", requireAuth, (req, res) => {
  writeJson(FILES.sessions, readJson<SessionRecord[]>(FILES.sessions, []).filter((s) => s.app_id !== req.params.appId));
  res.json({ ok: true });
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────
router.get("/admin/messages", requireAuth, (req, res) => {
  let data = readJson<MessageRecord[]>(FILES.messages, []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((m) => m.app_id === app_id);
  if (sub_id) data = data.filter((m) => m.sub_id === sub_id);
  res.json(data);
});

router.patch("/admin/messages/:id/read", requireAuth, (req, res) => {
  const data = readJson<MessageRecord[]>(FILES.messages, []);
  const idx = data.findIndex((m) => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx].is_read = true; writeJson(FILES.messages, data); res.json({ ok: true });
});

router.delete("/admin/messages/:id", requireAuth, (req, res) => {
  writeJson(FILES.messages, readJson<MessageRecord[]>(FILES.messages, []).filter((m) => m.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ── FORM DATA ─────────────────────────────────────────────────────────────────
router.get("/admin/form-data", requireAuth, (req, res) => {
  interface FormDataRecord { id: number; app_id: string; sub_id: string | null; form_type: string; data: Record<string, unknown>; submitted_at: string; }
  let data = readJson<FormDataRecord[]>(FILES.formData, []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((f) => f.app_id === app_id);
  if (sub_id) data = data.filter((f) => f.sub_id === sub_id);
  res.json(data);
});

router.delete("/admin/form-data/:id", requireAuth, (req, res) => {
  interface FormDataRecord { id: number; }
  writeJson(FILES.formData, readJson<FormDataRecord[]>(FILES.formData, []).filter((f) => f.id !== Number(req.params.id)));
  res.json({ ok: true });
});

export default router;
