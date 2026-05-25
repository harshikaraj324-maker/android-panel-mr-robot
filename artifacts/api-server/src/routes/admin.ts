import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Local file storage (no DB setup needed!) ──────────────────────────────────
const DATA_DIR = path.resolve(__dirname, "../../../../.local/data");
const APP_IDS_FILE = path.join(DATA_DIR, "app_ids.json");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface AppIdRecord {
  id: number;
  app_id: string;
  name: string | null;
  pin: string;
  status: "active" | "inactive" | "disabled";
  created_at: string;
  expires_at: string;
}

function readAppIds(): AppIdRecord[] {
  try {
    ensureDir();
    if (fs.existsSync(APP_IDS_FILE)) {
      return JSON.parse(fs.readFileSync(APP_IDS_FILE, "utf8")) as AppIdRecord[];
    }
  } catch {}
  return [];
}

function writeAppIds(data: AppIdRecord[]) {
  ensureDir();
  fs.writeFileSync(APP_IDS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function nextId(data: AppIdRecord[]): number {
  return data.length === 0 ? 1 : Math.max(...data.map((d) => d.id)) + 1;
}

// ── App ID generator: WORD-WORD-XXXX@YYY ─────────────────────────────────────
const WORDS = [
  "MR","ROBOT","ALPHA","BETA","GAMMA","DELTA","ECHO","FOXTROT","GHOST","HAWK",
  "IRON","JADE","KING","LION","MAXIM","NOVA","ONYX","PRIME","QUICK","RAVEN",
  "SIGMA","TITAN","ULTRA","VIPER","WOLF","XRAY","YIELD","ZERO","BLAZE","CYBER",
  "DEMON","EAGLE","FLASH","GRAND","HYPER","INFRA","JUMBO","KRYPTO","LASER","METRO",
  "NINJA","ORBIT","PIXEL","QUARK","RAZOR","SPARK","TURBO","VAULT","WARP","STORM",
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

// ── DB status (always ready now!) ────────────────────────────────────────────
router.get("/admin/init-status", (_req, res) => {
  res.json({ tables_exist: true, has_pat: true, app_ids_error: null, devices_error: null });
});

// ── Setup (kept for compatibility, always succeeds) ───────────────────────────
router.post("/admin/setup", (_req, res) => {
  res.json({ ok: true, message: "Ready" });
});

// ── Generate unique App ID ────────────────────────────────────────────────────
router.get("/admin/generate-app-id", (_req, res) => {
  const existing = new Set(readAppIds().map((a) => a.app_id));
  for (let i = 0; i < 20; i++) {
    const candidate = generateAppId();
    if (!existing.has(candidate)) return res.json({ app_id: candidate });
  }
  res.json({ app_id: generateAppId() });
});

// ── APP IDs: List ─────────────────────────────────────────────────────────────
router.get("/admin/app-ids", (_req, res) => {
  const data = readAppIds();

  // Try to get device counts from Supabase (gracefully fails if table doesn't exist)
  supabaseAdmin.from("registered_devices").select("app_id,is_active").then(({ data: devices }) => {
    const counts: Record<string, { total: number; active: number }> = {};
    for (const d of devices ?? []) {
      if (!counts[d.app_id]) counts[d.app_id] = { total: 0, active: 0 };
      counts[d.app_id].total++;
      if (d.is_active) counts[d.app_id].active++;
    }
    res.json({
      needs_setup: false,
      rows: data.map((row) => ({
        ...row,
        device_count: counts[row.app_id]?.total ?? 0,
        active_count: counts[row.app_id]?.active ?? 0,
      })),
    });
  }).catch(() => {
    res.json({
      needs_setup: false,
      rows: data.map((row) => ({ ...row, device_count: 0, active_count: 0 })),
    });
  });
});

// ── APP IDs: Create ───────────────────────────────────────────────────────────
router.post("/admin/app-ids", (req, res) => {
  const { app_id, pin = "1234", name, expires_at } = req.body as {
    app_id: string; pin?: string; name?: string; expires_at?: string;
  };
  if (!app_id) return res.status(400).json({ error: "app_id is required" });

  const data = readAppIds();
  if (data.some((a) => a.app_id === app_id)) {
    return res.status(409).json({ error: `App ID "${app_id}" already exists` });
  }

  const newRecord: AppIdRecord = {
    id: nextId(data),
    app_id,
    name: name ?? null,
    pin,
    status: "active",
    created_at: new Date().toISOString(),
    expires_at: expires_at ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  data.unshift(newRecord); // newest first
  writeAppIds(data);
  res.status(201).json(newRecord);
});

// ── APP IDs: Change PIN ───────────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/password", (req, res) => {
  const { appId } = req.params;
  const { new_password } = req.body as { new_password: string };
  if (!new_password) return res.status(400).json({ error: "new_password required" });

  const data = readAppIds();
  const idx = data.findIndex((a) => a.app_id === appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  data[idx].pin = new_password;
  writeAppIds(data);
  res.json({ ok: true });
});

// ── APP IDs: Reset PIN to 1234 ────────────────────────────────────────────────
router.post("/admin/app-ids/:appId/reset-password", (req, res) => {
  const { appId } = req.params;
  const data = readAppIds();
  const idx = data.findIndex((a) => a.app_id === appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  data[idx].pin = "1234";
  writeAppIds(data);
  res.json({ ok: true });
});

// ── APP IDs: Extend +30 Days ──────────────────────────────────────────────────
router.post("/admin/app-ids/:appId/extend", (req, res) => {
  const { appId } = req.params;
  const data = readAppIds();
  const idx = data.findIndex((a) => a.app_id === appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const current = data[idx].expires_at ? new Date(data[idx].expires_at) : new Date();
  const newExpiry = new Date(Math.max(current.getTime(), Date.now()) + 30 * 24 * 60 * 60 * 1000).toISOString();
  data[idx].expires_at = newExpiry;
  writeAppIds(data);
  res.json({ ok: true, expires_at: newExpiry });
});

// ── APP IDs: Toggle Status ────────────────────────────────────────────────────
router.patch("/admin/app-ids/:appId/toggle", (req, res) => {
  const { appId } = req.params;
  const { status } = req.body as { status: string };
  const data = readAppIds();
  const idx = data.findIndex((a) => a.app_id === appId);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  data[idx].status = status as AppIdRecord["status"];
  writeAppIds(data);
  res.json({ ok: true });
});

// ── APP IDs: Delete ───────────────────────────────────────────────────────────
router.delete("/admin/app-ids/:appId", (req, res) => {
  const { appId } = req.params;
  const data = readAppIds();
  const filtered = data.filter((a) => a.app_id !== appId);
  if (filtered.length === data.length) return res.status(404).json({ error: "Not found" });

  writeAppIds(filtered);

  // Also try to delete devices from Supabase
  supabaseAdmin.from("registered_devices").delete().eq("app_id", appId).then(() => {}).catch(() => {});

  res.json({ ok: true });
});

// ── DEVICES (from Supabase, graceful if table doesn't exist) ─────────────────
router.get("/admin/devices", async (req, res) => {
  const { app_id } = req.query as { app_id?: string };
  let q = supabaseAdmin.from("registered_devices").select("*").order("registered_at", { ascending: false });
  if (app_id) q = q.eq("app_id", app_id);
  const { data, error } = await q;
  if (error) return res.json([]); // graceful: table might not exist yet
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

// ── Android device registration endpoint (for Android apps to call) ───────────
router.post("/api/register-device", async (req, res) => {
  const { app_id, device_id, device_name, device_model, android_version } = req.body as {
    app_id: string; device_id: string; device_name?: string;
    device_model?: string; android_version?: string;
  };

  // Verify app_id exists and is active
  const appIds = readAppIds();
  const app = appIds.find((a) => a.app_id === app_id && a.status === "active");
  if (!app) return res.status(403).json({ error: "Invalid or inactive App ID" });

  // Check expiry
  if (app.expires_at && new Date(app.expires_at) < new Date()) {
    return res.status(403).json({ error: "App ID has expired" });
  }

  // Try to save to Supabase registered_devices (graceful fail)
  await supabaseAdmin.from("registered_devices").upsert(
    { app_id, device_id, device_name, device_model, android_version, last_seen: new Date().toISOString() },
    { onConflict: "app_id,device_id" }
  ).catch(() => {});

  res.json({ ok: true, app_id, device_id });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
router.get("/admin/stats", async (_req, res) => {
  const appIds = readAppIds();
  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Try devices from Supabase
  const { data: devices } = await supabaseAdmin.from("registered_devices")
    .select("app_id,is_active,registered_at").catch(() => ({ data: null, error: null }));

  res.json({
    total_apps: appIds.length,
    active_apps: appIds.filter((a) => a.status === "active").length,
    expired_apps: appIds.filter((a) => a.expires_at && a.expires_at < now).length,
    total_devices: (devices ?? []).length,
    active_devices: (devices ?? []).filter((d) => d.is_active).length,
    recent_devices_7d: (devices ?? []).filter(
      (d) => d.registered_at && d.registered_at > sevenDaysAgo
    ).length,
  });
});

export default router;
