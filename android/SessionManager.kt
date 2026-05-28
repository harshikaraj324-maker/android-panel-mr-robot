package com.example.admin.core

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.provider.Settings
import java.util.UUID

object SessionManager {
    private const val PREF = "logic_session_prefs"
    private const val KEY_IS_LOGGED_IN        = "is_logged_in"
    private const val KEY_LAST_LOGOUT_SEEN    = "last_logout_seen"
    private const val KEY_DEVICE_ID           = "device_id"
    private const val KEY_SESSION_ID          = "backend_session_id"
    private const val KEY_CAN_CHANGE_PASSWORD = "can_change_password"

    fun isLoggedIn(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getBoolean(KEY_IS_LOGGED_IN, false)

    fun setLoggedIn(ctx: Context, value: Boolean) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_IS_LOGGED_IN, value).apply()
        if (!value) {
            clearSessionId(ctx)
            clearCanChangePassword(ctx)
        }
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun getLastLogoutSeen(ctx: Context): Long =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getLong(KEY_LAST_LOGOUT_SEEN, 0L)

    fun setLastLogoutSeen(ctx: Context, ts: Long) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putLong(KEY_LAST_LOGOUT_SEEN, ts).apply()
    }

    fun getDeviceId(ctx: Context): String {
        val sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        var deviceId = sp.getString(KEY_DEVICE_ID, null)
        if (deviceId.isNullOrBlank()) {
            val androidId = try {
                Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
            } catch (e: Exception) { null }
            deviceId = if (!androidId.isNullOrBlank() && androidId != "9774d56d682e549c")
                "dev_$androidId"
            else
                "dev_${UUID.randomUUID()}"
            sp.edit().putString(KEY_DEVICE_ID, deviceId).apply()
        }
        return deviceId
    }

    fun getSessionId(ctx: Context): Long =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getLong(KEY_SESSION_ID, -1L)

    fun setSessionId(ctx: Context, id: Long) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putLong(KEY_SESSION_ID, id).apply()
    }

    fun clearSessionId(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().remove(KEY_SESSION_ID).apply()
    }

    // ── Password change permission (only first-login device) ──────────────────

    fun canChangePassword(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getBoolean(KEY_CAN_CHANGE_PASSWORD, true)

    fun setCanChangePassword(ctx: Context, value: Boolean) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_CAN_CHANGE_PASSWORD, value).apply()
    }

    fun clearCanChangePassword(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().remove(KEY_CAN_CHANGE_PASSWORD).apply()
    }

    fun forceLogoutAndGoTo(activity: Activity, loginActivityClass: Class<out Activity>) {
        setLoggedIn(activity, false)
        val intent = Intent(activity, loginActivityClass).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        }
        activity.startActivity(intent)
        activity.finish()
    }
}
