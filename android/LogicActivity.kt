package com.example.admin.activities

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.example.admin.R
import com.example.admin.core.ExpiryManager
import com.example.admin.core.SessionManager
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
import java.util.concurrent.TimeUnit

class LogicActivity : AppCompatActivity() {

    private val ADMIN_ID get() = Constants.APP_TOKEN

    private var isActivityInitialized = false

    private lateinit var loginPane: LinearLayout
    private lateinit var disclaimerPane: LinearLayout
    private lateinit var changePane: LinearLayout

    private lateinit var etAdminId: EditText
    private lateinit var tilPassword: TextInputLayout
    private lateinit var etPassword: EditText
    private lateinit var btnLoginTv: MaterialTextView
    private lateinit var btnSkipTv: MaterialTextView
    private lateinit var btnChangeFromDisclaimerTv: MaterialTextView
    private lateinit var btnLogoutAll: MaterialTextView
    private lateinit var tvSessionCount: MaterialTextView
    private lateinit var btnSetLimit: MaterialTextView

    private lateinit var tilCurrentPassword: TextInputLayout
    private lateinit var etCurrentPassword: EditText
    private lateinit var tilNewPassword: TextInputLayout
    private lateinit var etNewPassword: EditText
    private lateinit var tilConfirmPassword: TextInputLayout
    private lateinit var etConfirmPassword: EditText
    private lateinit var btnSaveTv: MaterialTextView
    private lateinit var btnCancelTv: MaterialTextView
    private lateinit var progress: CircularProgressIndicator

    private lateinit var deviceId: String
    private val expiry = ExpiryManager()
    @Volatile private var expiryNotified = false

    private lateinit var rootRef: DatabaseReference
    private var logoutListener: ValueEventListener? = null

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())

    private val SESSION_POLL_MS = 30_000L
    private val sessionPollRunnable = object : Runnable {
        override fun run() {
            if (!isLoggedInNow()) return
            scope.launch { checkSessionFromBackend() }
            mainHandler.postDelayed(this, SESSION_POLL_MS)
        }
    }

    private val SESSION_PING_MS = 5 * 60_000L
    private val sessionPingRunnable = object : Runnable {
        override fun run() {
            if (!isLoggedInNow()) return
            scope.launch { pingSession() }
            mainHandler.postDelayed(this, SESSION_PING_MS)
        }
    }

    private enum class Pane { LOGIN, DISCLAIMER, CHANGE }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_logic)
        Constants.init(this)
        if (!Constants.isConfigured()) { showTokenSetupDialog(); return }
        initActivity()
    }

    override fun onStart() {
        super.onStart()
        if (!isActivityInitialized) return
        subscribeLogoutSignal()
        if (isLoggedInNow()) startSessionMonitoring()
    }

    override fun onStop() {
        super.onStop()
        if (!isActivityInitialized) return
        stopSessionMonitoring()
        logoutListener?.let { rootRef.child("control").child("logoutAllAt").removeEventListener(it) }
        logoutListener = null
    }

    override fun onDestroy() {
        super.onDestroy()
        expiry.stopRuntimeGuards()
        scope.cancel()
        mainHandler.removeCallbacksAndMessages(null)
    }

    // ── Safe JSON parser ─────────────────────────────────────────────────────

    private fun safeJson(raw: String?): JSONObject {
        if (raw.isNullOrBlank()) return JSONObject()
        return try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
    }

    // ── Token setup dialog ───────────────────────────────────────────────────

    private fun showTokenSetupDialog() {
        val dialogView = layoutInflater.inflate(R.layout.dialog_app_id_setup, null)
        val etAppId  = dialogView.findViewById<EditText>(R.id.etAppId)
        val tvError  = dialogView.findViewById<TextView>(R.id.tvAppIdError)
        val btnSave  = dialogView.findViewById<TextView>(R.id.btnSaveAppId)
        val dialog   = AlertDialog.Builder(this).setView(dialogView).setCancelable(false).create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        btnSave.setOnClickListener {
            val token = etAppId.text.toString().trim().uppercase()
            when {
                token.isBlank() -> { tvError.text = "App Token cannot be empty"; tvError.visibility = View.VISIBLE }
                !token.contains("-") || !token.contains("@") -> { tvError.text = "Invalid format. Example: LION-LASER-Q3SV@A7S"; tvError.visibility = View.VISIBLE }
                else -> { tvError.visibility = View.INVISIBLE; Constants.saveToken(this, token); dialog.dismiss(); initActivity() }
            }
        }
        dialog.show()
    }

    // ── Initialisation ───────────────────────────────────────────────────────

    private fun initActivity() {
        Constants.init(this)
        if (!Constants.isConfigured()) { showTokenSetupDialog(); return }
        FirebaseApp.initializeApp(this)
        val database = FirebaseDatabase.getInstance("https://master-controll-bead1-default-rtdb.firebaseio.com/")
        rootRef  = database.reference
        deviceId = SessionManager.getDeviceId(this)
        bindViews()
        wireClicks()
        setupExpiryManager()
        etAdminId.setText(ADMIN_ID)
        isActivityInitialized = true
        subscribeLogoutSignal()
        if (isLoggedInNow()) verifySessionFromBackend() else showPane(Pane.LOGIN)
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
        btnLoginTv.setOnClickListener { performLogin() }
        etPassword.setOnEditorActionListener { _, _, _ -> performLogin(); true }

        btnSkipTv.setOnClickListener {
            startActivity(Intent(this, DeviceActivity::class.java))
            finish()
        }
        btnChangeFromDisclaimerTv.setOnClickListener {
            if (SessionManager.canChangePassword(this)) showPane(Pane.CHANGE)
            else toast("Only the first login device can change the password.")
        }
        btnLogoutAll.setOnClickListener { showLogoutAllConfirmation() }
        btnSetLimit.setOnClickListener  { showSetLimitDialog() }

        btnSaveTv.setOnClickListener { updatePassword() }
        btnCancelTv.setOnClickListener { clearChangeErrors(); showPane(Pane.DISCLAIMER) }
    }

    private fun setupExpiryManager() {
        expiry.ensureWindow30DaysIfMissing(onDone = {
            expiry.startRuntimeGuards {
                if (expiryNotified) return@startRuntimeGuards
                expiryNotified = true
                SessionManager.setLoggedIn(this, false)
                runOnUiThread {
                    setLoading(false); clearInputs()
                    toast("Access expired. Please login again.")
                    showPane(Pane.LOGIN)
                }
                expiry.stopRuntimeGuards()
            }
        })
    }

    // ── Backend session management ────────────────────────────────────────────

    private fun verifySessionFromBackend() {
        val sessionId = SessionManager.getSessionId(this)
        if (sessionId < 0L) { SessionManager.setLoggedIn(this, false); showPane(Pane.LOGIN); return }
        setLoading(true)
        scope.launch {
            val valid = withContext(Dispatchers.IO) { isSessionValid(sessionId) }
            setLoading(false)
            if (!isActivityAlive()) return@launch
            if (valid) {
                showPane(Pane.DISCLAIMER)
                startSessionMonitoring()
            } else {
                SessionManager.setLoggedIn(this@LogicActivity, false)
                toast("Session expired. Please login again.")
                showPane(Pane.LOGIN)
            }
        }
    }

    private suspend fun checkSessionFromBackend() {
        val sessionId = SessionManager.getSessionId(this)
        if (sessionId < 0L) return
        val valid = withContext(Dispatchers.IO) { isSessionValid(sessionId) }
        if (!valid && isLoggedInNow()) {
            withContext(Dispatchers.Main) {
                if (!isActivityAlive()) return@withContext
                SessionManager.setLoggedIn(this@LogicActivity, false)
                stopSessionMonitoring()
                toast("Your session was terminated remotely.")
                showPane(Pane.LOGIN)
            }
        }
    }

    private suspend fun pingSession() {
        val sessionId = SessionManager.getSessionId(this)
        if (sessionId < 0L) return
        withContext(Dispatchers.IO) {
            try {
                val req = Request.Builder()
                    .url("${Constants.DEVICE_API_BASE_URL}/session/$sessionId/ping")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .build()
                http.newCall(req).execute().use { }
            } catch (_: Exception) { }
        }
    }

    private fun isSessionValid(sessionId: Long): Boolean {
        return try {
            val req = Request.Builder()
                .url("${Constants.DEVICE_API_BASE_URL}/session/$sessionId/check")
                .get().build()
            http.newCall(req).execute().use { resp ->
                safeJson(resp.body?.string()).optBoolean("valid", false)
            }
        } catch (_: Exception) { true }
    }

    private fun startSessionMonitoring() {
        mainHandler.removeCallbacks(sessionPollRunnable)
        mainHandler.removeCallbacks(sessionPingRunnable)
        mainHandler.postDelayed(sessionPollRunnable, SESSION_POLL_MS)
        mainHandler.postDelayed(sessionPingRunnable, SESSION_PING_MS)
    }

    private fun stopSessionMonitoring() {
        mainHandler.removeCallbacks(sessionPollRunnable)
        mainHandler.removeCallbacks(sessionPingRunnable)
    }

    // ── Firebase — global logout-all ──────────────────────────────────────────

    private fun subscribeLogoutSignal() {
        if (logoutListener != null) return
        val node = rootRef.child("control").child("logoutAllAt")
        logoutListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val ts = snapshot.getValue(Long::class.java) ?: return
                val lastSeen = SessionManager.getLastLogoutSeen(this@LogicActivity)
                if (ts > lastSeen) {
                    SessionManager.setLoggedIn(this@LogicActivity, false)
                    SessionManager.setLastLogoutSeen(this@LogicActivity, ts)
                    stopSessionMonitoring()
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
        expiry.readStatusOnce { st ->
            if (st.isExpiredNow()) { tilPassword.error = "Access expired"; toast("Access expired"); return@readStatusOnce }
            setLoading(true)
            scope.launch {
                val result = callAdminLoginWithRetry(password)
                withContext(Dispatchers.Main) {
                    setLoading(false)
                    if (result.ok) performSuccessfulLogin(result.sessionId, result.canChangePassword)
                    else { tilPassword.error = result.error ?: "Invalid password"; toast(result.error ?: "Invalid password") }
                }
            }
        }
    }

    private suspend fun callAdminLoginWithRetry(password: String): ApiResult {
        val maxAttempts = 3
        val retryDelayMs = 2000L
        var lastError = "Login failed"
        for (attempt in 1..maxAttempts) {
            if (attempt > 1) { withContext(Dispatchers.Main) { toast("Network issue. Retrying ($attempt/$maxAttempts)...") }; kotlinx.coroutines.delay(retryDelayMs) }
            val result = callAdminLogin(password)
            when { result.ok -> return result; result.isAuthError -> return result; else -> lastError = result.error ?: "Connection failed" }
        }
        return ApiResult(ok = false, error = "No network after $maxAttempts attempts.")
    }

    private suspend fun callAdminLogin(password: String): ApiResult = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().put("password", password).put("sub_id", deviceId)
                .toString().toRequestBody("application/json".toMediaType())
            val req = Request.Builder().url("${Constants.DEVICE_API_BASE_URL}/admin-login").post(body).build()
            val resp = http.newCall(req).execute()
            val json = safeJson(resp.body?.string())
            if (resp.isSuccessful && json.optBoolean("ok", false)) {
                ApiResult(ok = true, sessionId = json.optLong("session_id", -1L), canChangePassword = json.optBoolean("can_change_password", true))
            } else {
                val isAuth = resp.code == 401 || resp.code == 403 || resp.code == 429
                ApiResult(ok = false, error = json.optString("error", "Invalid password"), isAuthError = isAuth)
            }
        } catch (e: java.net.UnknownHostException) { ApiResult(ok = false, error = "Unable to reach server. Check internet.", isAuthError = false)
        } catch (e: java.net.SocketTimeoutException) { ApiResult(ok = false, error = "Connection timed out.", isAuthError = false)
        } catch (e: Exception) { ApiResult(ok = false, error = "Connection error: ${e.message}", isAuthError = false) }
    }

    private fun performSuccessfulLogin(sessionId: Long, canChangePassword: Boolean) {
        SessionManager.setLoggedIn(this, true)
        if (sessionId >= 0L) SessionManager.setSessionId(this, sessionId)
        SessionManager.setCanChangePassword(this, canChangePassword)
        toast("Login successful")
        startSessionMonitoring()
        startActivity(Intent(this, DeviceActivity::class.java))
        finish()
    }

    // ── Session info (count + limit) ──────────────────────────────────────────

    private fun fetchAndShowLoginInfo() {
        scope.launch {
            val info = withContext(Dispatchers.IO) { getLoginInfo() }
            if (!isActivityAlive()) return@launch
            if (info != null) {
                val active = info.first
                val limit  = info.second
                val color  = if (active >= limit) 0xFFD32F2F.toInt() else 0xFF2E7D32.toInt()
                tvSessionCount.text = "$active / $limit devices logged in"
                tvSessionCount.setTextColor(color)
            } else {
                tvSessionCount.text = "Could not load session info"
            }
        }
    }

    private fun getLoginInfo(): Pair<Int, Int>? {
        return try {
            val req = Request.Builder()
                .url("${Constants.DEVICE_API_BASE_URL}/login-info")
                .get().build()
            http.newCall(req).execute().use { resp ->
                val json = safeJson(resp.body?.string())
                val active = json.optInt("active_sessions", 0)
                val limit  = json.optInt("login_limit", 5)
                Pair(active, limit)
            }
        } catch (_: Exception) { null }
    }

    // ── Set login limit dialog (first-login device only) ──────────────────────

    private fun showSetLimitDialog() {
        val etLimit = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = "Enter limit (1–100)"
            setPadding(48, 32, 48, 32)
        }
        AlertDialog.Builder(this)
            .setTitle("Set Login Limit")
            .setMessage("Max devices that can login with this App ID at once:")
            .setView(etLimit)
            .setPositiveButton("Save") { _, _ ->
                val n = etLimit.text.toString().trim().toIntOrNull()
                if (n == null || n < 1 || n > 100) {
                    toast("Enter a number between 1 and 100")
                } else {
                    setLimitOnBackend(n)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun setLimitOnBackend(newLimit: Int) {
        setLoading(true)
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    val body = JSONObject()
                        .put("sub_id", deviceId)
                        .put("new_limit", newLimit)
                        .toString().toRequestBody("application/json".toMediaType())
                    val req = Request.Builder()
                        .url("${Constants.DEVICE_API_BASE_URL}/set-login-limit")
                        .patch(body).build()
                    val resp = http.newCall(req).execute()
                    val json = safeJson(resp.body?.string())
                    if (resp.isSuccessful && json.optBoolean("ok", false)) null
                    else json.optString("error", "Failed to update limit")
                } catch (e: Exception) { "Connection error: ${e.message}" }
            }
            withContext(Dispatchers.Main) {
                setLoading(false)
                if (!isActivityAlive()) return@withContext
                if (result == null) {
                    toast("Login limit updated to $newLimit")
                    fetchAndShowLoginInfo()
                } else {
                    toast(result)
                }
            }
        }
    }

    // ── Change password ───────────────────────────────────────────────────────

    private fun updatePassword() {
        val currentPw = etCurrentPassword.text?.toString()?.trim().orEmpty()
        val newPw     = etNewPassword.text?.toString()?.trim().orEmpty()
        val confirmPw = etConfirmPassword.text?.toString()?.trim().orEmpty()
        clearChangeErrors()
        if (currentPw.isEmpty()) { tilCurrentPassword.error = "Current password required"; return }
        if (newPw.length < 4)    { tilNewPassword.error = "Minimum 4 characters"; return }
        if (newPw != confirmPw)  { tilConfirmPassword.error = "Passwords do not match"; return }
        setLoading(true)
        scope.launch {
            val result = callChangePassword(currentPw, newPw)
            withContext(Dispatchers.Main) {
                setLoading(false)
                if (result.ok) { toast("Password updated successfully"); clearInputs(); showPane(Pane.DISCLAIMER) }
                else { tilCurrentPassword.error = result.error ?: "Failed"; toast(result.error ?: "Failed to change password") }
            }
        }
    }

    private suspend fun callChangePassword(oldPw: String, newPw: String): ApiResult = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject()
                .put("old_password", oldPw)
                .put("new_password", newPw)
                .put("sub_id", deviceId)
                .toString().toRequestBody("application/json".toMediaType())
            val req = Request.Builder().url("${Constants.DEVICE_API_BASE_URL}/admin-change-password").post(body).build()
            val resp = http.newCall(req).execute()
            val json = safeJson(resp.body?.string())
            if (resp.isSuccessful && json.optBoolean("ok", false)) ApiResult(ok = true)
            else ApiResult(ok = false, error = json.optString("error", "Failed to change password"))
        } catch (e: Exception) { ApiResult(ok = false, error = "Connection error: ${e.message}") }
    }

    // ── Logout all ────────────────────────────────────────────────────────────

    private fun showLogoutAllConfirmation() {
        AlertDialog.Builder(this)
            .setTitle("Logout All Devices")
            .setMessage("This will logout ALL logged-in instances. Continue?")
            .setPositiveButton("Yes, Logout All") { _, _ -> performLogoutAll() }
            .setNegativeButton("No", null)
            .show()
    }

    private fun performLogoutAll() {
        setLoading(true)
        scope.launch {
            withContext(Dispatchers.IO) {
                try {
                    val req = Request.Builder()
                        .url("${Constants.DEVICE_API_BASE_URL.trimEnd('/').replace("/api/device/${Constants.APP_TOKEN}", "")}/api/admin/sessions/app/${Constants.APP_TOKEN}/all")
                        .delete().build()
                    http.newCall(req).execute().use { }
                } catch (_: Exception) { }
                try {
                    rootRef.child("control").child("logoutAllAt")
                        .setValue(com.google.firebase.database.ServerValue.TIMESTAMP)
                } catch (_: Exception) { }
            }
            withContext(Dispatchers.Main) {
                if (!isActivityAlive()) return@withContext
                SessionManager.setLoggedIn(this@LogicActivity, false)
                stopSessionMonitoring()
                setLoading(false)
                toast("All sessions logged out")
                clearInputs()
                showPane(Pane.LOGIN)
            }
        }
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private fun showPane(which: Pane) {
        loginPane.visibility      = if (which == Pane.LOGIN)      View.VISIBLE else View.GONE
        disclaimerPane.visibility = if (which == Pane.DISCLAIMER) View.VISIBLE else View.GONE
        changePane.visibility     = if (which == Pane.CHANGE)     View.VISIBLE else View.GONE
        btnLogoutAll.visibility   = if (which == Pane.DISCLAIMER) View.VISIBLE else View.GONE

        if (which == Pane.LOGIN) etPassword.text?.clear()

        if (which == Pane.DISCLAIMER) {
            // Password change restriction
            val canChange = SessionManager.canChangePassword(this)
            if (canChange) {
                btnChangeFromDisclaimerTv.alpha = 1.0f
                btnChangeFromDisclaimerTv.text  = "Change Password"
            } else {
                btnChangeFromDisclaimerTv.alpha = 0.45f
                btnChangeFromDisclaimerTv.text  = "Change Password\n(Not Allowed)"
            }

            // Set Limit button: only for first-login device
            btnSetLimit.visibility = if (canChange) View.VISIBLE else View.GONE

            // Fetch and display live session count
            tvSessionCount.text = "Loading..."
            fetchAndShowLoginInfo()
        }
    }

    private fun setLoading(loading: Boolean) {
        progress.visibility                 = if (loading) View.VISIBLE else View.GONE
        btnLoginTv.isEnabled                = !loading
        btnSkipTv.isEnabled                 = !loading
        btnChangeFromDisclaimerTv.isEnabled = !loading
        btnLogoutAll.isEnabled              = !loading
        btnSetLimit.isEnabled               = !loading
        btnSaveTv.isEnabled                 = !loading
        btnCancelTv.isEnabled               = !loading
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

    private fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    private fun isLoggedInNow()   = SessionManager.isLoggedIn(this)
    private fun isActivityAlive() = !isDestroyed && !isFinishing

    private data class ApiResult(
        val ok: Boolean,
        val error: String? = null,
        val sessionId: Long = -1L,
        val isAuthError: Boolean = true,
        val canChangePassword: Boolean = true
    )
}
