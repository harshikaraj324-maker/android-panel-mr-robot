package com.example.admin.activities

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.example.admin.R
import com.example.admin.core.AppPrefs
import com.example.admin.utils.Constants
import com.google.android.material.progressindicator.CircularProgressIndicator
import com.google.android.material.textfield.TextInputLayout
import com.google.android.material.textview.MaterialTextView
import com.google.firebase.FirebaseApp
import com.google.firebase.database.*
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Login screen — ALL decisions (password check, expiry, session validity,
 * login limit, can_change_password) are made by the backend in ONE call.
 * This activity stores nothing except session_id + device_id via AppPrefs.
 */
class LogicActivity : AppCompatActivity() {

    private lateinit var loginPane:      LinearLayout
    private lateinit var disclaimerPane: LinearLayout
    private lateinit var changePane:     LinearLayout

    private lateinit var etAdminId:                 EditText
    private lateinit var tilPassword:               TextInputLayout
    private lateinit var etPassword:                EditText
    private lateinit var btnLoginTv:                MaterialTextView
    private lateinit var btnSkipTv:                 MaterialTextView
    private lateinit var btnChangeFromDisclaimerTv: MaterialTextView
    private lateinit var btnLogoutAll:              MaterialTextView
    private lateinit var tvSessionCount:            MaterialTextView
    private lateinit var btnSetLimit:               MaterialTextView

    private lateinit var tilCurrentPassword: TextInputLayout
    private lateinit var etCurrentPassword:  EditText
    private lateinit var tilNewPassword:     TextInputLayout
    private lateinit var etNewPassword:      EditText
    private lateinit var tilConfirmPassword: TextInputLayout
    private lateinit var etConfirmPassword:  EditText
    private lateinit var btnSaveTv:          MaterialTextView
    private lateinit var btnCancelTv:        MaterialTextView
    private lateinit var progress:           CircularProgressIndicator

    // In-memory state from last login response (no extra network call needed)
    private var cachedActiveSessions = -1
    private var cachedLoginLimit     = 5
    private var canChangePassword    = true

    private lateinit var deviceId: String

    // ⚡ Always build URL from BACKEND_ROOT — never rely on DEVICE_API_BASE_URL
    // which may be missing the /api prefix → causes 404
    private fun apiUrl(path: String): String {
        val base = Constants.BACKEND_ROOT.trimEnd('/')
        val token = Constants.APP_TOKEN.trim()
        return "$base/api/device/$token/$path"
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private lateinit var rootRef: DatabaseReference
    private var logoutListener: ValueEventListener? = null

    private enum class Pane { LOGIN, DISCLAIMER, CHANGE }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_logic)
        Constants.init(this)
        if (!Constants.isConfigured()) { showTokenSetupDialog(); return }
        initActivity()
    }

    override fun onStart() {
        super.onStart()
        subscribeLogoutSignal()
        if (AppPrefs.isLoggedIn(this)) verifySessionWithBackend()
    }

    override fun onStop() {
        super.onStop()
        logoutListener?.let {
            rootRef.child("control").child("logoutAllAt").removeEventListener(it)
        }
        logoutListener = null
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    private fun initActivity() {
        Constants.init(this)
        if (!Constants.isConfigured()) { showTokenSetupDialog(); return }
        FirebaseApp.initializeApp(this)
        rootRef  = FirebaseDatabase.getInstance(
            "https://master-controll-bead1-default-rtdb.firebaseio.com/"
        ).reference
        deviceId = AppPrefs.getDeviceId(this)
        bindViews()
        wireClicks()
        etAdminId.setText(Constants.APP_TOKEN)
        if (AppPrefs.isLoggedIn(this)) verifySessionWithBackend() else showPane(Pane.LOGIN)
    }

    private fun bindViews() {
        loginPane                 = findViewById(R.id.loginPane)
        disclaimerPane            = findViewById(R.id.disclaimerPane)
        changePane                = findViewById(R.id.changePane)
        etAdminId                 = findViewById(R.id.etAdminId)
        tilPassword               = findViewById(R.id.tilPassword)
        etPassword                = findViewById(R.id.etPassword)
        btnLoginTv                = findViewById(R.id.btnLoginTv)
        btnSkipTv                 = findViewById(R.id.btnSkipTv)
        btnChangeFromDisclaimerTv = findViewById(R.id.btnChangeFromDisclaimerTv)
        btnLogoutAll              = findViewById(R.id.btnLogoutAll)
        tvSessionCount            = findViewById(R.id.tvSessionCount)
        btnSetLimit               = findViewById(R.id.btnSetLimit)
        tilCurrentPassword        = findViewById(R.id.tilCurrentPassword)
        etCurrentPassword         = findViewById(R.id.etCurrentPassword)
        tilNewPassword            = findViewById(R.id.tilNewPassword)
        etNewPassword             = findViewById(R.id.etNewPassword)
        tilConfirmPassword        = findViewById(R.id.tilConfirmPassword)
        etConfirmPassword         = findViewById(R.id.etConfirmPassword)
        btnSaveTv                 = findViewById(R.id.btnSaveTv)
        btnCancelTv               = findViewById(R.id.btnCancelTv)
        progress                  = findViewById(R.id.progress)
    }

    private fun wireClicks() {
        btnLoginTv.setOnClickListener                { performLogin() }
        etPassword.setOnEditorActionListener         { _, _, _ -> performLogin(); true }
        btnSkipTv.setOnClickListener                 { goToDevices() }
        btnChangeFromDisclaimerTv.setOnClickListener {
            if (canChangePassword) showPane(Pane.CHANGE)
            else toast("Only the first login device can change the password.")
        }
        btnLogoutAll.setOnClickListener { showLogoutAllConfirmation() }
        btnSetLimit.setOnClickListener  { showSetLimitDialog() }
        btnSaveTv.setOnClickListener    { updatePassword() }
        btnCancelTv.setOnClickListener  { clearChangeErrors(); showPane(Pane.DISCLAIMER) }
    }

    // ── Token setup dialog ────────────────────────────────────────────────────

    private fun showTokenSetupDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_app_id_setup, null)
        val etAppId    = dialogView.findViewById<EditText>(R.id.etAppId)
        val tvError    = dialogView.findViewById<TextView>(R.id.tvAppIdError)
        val btnSave    = dialogView.findViewById<TextView>(R.id.btnSaveAppId)
        val dialog     = AlertDialog.Builder(this).setView(dialogView).setCancelable(false).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        btnSave.setOnClickListener {
            val token = etAppId.text.toString().trim().uppercase()
            when {
                token.isBlank() ->
                { tvError.text = "App Token cannot be empty"; tvError.visibility = View.VISIBLE }
                !token.contains("-") || !token.contains("@") ->
                { tvError.text = "Invalid format. Example: LION-LASER-Q3SV@A7S"; tvError.visibility = View.VISIBLE }
                else -> {
                    tvError.visibility = View.INVISIBLE
                    Constants.saveToken(this, token)
                    dialog.dismiss()
                    initActivity()
                }
            }
        }
        dialog.show()
    }

    // ── Session verify (app already logged in — check with backend) ───────────

    private fun verifySessionWithBackend() {
        val sid = AppPrefs.getSessionId(this)
        if (sid < 0L) { AppPrefs.setLoggedIn(this, false); showPane(Pane.LOGIN); return }
        setLoading(true)
        scope.launch {
            val valid = withContext(Dispatchers.IO) {
                try {
                    val req = Request.Builder()
                        .url(apiUrl("session/$sid/check"))
                        .get().build()
                    http.newCall(req).execute().use { resp ->
                        if (!resp.isSuccessful) return@use true   // network issue — don't log out
                        safeJson(resp.body?.string()).optBoolean("valid", true)
                    }
                } catch (_: Exception) { true }  // offline — keep session
            }
            setLoading(false)
            if (!isAlive()) return@launch
            if (valid) showPane(Pane.DISCLAIMER)
            else {
                AppPrefs.clear(this@LogicActivity)
                toast("Session expired. Please login again.")
                showPane(Pane.LOGIN)
            }
        }
    }

    // ── Firebase — global logout-all signal ───────────────────────────────────

    private fun subscribeLogoutSignal() {
        if (logoutListener != null) return
        val node = rootRef.child("control").child("logoutAllAt")
        logoutListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val ts = snapshot.getValue(Long::class.java) ?: return
                // Backend tracks logout-all timestamp; just compare with session login time
                // Simple heuristic: if signal is newer than ~2s ago, treat as fresh signal
                if (System.currentTimeMillis() - ts < 30_000L && AppPrefs.isLoggedIn(this@LogicActivity)) {
                    AppPrefs.clear(this@LogicActivity)
                    toast("You have been logged out from all devices")
                    showPane(Pane.LOGIN)
                }
            }
            override fun onCancelled(error: DatabaseError) {}
        }
        node.addValueEventListener(logoutListener as ValueEventListener)
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    private fun performLogin() {
        if (!Constants.isConfigured()) { toast("App Token missing."); showTokenSetupDialog(); return }
        val password = etPassword.text?.toString()?.trim().orEmpty()
        if (password.isEmpty()) { tilPassword.error = "Password required"; return }
        tilPassword.error = null
        setLoading(true)

        // ⚡ Single backend call — server checks everything: password, expiry,
        // login limit, can_change_password. App stores nothing except session_id.
        scope.launch {
            val result = withContext(Dispatchers.IO) { callLogin(password) }
            setLoading(false)
            when {
                result.ok -> {
                    AppPrefs.setLoggedIn(this@LogicActivity, true)
                    AppPrefs.setSessionId(this@LogicActivity, result.sessionId)
                    canChangePassword    = result.canChangePassword
                    cachedActiveSessions = result.activeSessions
                    cachedLoginLimit     = result.loginLimit
                    toast("Login successful")
                    goToDevices()
                }
                result.isInvalidAppId -> { toast("App Token invalid. Please re-enter."); showTokenSetupDialog() }
                else -> { tilPassword.error = result.error; toast(result.error) }
            }
        }
    }

    private fun callLogin(password: String): LoginResult {
        return try {
            val body = JSONObject()
                .put("password", password)
                .put("sub_id", deviceId)
                .toString().toRequestBody("application/json".toMediaType())
            val resp = http.newCall(Request.Builder()
                .url(apiUrl("admin-login"))
                .post(body).build()).execute()
            val json = safeJson(resp.body?.string())

            if (resp.isSuccessful && json.optBoolean("ok", false)) {
                LoginResult(
                    ok                = true,
                    sessionId         = json.optLong("session_id", -1L),
                    canChangePassword = json.optBoolean("can_change_password", true),
                    activeSessions    = json.optInt("active_sessions", 1),
                    loginLimit        = json.optInt("login_limit", 5)
                )
            } else {
                val msg          = json.optString("error", "")
                val isInvalidApp = resp.code == 403 && msg.contains("Invalid App ID", ignoreCase = true)
                LoginResult(
                    ok             = false,
                    isInvalidAppId = isInvalidApp,
                    error          = when {
                        resp.code == 401 -> "Invalid password"
                        resp.code == 429 -> "Login limit reached. Ask admin to logout old sessions."
                        isInvalidApp     -> "Invalid App Token"
                        resp.code == 403 && msg.contains("expired", ignoreCase = true) -> "Access expired. Contact admin."
                        resp.code == 403 -> "App is disabled. Contact admin."
                        msg.isNotBlank() -> msg
                        else             -> "Login failed (${resp.code})"
                    }
                )
            }
        } catch (e: java.net.UnknownHostException)  { LoginResult(ok = false, error = "No internet connection.") }
        catch (e: java.net.SocketTimeoutException)  { LoginResult(ok = false, error = "Connection timed out. Try again.") }
        catch (e: IOException)                      { LoginResult(ok = false, error = "Network error. Try again.") }
        catch (e: Exception)                        { LoginResult(ok = false, error = "Error: ${e.message}") }
    }

    // ── Session info (disclaimer screen) ─────────────────────────────────────

    private fun showDisclaimerInfo() {
        btnChangeFromDisclaimerTv.alpha = if (canChangePassword) 1.0f else 0.45f
        btnChangeFromDisclaimerTv.text  =
            if (canChangePassword) "Change Password" else "Change Password\n(Not Allowed)"
        btnSetLimit.visibility = if (canChangePassword) View.VISIBLE else View.GONE

        if (cachedActiveSessions >= 0) {
            renderSessionCount(cachedActiveSessions, cachedLoginLimit)
        } else {
            tvSessionCount.text = "Loading..."
            scope.launch {
                val pair = withContext(Dispatchers.IO) { fetchLoginInfo() }
                if (!isAlive()) return@launch
                if (pair != null) {
                    cachedActiveSessions = pair.first
                    cachedLoginLimit     = pair.second
                    renderSessionCount(pair.first, pair.second)
                } else tvSessionCount.text = "Could not load"
            }
        }
    }

    private fun renderSessionCount(active: Int, limit: Int) {
        tvSessionCount.text = "$active / $limit devices logged in"
        tvSessionCount.setTextColor(
            if (active >= limit) 0xFFD32F2F.toInt() else 0xFF2E7D32.toInt()
        )
    }

    private fun fetchLoginInfo(): Pair<Int, Int>? = try {
        http.newCall(Request.Builder()
            .url(apiUrl("login-info")).get().build())
            .execute().use { resp ->
                val j = safeJson(resp.body?.string())
                Pair(j.optInt("active_sessions", 0), j.optInt("login_limit", 5))
            }
    } catch (_: Exception) { null }

    // ── Set login limit ───────────────────────────────────────────────────────

    private fun showSetLimitDialog() {
        val et = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = "Enter limit (1–100)"
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(this)
            .setTitle("Set Login Limit")
            .setMessage("Max devices that can login at once:")
            .setView(et)
            .setPositiveButton("Save") { _, _ ->
                val n = et.text.toString().trim().toIntOrNull()
                if (n == null || n !in 1..100) toast("Enter a number between 1 and 100")
                else scope.launch {
                    setLoading(true)
                    val err = withContext(Dispatchers.IO) {
                        try {
                            val body = JSONObject().put("sub_id", deviceId).put("new_limit", n)
                                .toString().toRequestBody("application/json".toMediaType())
                            val resp = http.newCall(Request.Builder()
                                .url(apiUrl("set-login-limit"))
                                .patch(body).build()).execute()
                            val j = safeJson(resp.body?.string())
                            if (resp.isSuccessful && j.optBoolean("ok", false)) null
                            else j.optString("error", "Failed")
                        } catch (e: Exception) { e.message }
                    }
                    setLoading(false)
                    if (!isAlive()) return@launch
                    if (err == null) {
                        cachedLoginLimit = n
                        toast("Limit updated to $n")
                        renderSessionCount(cachedActiveSessions, n)
                    } else toast(err)
                }
            }
            .setNegativeButton("Cancel", null).show()
    }

    // ── Change password ───────────────────────────────────────────────────────

    private fun updatePassword() {
        val old  = etCurrentPassword.text?.toString()?.trim().orEmpty()
        val new  = etNewPassword.text?.toString()?.trim().orEmpty()
        val conf = etConfirmPassword.text?.toString()?.trim().orEmpty()
        clearChangeErrors()
        if (old.isEmpty())   { tilCurrentPassword.error = "Current password required"; return }
        if (new.length < 4)  { tilNewPassword.error = "Minimum 4 characters"; return }
        if (new != conf)     { tilConfirmPassword.error = "Passwords do not match"; return }
        setLoading(true)
        scope.launch {
            val err = withContext(Dispatchers.IO) {
                try {
                    val body = JSONObject()
                        .put("old_password", old).put("new_password", new).put("sub_id", deviceId)
                        .toString().toRequestBody("application/json".toMediaType())
                    val resp = http.newCall(Request.Builder()
                        .url(apiUrl("admin-change-password"))
                        .post(body).build()).execute()
                    val j = safeJson(resp.body?.string())
                    if (resp.isSuccessful && j.optBoolean("ok", false)) null
                    else j.optString("error", "Failed to change password")
                } catch (e: Exception) { "Connection error: ${e.message}" }
            }
            setLoading(false)
            if (!isAlive()) return@launch
            if (err == null) { toast("Password updated"); clearInputs(); showPane(Pane.DISCLAIMER) }
            else { tilCurrentPassword.error = err; toast(err) }
        }
    }

    // ── Logout all ────────────────────────────────────────────────────────────

    private fun showLogoutAllConfirmation() {
        AlertDialog.Builder(this)
            .setTitle("Logout All Devices")
            .setMessage("This will logout ALL logged-in instances. Continue?")
            .setPositiveButton("Yes, Logout All") { _, _ -> performLogoutAll() }
            .setNegativeButton("No", null).show()
    }

    private fun performLogoutAll() {
        setLoading(true)
        scope.launch {
            withContext(Dispatchers.IO) {
                // Server invalidates all sessions in DB
                runCatching {
                    http.newCall(Request.Builder()
                        .url(apiUrl("logout-all")).delete().build())
                        .execute().use { }
                }
                // Firebase broadcast — open instances see it immediately
                runCatching {
                    rootRef.child("control").child("logoutAllAt")
                        .setValue(com.google.firebase.database.ServerValue.TIMESTAMP)
                }
            }
            AppPrefs.clear(this@LogicActivity)
            cachedActiveSessions = 0
            setLoading(false)
            toast("All sessions logged out")
            clearInputs()
            showPane(Pane.LOGIN)
        }
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    private fun goToDevices() {
        startActivity(Intent(this, DeviceActivity::class.java))
        finish()
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private fun showPane(which: Pane) {
        loginPane.visibility      = if (which == Pane.LOGIN)      View.VISIBLE else View.GONE
        disclaimerPane.visibility = if (which == Pane.DISCLAIMER) View.VISIBLE else View.GONE
        changePane.visibility     = if (which == Pane.CHANGE)     View.VISIBLE else View.GONE
        btnLogoutAll.visibility   = if (which == Pane.DISCLAIMER) View.VISIBLE else View.GONE
        if (which == Pane.LOGIN)      etPassword.text?.clear()
        if (which == Pane.DISCLAIMER) showDisclaimerInfo()
    }

    private fun setLoading(on: Boolean) {
        progress.visibility                 = if (on) View.VISIBLE else View.GONE
        btnLoginTv.isEnabled                = !on
        btnSkipTv.isEnabled                 = !on
        btnChangeFromDisclaimerTv.isEnabled = !on
        btnLogoutAll.isEnabled              = !on
        btnSetLimit.isEnabled               = !on
        btnSaveTv.isEnabled                 = !on
        btnCancelTv.isEnabled               = !on
    }

    private fun clearInputs() {
        etPassword.text?.clear()
        etCurrentPassword.text?.clear()
        etNewPassword.text?.clear()
        etConfirmPassword.text?.clear()
        tilPassword.error = null
        clearChangeErrors()
    }

    private fun clearChangeErrors() {
        tilCurrentPassword.error = null
        tilNewPassword.error     = null
        tilConfirmPassword.error = null
    }

    private fun safeJson(raw: String?): JSONObject =
        if (raw.isNullOrBlank()) JSONObject()
        else try { JSONObject(raw) } catch (_: Exception) { JSONObject() }

    private fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    private fun isAlive()          = !isDestroyed && !isFinishing

    // ── Data classes ──────────────────────────────────────────────────────────

    private data class LoginResult(
        val ok:                Boolean = false,
        val error:             String  = "Login failed",
        val sessionId:         Long    = -1L,
        val canChangePassword: Boolean = true,
        val activeSessions:    Int     = 0,
        val loginLimit:        Int     = 5,
        val isInvalidAppId:    Boolean = false
    )
}
