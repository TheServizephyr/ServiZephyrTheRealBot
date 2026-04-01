package com.servizephyr.callsync

import android.Manifest
import android.app.TimePickerDialog
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.text.format.DateFormat as AndroidDateFormat
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.card.MaterialCardView
import com.google.android.material.switchmaterial.SwitchMaterial
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Calendar
import java.util.Date

class MainActivity : AppCompatActivity() {
    private lateinit var tokenInput: EditText
    private lateinit var syncPowerButton: ImageButton
    private lateinit var syncButtonCard: MaterialCardView
    private lateinit var settingsCard: MaterialCardView
    private lateinit var statusText: TextView
    private lateinit var statusLabel: TextView
    private lateinit var debugText: TextView
    private lateinit var pendingStatusText: TextView
    private lateinit var lastSuccessText: TextView
    private lateinit var networkStatusText: TextView
    private lateinit var primaryUrlValue: TextView
    private lateinit var backupUrlValue: TextView
    private lateinit var scheduleSummaryText: TextView
    private lateinit var settingsToggleButton: Button
    private lateinit var settingsActionsRow: LinearLayout
    private lateinit var scheduleSwitch: SwitchMaterial
    private lateinit var openTimeButton: Button
    private lateinit var closeTimeButton: Button
    private var isSettingsVisible: Boolean = false
    private var selectedOpenMinutes: Int = 10 * 60
    private var selectedCloseMinutes: Int = 23 * 60

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tokenInput = findViewById(R.id.tokenInput)
        syncPowerButton = findViewById(R.id.syncPowerButton)
        syncButtonCard = findViewById(R.id.syncButtonCard)
        settingsCard = findViewById(R.id.settingsCard)
        statusText = findViewById(R.id.statusText)
        statusLabel = findViewById(R.id.statusLabel)
        debugText = findViewById(R.id.debugText)
        pendingStatusText = findViewById(R.id.pendingStatusText)
        lastSuccessText = findViewById(R.id.lastSuccessText)
        networkStatusText = findViewById(R.id.networkStatusText)
        primaryUrlValue = findViewById(R.id.primaryUrlValue)
        backupUrlValue = findViewById(R.id.backupUrlValue)
        scheduleSummaryText = findViewById(R.id.scheduleSummaryText)
        settingsToggleButton = findViewById(R.id.settingsToggleButton)
        settingsActionsRow = findViewById(R.id.settingsActionsRow)
        scheduleSwitch = findViewById(R.id.scheduleSwitch)
        openTimeButton = findViewById(R.id.openTimeButton)
        closeTimeButton = findViewById(R.id.closeTimeButton)
        val saveButton: Button = findViewById(R.id.saveButton)
        val dummyCallButton: Button = findViewById(R.id.dummyCallButton)
        val permissionButton: Button = findViewById(R.id.permissionButton)
        val testConnectionButton: Button = findViewById(R.id.testConnectionButton)
        val retryPendingButton: Button = findViewById(R.id.retryPendingButton)
        val networkCheckButton: Button = findViewById(R.id.networkCheckButton)

        val config = CallSyncStore.load(this)
        primaryUrlValue.text = config.serverBaseUrl
        backupUrlValue.text = config.backupServerBaseUrl
        tokenInput.setText(config.token)
        selectedOpenMinutes = config.openMinutes
        selectedCloseMinutes = config.closeMinutes
        scheduleSwitch.isChecked = config.isScheduleEnabled
        updateTimeButtons()
        settingsCard.visibility = android.view.View.GONE

        saveButton.setOnClickListener {
            CallSyncStore.save(
                context = this,
                serverBaseUrl = CallSyncStore.DEFAULT_SERVER_BASE_URL,
                backupServerBaseUrl = CallSyncStore.DEFAULT_BACKUP_SERVER_BASE_URL,
                token = tokenInput.text.toString(),
                isScheduleEnabled = scheduleSwitch.isChecked,
                openMinutes = selectedOpenMinutes,
                closeMinutes = selectedCloseMinutes
            )
            val savedConfig = CallSyncStore.load(this)
            primaryUrlValue.text = savedConfig.serverBaseUrl
            backupUrlValue.text = savedConfig.backupServerBaseUrl
            tokenInput.setText(savedConfig.token)
            selectedOpenMinutes = savedConfig.openMinutes
            selectedCloseMinutes = savedConfig.closeMinutes
            scheduleSwitch.isChecked = savedConfig.isScheduleEnabled
            updateTimeButtons()
            statusText.text = getString(R.string.settings_saved)
            refreshUi()
        }

        dummyCallButton.setOnClickListener {
            val configToUse = saveCurrentInputs()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            statusText.text = getString(R.string.running_check)
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

        settingsToggleButton.setOnClickListener {
            isSettingsVisible = !isSettingsVisible
            refreshUi()
        }

        openTimeButton.setOnClickListener {
            showTimePicker(selectedOpenMinutes) { minutes ->
                selectedOpenMinutes = minutes
                updateTimeButtons()
            }
        }

        closeTimeButton.setOnClickListener {
            showTimePicker(selectedCloseMinutes) { minutes ->
                selectedCloseMinutes = minutes
                updateTimeButtons()
            }
        }

        permissionButton.setOnClickListener {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.READ_CALL_LOG
                )
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
            val configToUse = saveCurrentInputs()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            statusText.text = getString(R.string.running_check)
            runBackgroundAction("manual-test", "") {
                CallSyncPushService.testConnection(this, configToUse)
            }
        }

        retryPendingButton.setOnClickListener {
            val configToUse = saveCurrentInputs()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            statusText.text = getString(R.string.running_retry)
            runBackgroundAction("manual-retry", "") {
                CallSyncPushService.flushPendingEvents(this, configToUse)
            }
        }

        networkCheckButton.setOnClickListener {
            val configToUse = saveCurrentInputs()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            statusText.text = getString(R.string.running_network_check)
            runBackgroundAction("network-check", "") {
                CallSyncPushService.checkNetworkDns(configToUse)
            }
        }

        refreshUi()
    }

    override fun onResume() {
        super.onResume()
        refreshUi()
    }

    private fun refreshUi() {
        val hasPhoneState = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED
        val hasCallLog = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED
        val config = CallSyncStore.load(this)
        primaryUrlValue.text = config.serverBaseUrl
        backupUrlValue.text = config.backupServerBaseUrl
        selectedOpenMinutes = config.openMinutes
        selectedCloseMinutes = config.closeMinutes
        if (scheduleSwitch.isPressed.not()) {
            scheduleSwitch.isChecked = config.isScheduleEnabled
        }
        updateTimeButtons()

        val currentMinutes = currentMinutes()
        val withinHours = CallSyncStore.isWithinOperatingHours(config, currentMinutes)
        val statusMessage = if (!config.isSyncEnabled) {
            getString(R.string.sync_disabled)
        } else if (!withinHours) {
            getString(R.string.outside_schedule)
        } else if (hasPhoneState && hasCallLog) {
            getString(R.string.permissions_ready)
        } else {
            getString(R.string.permissions_missing)
        }
        statusText.text = statusMessage
        statusLabel.text = if (config.isSyncEnabled) {
            getString(R.string.sync_on_label)
        } else {
            getString(R.string.sync_off_label)
        }
        val activeCardColor = if (config.isSyncEnabled) 0xFF31C46C.toInt() else 0xFF2A2532.toInt()
        syncButtonCard.setCardBackgroundColor(activeCardColor)
        syncPowerButton.alpha = if (config.isSyncEnabled) 1f else 0.7f
        syncPowerButton.contentDescription = if (config.isSyncEnabled) {
            getString(R.string.sync_disable_cta)
        } else {
            getString(R.string.sync_enable_cta)
        }
        scheduleSummaryText.text = if (config.isScheduleEnabled) {
            getString(
                R.string.schedule_summary_on,
                formatMinutes(config.openMinutes),
                formatMinutes(config.closeMinutes)
            )
        } else {
            getString(R.string.schedule_summary_off)
        }
        settingsCard.visibility = if (isSettingsVisible) android.view.View.VISIBLE else android.view.View.GONE
        settingsToggleButton.text = if (isSettingsVisible) {
            getString(R.string.hide_settings)
        } else {
            getString(R.string.open_settings)
        }

        val debugSnapshot = CallSyncStore.loadDebugSnapshot(this)
        networkStatusText.text = if (debugSnapshot.lastEvent == "network-check") {
            getString(R.string.network_status_value, debugSnapshot.lastResult.ifBlank { getString(R.string.network_status_unknown) })
        } else {
            getString(R.string.network_status_value, getString(R.string.network_status_unknown))
        }
        debugText.text = buildString {
            append(getString(R.string.debug_heading))
            append("\n")
            append(getString(R.string.debug_last_event, debugSnapshot.lastEvent.ifBlank { "none" }))
            append("\n")
            append(getString(R.string.debug_last_number, debugSnapshot.lastNumber.ifBlank { "empty" }))
            append("\n")
            append(getString(R.string.debug_last_result, debugSnapshot.lastResult.ifBlank { "none" }))
            if (debugSnapshot.lastUpdatedAt > 0L) {
                append("\n")
                append(
                    getString(
                        R.string.debug_last_updated,
                        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                            .format(Date(debugSnapshot.lastUpdatedAt))
                    )
                )
            }
        }

        pendingStatusText.text = getString(
            R.string.pending_events,
            CallSyncPushService.getPendingEventCount(this)
        )

        val lastSuccessAt = CallSyncPushService.getLastSuccessAt(this)
        lastSuccessText.text = if (lastSuccessAt > 0L) {
            getString(
                R.string.last_success,
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
                    .format(Date(lastSuccessAt))
            )
        } else {
            getString(R.string.last_success_never)
        }
    }

    private fun saveCurrentInputs(): CallSyncConfig {
        CallSyncStore.save(
            context = this,
            serverBaseUrl = CallSyncStore.DEFAULT_SERVER_BASE_URL,
            backupServerBaseUrl = CallSyncStore.DEFAULT_BACKUP_SERVER_BASE_URL,
            token = tokenInput.text.toString(),
            isScheduleEnabled = scheduleSwitch.isChecked,
            openMinutes = selectedOpenMinutes,
            closeMinutes = selectedCloseMinutes
        )
        val savedConfig = CallSyncStore.load(this)
        primaryUrlValue.text = savedConfig.serverBaseUrl
        backupUrlValue.text = savedConfig.backupServerBaseUrl
        tokenInput.setText(savedConfig.token)
        selectedOpenMinutes = savedConfig.openMinutes
        selectedCloseMinutes = savedConfig.closeMinutes
        scheduleSwitch.isChecked = savedConfig.isScheduleEnabled
        updateTimeButtons()
        return savedConfig
    }

    private fun canRunSyncActions(config: CallSyncConfig): Boolean {
        if (config.serverBaseUrl.isBlank() || config.token.isBlank()) {
            statusText.text = getString(R.string.not_configured)
            CallSyncStore.saveDebugSnapshot(
                context = this,
                lastEvent = "manual-check",
                lastNumber = "",
                lastResult = getString(R.string.not_configured)
            )
            refreshUi()
            return false
        }
        return true
    }

    private fun runBackgroundAction(
        debugEvent: String,
        debugNumber: String,
        action: () -> PushAttemptResult
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = action()
            CallSyncStore.saveDebugSnapshot(
                context = this@MainActivity,
                lastEvent = debugEvent,
                lastNumber = debugNumber,
                lastResult = result.message
            )
            runOnUiThread {
                refreshUi()
            }
        }
    }

    private fun showTimePicker(initialMinutes: Int, onSelected: (Int) -> Unit) {
        val hour = initialMinutes / 60
        val minute = initialMinutes % 60
        TimePickerDialog(
            this,
            { _, pickedHour, pickedMinute ->
                onSelected((pickedHour * 60) + pickedMinute)
            },
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
        val suffix = (System.currentTimeMillis() % 1000000000L).toString().padStart(9, '0')
        return "9$suffix".take(10)
    }
}
