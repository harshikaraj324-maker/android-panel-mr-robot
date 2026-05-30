package com.example.admin.core

import android.content.Context
import android.provider.Settings
import java.util.UUID

/**
 * Minimal on-device storage — only the 3 things the app truly needs locally.
 * ALL login/session/expiry decisions are made server-side via the backend API.
 */
object AppPrefs {
    private const val PREF       = "app_prefs"
    private const val KEY_SID    = "session_id"   // Long, -1 = none
    private const val KEY_DID    = "device_id"    // stable device identifier
    private const val KEY_IN     = "logged_in"    // Boolean

    fun isLoggedIn(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getBoolean(KEY_IN, false)

    fun setLoggedIn(ctx: Context, v: Boolean) =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putBoolean(KEY_IN, v).apply()

    fun getSessionId(ctx: Context): Long =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getLong(KEY_SID, -1L)

    fun setSessionId(ctx: Context, id: Long) =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putLong(KEY_SID, id).apply()

    fun getDeviceId(ctx: Context): String {
        val sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        var did = sp.getString(KEY_DID, null)
        if (did.isNullOrBlank()) {
            val aid = try { Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) } catch (_: Exception) { null }
            did = if (!aid.isNullOrBlank() && aid != "9774d56d682e549c") "dev_$aid" else "dev_${UUID.randomUUID()}"
            sp.edit().putString(KEY_DID, did).apply()
        }
        return did
    }

    fun clear(ctx: Context) =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().clear().apply()
}
