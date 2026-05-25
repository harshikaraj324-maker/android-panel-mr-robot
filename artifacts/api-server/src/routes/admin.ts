import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../../../.local/data");

// ── JSON file helpers ─────────────────────────────────────────────────────────
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

// ── File paths ────────────────────────────────────────────────────────────────
const FILES = {
  apps: path.join(DATA_DIR, "apps.json"),
  devices: path.join(DATA_DIR, "devices.json"),
  sessions: path.join(DATA_DIR, "sessions.json"),
  formData: path.join(DATA_DIR, "form_data.json"),
  messages: path.join(DATA_DIR, "messages.json"),
  settings: path.join(DATA_DIR, "settings.json"),
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface AppRecord { id: number; app_id: string; name: string | null; pin: string; status: "active" | "inactive" | "disabled"; created_at: string; expires_at: string; }
interface DeviceRecord { id: number; app_id: string; sub_id: string | null; device_id: string; device_name: string | null; device_model: string | null; android_version: string | null; registered_at: string; is_active: boolean; last_seen: string | null; }
interface SessionRecord { id: number; app_id: string; sub_id: string | null; login_time: string; last_active: string; user_agent: string | null; ip: string | null; is_valid: boolean; }
interface FormDataRecord { id: number; app_id: string; sub_id: string | null; form_type: string; data: Record<string, unknown>; submitted_at: string; }
interface MessageRecord { id: number; app_id: string; sub_id: string | null; from_id: string | null; content: string; message_type: string; sent_at: string; is_read: boolean; }
interface SettingRecord { id: number; app_id: string; key: string; value: string; updated_at: string; }

// ── App ID generator ──────────────────────────────────────────────────────────
const WORDS = ["MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","GHOST","HAWK","IRON","JADE","KING","LION","NOVA","ONYX","PRIME","RAVEN","SIGMA","TITAN","VIPER","WOLF","ZERO","BLAZE","CYBER","EAGLE","FLASH","NINJA","ORBIT","SPARK","STORM","TURBO","VAULT","WARP","DARK","HYPER","LASER","METRO","PIXEL","QUARK","ULTRA"];
function randomChars(n: number): string { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join(""); }
function generateAppId(): string { return `${WORDS[Math.floor(Math.random()*WORDS.length)]}-${WORDS[Math.floor(Math.random()*WORDS.length)]}-${randomChars(4)}@${randomChars(3)}`; }

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN INIT STATUS
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/init-status", (_req, res) => {
  res.json({ tables_exist: true, has_pat: true, app_ids_error: null, devices_error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/stats", (_req, res) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE APP ID
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/generate-app-id", (_req, res) => {
  const existing = new Set(readJson<AppRecord[]>(FILES.apps, []).map((a) => a.app_id));
  for (let i = 0; i < 20; i++) { const c = generateAppId(); if (!existing.has(c)) return res.json({ app_id: c }); }
  res.json({ app_id: generateAppId() });
});

// ─────────────────────────────────────────────────────────────────────────────
// APPS (was app-ids)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/app-ids", (_req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const devices = readJson<DeviceRecord[]>(FILES.devices, []);
  const sessions = readJson<SessionRecord[]>(FILES.sessions, []);
  const counts: Record<string, { total: number; active: number }> = {};
  const sessCounts: Record<string, number> = {};
  for (const d of devices) { if (!counts[d.app_id]) counts[d.app_id] = { total: 0, active: 0 }; counts[d.app_id].total++; if (d.is_active) counts[d.app_id].active++; }
  for (const s of sessions) { if (s.is_valid) sessCounts[s.app_id] = (sessCounts[s.app_id] ?? 0) + 1; }
  res.json({ needs_setup: false, rows: apps.map((a) => ({ ...a, device_count: counts[a.app_id]?.total ?? 0, active_count: counts[a.app_id]?.active ?? 0, active_sessions: sessCounts[a.app_id] ?? 0 })) });
});

router.post("/admin/app-ids", (req, res) => {
  const { app_id, pin = "1234", name, expires_at } = req.body as { app_id: string; pin?: string; name?: string; expires_at?: string };
  if (!app_id) return res.status(400).json({ error: "app_id required" });
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  if (apps.some((a) => a.app_id === app_id)) return res.status(409).json({ error: `"${app_id}" already exists` });
  const rec: AppRecord = { id: nextId(apps), app_id, name: name ?? null, pin, status: "active", created_at: new Date().toISOString(), expires_at: expires_at ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
  apps.unshift(rec); writeJson(FILES.apps, apps);
  res.status(201).json(rec);
});

router.patch("/admin/app-ids/:appId/password", (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const { new_password } = req.body as { new_password: string };
  if (!new_password) return res.status(400).json({ error: "new_password required" });
  apps[idx].pin = new_password; writeJson(FILES.apps, apps); res.json({ ok: true });
});

router.post("/admin/app-ids/:appId/reset-password", (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  apps[idx].pin = "1234"; writeJson(FILES.apps, apps); res.json({ ok: true });
});

router.post("/admin/app-ids/:appId/extend", (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const base = new Date(Math.max(new Date(apps[idx].expires_at).getTime(), Date.now()));
  const newExpiry = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  apps[idx].expires_at = newExpiry; writeJson(FILES.apps, apps); res.json({ ok: true, expires_at: newExpiry });
});

router.patch("/admin/app-ids/:appId/toggle", (req, res) => {
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const idx = apps.findIndex((a) => a.app_id === req.params.appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const { status } = req.body as { status: string };
  apps[idx].status = status as AppRecord["status"]; writeJson(FILES.apps, apps); res.json({ ok: true });
});

router.delete("/admin/app-ids/:appId", (req, res) => {
  const { appId } = req.params;
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  writeJson(FILES.apps, apps.filter((a) => a.app_id !== appId));
  writeJson(FILES.devices, readJson<DeviceRecord[]>(FILES.devices, []).filter((d) => d.app_id !== appId));
  writeJson(FILES.sessions, readJson<SessionRecord[]>(FILES.sessions, []).filter((s) => s.app_id !== appId));
  writeJson(FILES.formData, readJson<FormDataRecord[]>(FILES.formData, []).filter((f) => f.app_id !== appId));
  writeJson(FILES.messages, readJson<MessageRecord[]>(FILES.messages, []).filter((m) => m.app_id !== appId));
  writeJson(FILES.settings, readJson<SettingRecord[]>(FILES.settings, []).filter((s) => s.app_id !== appId));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEVICES
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/devices", (req, res) => {
  let data = readJson<DeviceRecord[]>(FILES.devices, []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((d) => d.app_id === app_id);
  if (sub_id) data = data.filter((d) => d.sub_id === sub_id);
  res.json(data);
});

router.post("/admin/devices", (req, res) => {
  const { app_id, sub_id, device_id, device_name, device_model, android_version } = req.body as DeviceRecord;
  if (!app_id || !device_id) return res.status(400).json({ error: "app_id and device_id required" });
  const data = readJson<DeviceRecord[]>(FILES.devices, []);
  const rec: DeviceRecord = { id: nextId(data), app_id, sub_id: sub_id ?? null, device_id, device_name: device_name ?? null, device_model: device_model ?? null, android_version: android_version ?? null, registered_at: new Date().toISOString(), is_active: true, last_seen: new Date().toISOString() };
  data.unshift(rec); writeJson(FILES.devices, data); res.status(201).json(rec);
});

router.patch("/admin/devices/:id/toggle", (req, res) => {
  const data = readJson<DeviceRecord[]>(FILES.devices, []);
  const idx = data.findIndex((d) => d.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx].is_active = (req.body as { is_active: boolean }).is_active;
  writeJson(FILES.devices, data); res.json({ ok: true });
});

router.delete("/admin/devices/:id", (req, res) => {
  const data = readJson<DeviceRecord[]>(FILES.devices, []);
  writeJson(FILES.devices, data.filter((d) => d.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS (admin_sessions)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/sessions", (req, res) => {
  let data = readJson<SessionRecord[]>(FILES.sessions, []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((s) => s.app_id === app_id);
  if (sub_id) data = data.filter((s) => s.sub_id === sub_id);
  res.json(data);
});

router.delete("/admin/sessions/:id", (req, res) => {
  writeJson(FILES.sessions, readJson<SessionRecord[]>(FILES.sessions, []).filter((s) => s.id !== Number(req.params.id)));
  res.json({ ok: true });
});

router.post("/admin/sessions/:id/invalidate", (req, res) => {
  const data = readJson<SessionRecord[]>(FILES.sessions, []);
  const idx = data.findIndex((s) => s.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx].is_valid = false; writeJson(FILES.sessions, data); res.json({ ok: true });
});

router.delete("/admin/sessions/app/:appId/all", (req, res) => {
  writeJson(FILES.sessions, readJson<SessionRecord[]>(FILES.sessions, []).filter((s) => s.app_id !== req.params.appId));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORM DATA
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/form-data", (req, res) => {
  let data = readJson<FormDataRecord[]>(FILES.formData, []);
  const { app_id, sub_id, form_type } = req.query as Record<string, string>;
  if (app_id) data = data.filter((f) => f.app_id === app_id);
  if (sub_id) data = data.filter((f) => f.sub_id === sub_id);
  if (form_type) data = data.filter((f) => f.form_type === form_type);
  res.json(data);
});

router.delete("/admin/form-data/:id", (req, res) => {
  writeJson(FILES.formData, readJson<FormDataRecord[]>(FILES.formData, []).filter((f) => f.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/messages", (req, res) => {
  let data = readJson<MessageRecord[]>(FILES.messages, []);
  const { app_id, sub_id } = req.query as Record<string, string>;
  if (app_id) data = data.filter((m) => m.app_id === app_id);
  if (sub_id) data = data.filter((m) => m.sub_id === sub_id);
  res.json(data);
});

router.post("/admin/messages", (req, res) => {
  const { app_id, sub_id, from_id, content, message_type = "admin" } = req.body as Partial<MessageRecord>;
  if (!app_id || !content) return res.status(400).json({ error: "app_id and content required" });
  const data = readJson<MessageRecord[]>(FILES.messages, []);
  const rec: MessageRecord = { id: nextId(data), app_id, sub_id: sub_id ?? null, from_id: from_id ?? "admin", content, message_type, sent_at: new Date().toISOString(), is_read: false };
  data.unshift(rec); writeJson(FILES.messages, data); res.status(201).json(rec);
});

router.patch("/admin/messages/:id/read", (req, res) => {
  const data = readJson<MessageRecord[]>(FILES.messages, []);
  const idx = data.findIndex((m) => m.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  data[idx].is_read = true; writeJson(FILES.messages, data); res.json({ ok: true });
});

router.delete("/admin/messages/:id", (req, res) => {
  writeJson(FILES.messages, readJson<MessageRecord[]>(FILES.messages, []).filter((m) => m.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/settings", (req, res) => {
  let data = readJson<SettingRecord[]>(FILES.settings, []);
  const { app_id } = req.query as { app_id?: string };
  if (app_id) data = data.filter((s) => s.app_id === app_id);
  res.json(data);
});

router.put("/admin/settings", (req, res) => {
  const { app_id, key, value } = req.body as { app_id: string; key: string; value: string };
  if (!app_id || !key) return res.status(400).json({ error: "app_id and key required" });
  const data = readJson<SettingRecord[]>(FILES.settings, []);
  const idx = data.findIndex((s) => s.app_id === app_id && s.key === key);
  if (idx >= 0) { data[idx].value = value; data[idx].updated_at = new Date().toISOString(); }
  else data.push({ id: nextId(data), app_id, key, value, updated_at: new Date().toISOString() });
  writeJson(FILES.settings, data); res.json({ ok: true });
});

router.delete("/admin/settings/:id", (req, res) => {
  writeJson(FILES.settings, readJson<SettingRecord[]>(FILES.settings, []).filter((s) => s.id !== Number(req.params.id)));
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANDROID REGISTRATION ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────
router.post("/api/register-device", (req, res) => {
  const { app_id, sub_id, device_id, device_name, device_model, android_version } = req.body as Partial<DeviceRecord>;
  if (!app_id || !device_id) return res.status(400).json({ error: "app_id and device_id required" });
  const apps = readJson<AppRecord[]>(FILES.apps, []);
  const app = apps.find((a) => a.app_id === app_id && a.status === "active");
  if (!app) return res.status(403).json({ error: "Invalid or inactive App ID" });
  if (app.expires_at && new Date(app.expires_at) < new Date()) return res.status(403).json({ error: "App ID expired" });
  const devices = readJson<DeviceRecord[]>(FILES.devices, []);
  const existing = devices.findIndex((d) => d.app_id === app_id && d.device_id === device_id!);
  if (existing >= 0) { devices[existing].last_seen = new Date().toISOString(); writeJson(FILES.devices, devices); return res.json({ ok: true, device: devices[existing] }); }
  const rec: DeviceRecord = { id: nextId(devices), app_id, sub_id: sub_id ?? null, device_id, device_name: device_name ?? null, device_model: device_model ?? null, android_version: android_version ?? null, registered_at: new Date().toISOString(), is_active: true, last_seen: new Date().toISOString() };
  devices.unshift(rec); writeJson(FILES.devices, devices);
  res.status(201).json({ ok: true, device: rec });
});

export default router;
