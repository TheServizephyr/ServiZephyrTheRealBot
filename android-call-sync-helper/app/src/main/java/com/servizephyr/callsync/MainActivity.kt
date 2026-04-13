package com.servizephyr.callsync

import android.Manifest
import android.app.TimePickerDialog
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.text.method.HideReturnsTransformationMethod
import android.text.method.PasswordTransformationMethod
import android.text.format.DateFormat as AndroidDateFormat
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import com.google.android.material.card.MaterialCardView
import com.google.android.material.materialswitch.MaterialSwitch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Calendar
import java.util.Date

class MainActivity : AppCompatActivity() {
    private lateinit var drawerLayout: DrawerLayout
    private lateinit var menuButton: ImageButton
    private lateinit var themeSwitch: MaterialSwitch
    private lateinit var syncPowerButton: ImageButton
    private lateinit var syncButtonCard: MaterialCardView
    private lateinit var warningBannerCard: MaterialCardView
    private lateinit var warningTitleText: TextView
    private lateinit var warningMessageText: TextView
    private lateinit var statusLabel: TextView
    private lateinit var statusText: TextView
    private lateinit var scheduleSummaryText: TextView
    private lateinit var quickStatusText: TextView
    private lateinit var mainInfoText: TextView
    private lateinit var testConnectionButton: Button
    private lateinit var tokenEditButton: Button
    private lateinit var tokenVisibilityButton: ImageButton
    private lateinit var scheduleEditButton: Button
    private lateinit var tokenInput: EditText
    private lateinit var primaryUrlValue: TextView
    private lateinit var backupUrlValue: TextView
    private lateinit var scheduleSwitch: MaterialSwitch
    private lateinit var openTimeButton: Button
    private lateinit var closeTimeButton: Button
    private lateinit var networkCheckButton: Button
    private lateinit var retryPendingButton: Button
    private lateinit var dummyCallButton: Button
    private lateinit var pendingStatusText: TextView
    private lateinit var lastSuccessText: TextView
    private lateinit var networkStatusText: TextView
    private lateinit var debugText: TextView

    private lateinit var connectivityManager: ConnectivityManager
    private var networkCallbackRegistered = false
    private var selectedOpenMinutes: Int = 10 * 60
    private var selectedCloseMinutes: Int = 23 * 60
    private var isTokenEditing = false
    private var isTokenVisible = false
    private var isScheduleEditing = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            runOnUiThread { warmHostsInBackground(force = false) }
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        applyThemeFromPrefs()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        bindViews()
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        val config = CallSyncStore.load(this)
        selectedOpenMinutes = config.openMinutes
        selectedCloseMinutes = config.closeMinutes

        menuButton.setOnClickListener { toggleDrawer() }
        themeSwitch.setOnCheckedChangeListener { _, isChecked ->
            CallSyncStore.setDarkMode(this, isChecked)
            AppCompatDelegate.setDefaultNightMode(
                if (isChecked) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
            )
        }

        syncPowerButton.setOnClickListener {
            val nextEnabled = !CallSyncStore.load(this).isSyncEnabled
            CallSyncStore.setSyncEnabled(this, nextEnabled)
            CallSyncStore.saveDebugSnapshot(
                context = this,
                lastEvent = "toggle",
                lastNumber = "",
                lastResult = if (nextEnabled) "Sync enabled from app" else "Sync disabled from app"
            )
            refreshUi()
        }

        testConnectionButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            runBackgroundAction("manual-test", "") {
                CallSyncPushService.testConnection(this, configToUse)
            }
        }

        dummyCallButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            val dummyPhone = buildDummyPhoneNumber()
            runBackgroundAction("dummy-call", dummyPhone) {
                CallSyncPushService.pushEvent(
                    context = this,
                    config = configToUse,
                    event = CallSyncEvent(
                        phone = dummyPhone,
                        state = "ringing",
                        timestampMs = System.currentTimeMillis(),
                        deviceId = configToUse.deviceId
                    )
                )
            }
        }

        retryPendingButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            runBackgroundAction("manual-retry", "") {
                CallSyncPushService.flushPendingEvents(this, configToUse)
            }
        }

        networkCheckButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            runBackgroundAction("network-check", "") {
                CallSyncPushService.checkNetworkDns(configToUse)
            }
        }

        tokenEditButton.setOnClickListener {
            if (!isTokenEditing) {
                isTokenEditing = true
            } else {
                isTokenEditing = false
                persistCurrentConfig()
            }
            updateEditorStates()
        }

        tokenVisibilityButton.setOnClickListener {
            isTokenVisible = !isTokenVisible
            updateTokenVisibility()
        }

        scheduleEditButton.setOnClickListener {
            if (!isScheduleEditing) {
                isScheduleEditing = true
            } else {
                isScheduleEditing = false
                persistCurrentConfig()
            }
            updateEditorStates()
        }

        openTimeButton.setOnClickListener {
            if (!isScheduleEditing) return@setOnClickListener
            showTimePicker(selectedOpenMinutes) {
                selectedOpenMinutes = it
                updateTimeButtons()
            }
        }

        closeTimeButton.setOnClickListener {
            if (!isScheduleEditing) return@setOnClickListener
            showTimePicker(selectedCloseMinutes) {
                selectedCloseMinutes = it
                updateTimeButtons()
            }
        }

        refreshUi()
    }

    override fun onResume() {
        super.onResume()
        registerNetworkCallbackIfNeeded()
        refreshUi()
        warmHostsInBackground(force = false)
    }

    override fun onPause() {
        super.onPause()
        unregisterNetworkCallbackIfNeeded()
    }

    private fun bindViews() {
        drawerLayout = findViewById(R.id.drawerLayout)
        menuButton = findViewById(R.id.menuButton)
        themeSwitch = findViewById(R.id.themeSwitch)
        syncPowerButton = findViewById(R.id.syncPowerButton)
        syncButtonCard = findViewById(R.id.syncButtonCard)
        warningBannerCard = findViewById(R.id.warningBannerCard)
        warningTitleText = findViewById(R.id.warningTitleText)
        warningMessageText = findViewById(R.id.warningMessageText)
        statusLabel = findViewById(R.id.statusLabel)
        statusText = findViewById(R.id.statusText)
        scheduleSummaryText = findViewById(R.id.scheduleSummaryText)
        quickStatusText = findViewById(R.id.quickStatusText)
        mainInfoText = findViewById(R.id.mainInfoText)
        testConnectionButton = findViewById(R.id.testConnectionButton)
        tokenEditButton = findViewById(R.id.tokenEditButton)
        tokenVisibilityButton = findViewById(R.id.tokenVisibilityButton)
        scheduleEditButton = findViewById(R.id.scheduleEditButton)
        tokenInput = findViewById(R.id.tokenInput)
        primaryUrlValue = findViewById(R.id.primaryUrlValue)
        backupUrlValue = findViewById(R.id.backupUrlValue)
        scheduleSwitch = findViewById(R.id.scheduleSwitch)
        openTimeButton = findViewById(R.id.openTimeButton)
        closeTimeButton = findViewById(R.id.closeTimeButton)
        networkCheckButton = findViewById(R.id.networkCheckButton)
        retryPendingButton = findViewById(R.id.retryPendingButton)
        dummyCallButton = findViewById(R.id.dummyCallButton)
        pendingStatusText = findViewById(R.id.pendingStatusText)
        lastSuccessText = findViewById(R.id.lastSuccessText)
        networkStatusText = findViewById(R.id.networkStatusText)
        debugText = findViewById(R.id.debugText)
    }

    private fun applyThemeFromPrefs() {
        val config = CallSyncStore.load(this)
        AppCompatDelegate.setDefaultNightMode(
            if (config.isDarkMode) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
        )
    }

    private fun refreshUi() {
        val config = CallSyncStore.load(this)
        val hasPhoneState = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED
        val hasCallLog = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED
        val hasPermissions = hasPhoneState && hasCallLog
        val withinHours = CallSyncStore.isWithinOperatingHours(config, currentMinutes())
        val debugSnapshot = CallSyncStore.loadDebugSnapshot(this)

        themeSwitch.isChecked = config.isDarkMode
        primaryUrlValue.text = config.serverBaseUrl
        backupUrlValue.text = config.backupServerBaseUrl
        tokenInput.setText(config.token)
        selectedOpenMinutes = config.openMinutes
        selectedCloseMinutes = config.closeMinutes
        scheduleSwitch.isChecked = config.isScheduleEnabled
        updateTimeButtons()
        updateEditorStates()

        statusLabel.text = if (config.isSyncEnabled) getString(R.string.sync_on_label) else getString(R.string.sync_off_label)
        statusText.text = when {
            !config.isSyncEnabled -> getString(R.string.sync_disabled)
            !withinHours -> getString(R.string.outside_schedule)
            hasPermissions -> getString(R.string.permissions_ready)
            else -> getString(R.string.permissions_missing)
        }
        scheduleSummaryText.text = if (config.isScheduleEnabled) {
            getString(R.string.schedule_summary_on, formatMinutes(config.openMinutes), formatMinutes(config.closeMinutes))
        } else {
            getString(R.string.schedule_summary_off)
        }
        syncButtonCard.setCardBackgroundColor(if (config.isSyncEnabled) Color.parseColor("#FFCC1B") else Color.parseColor("#D8D0E8"))
        quickStatusText.text = buildQuickStatus(debugSnapshot.lastResult)
        mainInfoText.text = buildMainInfoText(config, debugSnapshot)

        pendingStatusText.text = getString(R.string.pending_events, CallSyncPushService.getPendingEventCount(this))
        lastSuccessText.text = buildLastSuccessText()
        networkStatusText.text = getString(
            R.string.network_status_value,
            if (debugSnapshot.lastEvent == "network-check") debugSnapshot.lastResult.ifBlank { getString(R.string.network_status_unknown) }
            else getString(R.string.network_status_unknown)
        )
        debugText.text = buildDebugText(debugSnapshot)
        warningBannerCard.setOnClickListener {
            if (!hasPermissions) {
                permissionLauncher.launch(
                    arrayOf(
                        Manifest.permission.READ_PHONE_STATE,
                        Manifest.permission.READ_CALL_LOG
                    )
                )
            }
        }

        applyWarningBanner(debugSnapshot.lastEvent, debugSnapshot.lastResult, config.isSyncEnabled, hasPermissions, withinHours)
    }

    private fun updateEditorStates() {
        tokenInput.isEnabled = isTokenEditing
        tokenEditButton.text = if (isTokenEditing) getString(R.string.save_label) else getString(R.string.edit_label)
        scheduleSwitch.isEnabled = isScheduleEditing
        openTimeButton.isEnabled = isScheduleEditing
        closeTimeButton.isEnabled = isScheduleEditing
        scheduleEditButton.text = if (isScheduleEditing) getString(R.string.save_label) else getString(R.string.edit_label)
        updateTokenVisibility()
    }

    private fun updateTokenVisibility() {
        tokenInput.transformationMethod = if (isTokenVisible) {
            HideReturnsTransformationMethod.getInstance()
        } else {
            PasswordTransformationMethod.getInstance()
        }
        tokenInput.setSelection(tokenInput.text?.length ?: 0)
        tokenVisibilityButton.contentDescription = if (isTokenVisible) getString(R.string.hide_token) else getString(R.string.show_token)
    }

    private fun buildQuickStatus(latestResult: String): String {
        val normalized = latestResult.lowercase()
        return when {
            normalized.contains("dns failed") -> getString(R.string.quick_status_dns_issue)
            normalized.contains("timeout") || normalized.contains("unable") -> getString(R.string.quick_status_network_issue)
            normalized.contains("http 200") -> getString(R.string.quick_status_healthy)
            latestResult.isBlank() -> getString(R.string.quick_status_idle)
            else -> getString(R.string.quick_status_monitoring)
        }
    }

    private fun buildMainInfoText(config: CallSyncConfig, debugSnapshot: CallSyncStore.DebugSnapshot): String {
        val lastSuccess = CallSyncPushService.getLastSuccessAt(this)
        val lastSuccessText = if (lastSuccess > 0L) {
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(lastSuccess))
        } else {
            getString(R.string.last_success_not_yet_short)
        }
        return getString(
            R.string.main_info_template,
            if (config.isSyncEnabled) getString(R.string.sync_state_enabled) else getString(R.string.sync_state_disabled),
            lastSuccessText,
            debugSnapshot.lastEvent.ifBlank { getString(R.string.none_label) }
        )
    }

    private fun buildLastSuccessText(): String {
        val lastSuccessAt = CallSyncPushService.getLastSuccessAt(this)
        return if (lastSuccessAt > 0L) {
            getString(
                R.string.last_success,
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(lastSuccessAt))
            )
        } else {
            getString(R.string.last_success_never)
        }
    }

    private fun buildDebugText(debugSnapshot: CallSyncStore.DebugSnapshot): String = buildString {
        append(getString(R.string.debug_last_event, debugSnapshot.lastEvent.ifBlank { getString(R.string.none_label) }))
        append("\n")
        append(getString(R.string.debug_last_number, debugSnapshot.lastNumber.ifBlank { "empty" }))
        append("\n")
        append(getString(R.string.debug_last_result, debugSnapshot.lastResult.ifBlank { getString(R.string.none_label) }))
        if (debugSnapshot.lastUpdatedAt > 0L) {
            append("\n")
            append(getString(
                R.string.debug_last_updated,
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(debugSnapshot.lastUpdatedAt))
            ))
        }
    }

    private fun applyWarningBanner(
        lastEvent: String,
        latestResult: String,
        isSyncEnabled: Boolean,
        hasPermissions: Boolean,
        withinHours: Boolean
    ) {
        if (!isSyncEnabled || !withinHours) {
            showBanner(getString(R.string.banner_paused_title), getString(R.string.banner_paused_message), "#FFE7A6")
            return
        }
        if (!hasPermissions) {
            showBanner(getString(R.string.banner_permission_title), getString(R.string.banner_permission_message), "#FFCDD2")
            return
        }

        val normalized = latestResult.lowercase()
        when {
            normalized.contains("dns failed") -> showBanner(
                getString(R.string.banner_dns_title),
                getString(R.string.banner_dns_message),
                "#FFE082"
            )
            normalized.contains("timeout") || normalized.contains("unable") || normalized.contains("error:") -> showBanner(
                getString(R.string.banner_network_title),
                getString(R.string.banner_network_message),
                "#FFCDD2"
            )
            lastEvent in setOf("manual-test", "network-check", "dummy-call") && normalized.contains("http 200") -> showBanner(
                getString(R.string.banner_healthy_title),
                getString(R.string.banner_healthy_message),
                "#C8E6C9"
            )
            else -> hideBanner()
        }
    }

    private fun showBanner(title: String, message: String, backgroundColor: String) {
        warningBannerCard.visibility = android.view.View.VISIBLE
        warningBannerCard.setCardBackgroundColor(Color.parseColor(backgroundColor))
        warningTitleText.text = title
        warningMessageText.text = message
    }

    private fun hideBanner() {
        warningBannerCard.visibility = android.view.View.GONE
    }

    private fun persistCurrentConfig(): CallSyncConfig {
        CallSyncStore.save(
            context = this,
            serverBaseUrl = CallSyncStore.DEFAULT_SERVER_BASE_URL,
            backupServerBaseUrl = CallSyncStore.DEFAULT_BACKUP_SERVER_BASE_URL,
            token = tokenInput.text.toString(),
            isScheduleEnabled = scheduleSwitch.isChecked,
            openMinutes = selectedOpenMinutes,
            closeMinutes = selectedCloseMinutes
        )
        return CallSyncStore.load(this)
    }

    private fun canRunSyncActions(config: CallSyncConfig): Boolean {
        if (config.serverBaseUrl.isBlank() || config.token.isBlank()) {
            CallSyncStore.saveDebugSnapshot(this, "manual-check", "", getString(R.string.not_configured))
            refreshUi()
            return false
        }
        return true
    }

    private fun runBackgroundAction(debugEvent: String, debugNumber: String, action: () -> PushAttemptResult) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = action()
            CallSyncStore.saveDebugSnapshot(this@MainActivity, debugEvent, debugNumber, result.message)
            runOnUiThread { refreshUi() }
        }
    }

    private fun warmHostsInBackground(force: Boolean) {
        val config = CallSyncStore.load(this)
        if (config.serverBaseUrl.isBlank() || config.token.isBlank()) return
        CoroutineScope(Dispatchers.IO).launch {
            val result = CallSyncPushService.warmHosts(this@MainActivity, config, force)
            if (!result.success) {
                CallSyncStore.saveDebugSnapshot(this@MainActivity, "warm-up", "", result.message)
                runOnUiThread { refreshUi() }
            }
        }
    }

    private fun registerNetworkCallbackIfNeeded() {
        if (networkCallbackRegistered) return
        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback)
            networkCallbackRegistered = true
        } catch (_: Exception) {
            networkCallbackRegistered = false
        }
    }

    private fun unregisterNetworkCallbackIfNeeded() {
        if (!networkCallbackRegistered) return
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) {
        } finally {
            networkCallbackRegistered = false
        }
    }

    private fun toggleDrawer() {
        if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
            drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            drawerLayout.openDrawer(GravityCompat.START)
        }
    }

    private fun showTimePicker(initialMinutes: Int, onSelected: (Int) -> Unit) {
        val hour = initialMinutes / 60
        val minute = initialMinutes % 60
        TimePickerDialog(
            this,
            { _, pickedHour, pickedMinute -> onSelected((pickedHour * 60) + pickedMinute) },
            hour,
            minute,
            AndroidDateFormat.is24HourFormat(this)
        ).show()
    }

    private fun updateTimeButtons() {
        openTimeButton.text = formatMinutes(selectedOpenMinutes)
        closeTimeButton.text = formatMinutes(selectedCloseMinutes)
    }

    private fun formatMinutes(totalMinutes: Int): String {
        val hour = (totalMinutes / 60) % 24
        val minute = totalMinutes % 60
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
        }
        return DateFormat.getTimeInstance(DateFormat.SHORT).format(calendar.time)
    }

    private fun currentMinutes(): Int {
        val calendar = Calendar.getInstance()
        return calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    }

    private fun buildDummyPhoneNumber(): String {
        val suffix = (System.currentTimeMillis() % 1_000_000_000L).toString().padStart(9, '0')
        return "9$suffix".take(10)
    }
}
