import { Router } from "express";
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
  apps: path.join(DATA_DIR, "apps.json"),
  devices: path.join(DATA_DIR, "devices.json"),
  sessions: path.join(DATA_DIR, "sessions.json"),
  formData: path.join(DATA_DIR, "form_data.json"),
  messages: path.join(DATA_DIR, "messages.json"),
  auth: path.join(DATA_DIR, "auth.json"),
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface AppRecord { id: number; app_id: string; name: string | null; pin: string; status: "active" | "inactive" | "disabled"; created_at: string; expires_at: string; }
interface DeviceRecord { id: number; app_id: string; sub_id: string | null; device_id: string; device_name: string | null; device_model: string | null; android_version: string | null; registered_at: string; is_active: boolean; last_seen: string | null; }
interface SessionRecord { id: number; app_id: string; sub_id: string | null; login_time: string; last_active: string; user_agent: string | null; ip: string | null; is_valid: boolean; }
interface MessageRecord { id: number; app_id: string; sub_id: string | null; from_id: string | null; content: string; message_type: string; sent_at: string; is_read: boolean; }
interface AuthData { password_hash: string; admin_tokens: string[]; }

// ── Auth helpers ──────────────────────────────────────────────────────────────
const DEFAULT_PASSWORD = "admin1234";

function hashPw(pw: string): string {
  return crypto.createHash("sha256").update(pw + "device-admin-salt").digest("hex");
}

function getAuth(): AuthData {
  const data = readJson<AuthData>(FILES.auth, { password_hash: "", admin_tokens: [] });
  if (!data.password_hash) {
    data.password_hash = hashPw(DEFAULT_PASSWORD);
    writeJson(FILES.auth, data);
  }
  return data;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function validateToken(token: string | undefined): boolean {
  if (!token) return false;
  const auth = getAuth();
  return auth.admin_tokens.includes(token);
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req: Parameters<typeof router.use>[0], res: Parameters<typeof router.use>[1], next: Parameters<typeof router.use>[2]) {
  const token = (req as { headers: Record<string, string> }).headers["x-admin-token"];
  if (!validateToken(token)) {
    (res as { status: (n: number) => { json: (d: unknown) => void } }).status(401).json({ error: "Unauthorized" });
    return;
  }
  (next as () => void)();
}

// ── App ID generator ──────────────────────────────────────────────────────────
const WORDS = ["MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","GHOST","HAWK","IRON","JADE","KING","LION","NOVA","ONYX","PRIME","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","CYBER","EAGLE","FLASH","NINJA","ORBIT","SPARK","STORM","TURBO","VAULT","WARP","DARK","HYPER","LASER","METRO","PIXEL","QUARK","ULTRA"];
function randomChars(n: number): string { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join(""); }
function generateAppId(): string { return `${WORDS[Math.floor(Math.random()*WORDS.length)]}-${WORDS[Math.floor(Math.random()*WORDS.length)]}-${randomChars(4)}@${randomChars(3)}`; }

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES (no auth needed)
// ═════════════════════════════════════════════════════════════════════════════

// Login
router.post("/admin/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) return res.status(400).json({ error: "Password required" });
  const auth = getAuth();
  if (hashPw(password) !== auth.password_hash) {
    return res.status(401).json({ error: "Wrong password" });
  }
  const token = generateToken();
  auth.admin_tokens = [...auth.admin_tokens.slice(-50), token]; // keep last 50 tokens
  writeJson(FILES.auth, auth);
  res.json({ token });
});

// Logout
router.post("/admin/logout", (req, res) => {
  const token = req.headers["x-admin-token"] as string;
  if (token) {
    const auth = getAuth();
    auth.admin_tokens = auth.admin_tokens.filter((t) => t !== token);
    writeJson(FILES.auth, auth);
  }
  res.json({ ok: true });
});

// Android device registration (public — called by Android apps)
router.post("/api/register-device", (req, res) => {
  const { app_id, sub_id, device_id, device_name, device_model, android_version } = req.body as Partial<DeviceRecord>;
  if (!app_id || !device_id) return res.status(400).json({ error: "app_id and device_id required" });
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const app = apps.find((a) => a.app_id === app_id && a.status === "active");
  if (!app) return res.status(403).json({ error: "Invalid or inactive App ID" });
  if (app.expires_at && new Date(app.expires_at) < new Date()) return res.status(403).json({ error: "App ID expired" });
  const devices = readJson<DeviceRecord[]>(FILES.devices, []);
  const existing = devices.findIndex((d) => d.app_id === app_id && d.device_id === device_id!);
  if (existing >= 0) {
    devices[existing].last_seen = new Date().toISOString();
    writeJson(FILES.devices, devices);
    return res.json({ ok: true, device: devices[existing] });
  }
  const rec: DeviceRecord = { id: nextId(devices), app_id, sub_id: sub_id ?? null, device_id, device_name: device_name ?? null, device_model: device_model ?? null, android_version: android_version ?? null, registered_at: new Date().toISOString(), is_active: true, last_seen: new Date().toISOString() };
  devices.unshift(rec); writeJson(FILES.devices, devices);
  res.status(201).json({ ok: true, device: rec });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES (require x-admin-token header)
// ═════════════════════════════════════════════════════════════════════════════

// Change password
router.post("/admin/change-password", requireAuth, (req, res) => {
  const { old_password, new_password } = req.body as { old_password?: string; new_password?: string };
  if (!old_password || !new_password) return res.status(400).json({ error: "Both old and new password required" });
  const auth = getAuth();
  if (hashPw(old_password) !== auth.password_hash) return res.status(401).json({ error: "Current password wrong hai" });
  if (new_password.length < 4) return res.status(400).json({ error: "Password min 4 characters ka hona chahiye" });
  auth.password_hash = hashPw(new_password);
  auth.admin_tokens = []; // invalidate all sessions on password change
  writeJson(FILES.auth, auth);
  res.json({ ok: true });
});

// Init status
router.get("/admin/init-status", requireAuth, (_req, res) => {
  res.json({ tables_exist: true, has_pat: true });
});

// Stats
router.get("/admin/stats", requireAuth, (_req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const devices = readJson<DeviceRecord[]>(FILES.devices, []);
  const sessions = readJson<SessionRecord[]>(FILES.sessions, []);
  const messages = readJson<MessageRecord[]>(FILES.messages, []);
  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return res.json({
    total_apps: apps.length,
    active_apps: apps.filter((a) => a.status === "active").length,
    inactive_apps: apps.filter((a) => a.status !== "active").length,
    expired_apps: apps.filter((a) => a.expires_at && a.expires_at < now).length,
    total_devices: devices.length,
    active_devices: devices.filter((d) => d.is_active).length,
    recent_devices_7d: devices.filter((d) => d.registered_at > sevenDaysAgo).length,
    total_sessions: sessions.length,
    active_sessions: sessions.filter((s) => s.is_valid).length,
    unread_messages: messages.filter((m) => !m.is_read).length,
  });
});

// Generate App ID
router.get("/admin/generate-app-id", requireAuth, (_req, res) => {
  const existing = new Set(readJson<AppRecord[]>(FILES.apps, []).map((a) => a.app_id));
  for (let i = 0; i < 20; i++) { const c = generateAppId(); if (!existing.has(c)) return res.json({ app_id: c }); }
  res.json({ app_id: generateAppId() });
});

// ── APPS ──────────────────────────────────────────────────────────────────────
router.get("/admin/app-ids", requireAuth, (_req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const devices = readJson<DeviceRecord[]>(FILES.devices, []);
  const sessions = readJson<SessionRecord[]>(FILES.sessions, []);
  const counts: Record<string, { total: number; active: number }> = {};
  const sessCounts: Record<string, number> = {};
  for (const d of devices) { if (!counts[d.app_id]) counts[d.app_id] = { total: 0, active: 0 }; counts[d.app_id].total++; if (d.is_active) counts[d.app_id].active++; }
  for (const s of sessions) { if (s.is_valid) sessCounts[s.app_id] = (sessCounts[s.app_id] ?? 0) + 1; }
  res.json({ needs_setup: false, rows: apps.map((a) => ({ ...a, device_count: counts[a.app_id]?.total ?? 0, active_count: counts[a.app_id]?.active ?? 0, active_sessions: sessCounts[a.app_id] ?? 0 })) });
});

router.post("/admin/app-ids", requireAuth, (req, res) => {
  const { app_id, pin = "1234", name, expires_at } = req.body as { app_id: string; pin?: string; name?: string; expires_at?: string };
  if (!app_id) return res.status(400).json({ error: "app_id required" });
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  if (apps.some((a) => a.app_id === app_id)) return res.status(409).json({ error: `"${app_id}" already exists` });
  const rec: AppRecord = { id: nextId(apps), app_id, name: name ?? null, pin, status: "active", created_at: new Date().toISOString(), expires_at: expires_at ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
  apps.unshift(rec); writeJson(FILES.apps, apps); res.status(201).json(rec);
});

router.patch("/admin/app-ids/:appId/password", requireAuth, (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const { new_password } = req.body as { new_password: string };
  if (!new_password) return res.status(400).json({ error: "new_password required" });
  apps[idx].pin = new_password; writeJson(FILES.apps, apps); res.json({ ok: true });
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
  const newExpiry = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  apps[idx].expires_at = newExpiry; writeJson(FILES.apps, apps); res.json({ ok: true, expires_at: newExpiry });
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
  writeJson(FILES.apps, readJson<AppRecord[]>(FILES.apps, []).filter((a) => a.app_id !== appId));
  writeJson(FILES.devices, readJson<DeviceRecord[]>(FILES.devices, []).filter((d) => d.app_id !== appId));
  writeJson(FILES.sessions, readJson<SessionRecord[]>(FILES.sessions, []).filter((s) => s.app_id !== appId));
  writeJson(FILES.messages, readJson<MessageRecord[]>(FILES.messages, []).filter((m) => m.app_id !== appId));
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

// ── MESSAGES (read-only view — data comes from Android apps) ─────────────────
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

// Android app sends message TO admin (public endpoint)
router.post("/api/send-message", (req, res) => {
  const { app_id, sub_id, from_id, content, message_type } = req.body as Partial<MessageRecord>;
  if (!app_id || !content) return res.status(400).json({ error: "app_id and content required" });
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  if (!apps.some((a) => a.app_id === app_id)) return res.status(403).json({ error: "Invalid App ID" });
  const data = readJson<MessageRecord[]>(FILES.messages, []);
  const rec: MessageRecord = { id: nextId(data), app_id, sub_id: sub_id ?? null, from_id: from_id ?? null, content, message_type: message_type ?? "message", sent_at: new Date().toISOString(), is_read: false };
  data.unshift(rec); writeJson(FILES.messages, data); res.status(201).json({ ok: true });
});

// ── FORM DATA ─────────────────────────────────────────────────────────────────
router.get("/admin/form-data", requireAuth, (req, res) => {
  interface FormDataRecord { id: number; app_id: string; sub_id: string | null; form_type: string; data: Record<string, unknown>; submitted_at: string; }
  let data = readJson<FormDataRecord[]>(path.join(DATA_DIR, "form_data.json"), []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((f) => f.app_id === app_id);
  if (sub_id) data = data.filter((f) => f.sub_id === sub_id);
  res.json(data);
});

router.delete("/admin/form-data/:id", requireAuth, (req, res) => {
  interface FormDataRecord { id: number; }
  const file = path.join(DATA_DIR, "form_data.json");
  writeJson(file, readJson<FormDataRecord[]>(file, []).filter((f) => f.id !== Number(req.params.id)));
  res.json({ ok: true });
});

export default router;
