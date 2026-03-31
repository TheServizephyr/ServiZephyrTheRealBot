package com.servizephyr.callsync

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.card.MaterialCardView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

class MainActivity : AppCompatActivity() {
    private lateinit var serverInput: EditText
    private lateinit var backupServerInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var syncPowerButton: ImageButton
    private lateinit var syncButtonCard: MaterialCardView
    private lateinit var statusText: TextView
    private lateinit var statusLabel: TextView
    private lateinit var debugText: TextView
    private lateinit var pendingStatusText: TextView
    private lateinit var lastSuccessText: TextView

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverInput = findViewById(R.id.serverInput)
        backupServerInput = findViewById(R.id.backupServerInput)
        tokenInput = findViewById(R.id.tokenInput)
        syncPowerButton = findViewById(R.id.syncPowerButton)
        syncButtonCard = findViewById(R.id.syncButtonCard)
        statusText = findViewById(R.id.statusText)
        statusLabel = findViewById(R.id.statusLabel)
        debugText = findViewById(R.id.debugText)
        pendingStatusText = findViewById(R.id.pendingStatusText)
        lastSuccessText = findViewById(R.id.lastSuccessText)
        val saveButton: Button = findViewById(R.id.saveButton)
        val permissionButton: Button = findViewById(R.id.permissionButton)
        val testConnectionButton: Button = findViewById(R.id.testConnectionButton)
        val retryPendingButton: Button = findViewById(R.id.retryPendingButton)

        val config = CallSyncStore.load(this)
        serverInput.setText(config.serverBaseUrl)
        backupServerInput.setText(config.backupServerBaseUrl)
        tokenInput.setText(config.token)

        saveButton.setOnClickListener {
            val normalizedBaseUrl = CallSyncStore.normalizeServerBaseUrl(serverInput.text.toString())
            val normalizedBackupUrl = CallSyncStore.normalizeServerBaseUrl(backupServerInput.text.toString())
            CallSyncStore.save(
                context = this,
                serverBaseUrl = normalizedBaseUrl,
                backupServerBaseUrl = normalizedBackupUrl,
                token = tokenInput.text.toString()
            )
            serverInput.setText(normalizedBaseUrl)
            backupServerInput.setText(normalizedBackupUrl)
            statusText.text = getString(R.string.settings_saved)
            refreshUi()
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

        val statusMessage = if (!config.isSyncEnabled) {
            getString(R.string.sync_disabled)
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

        val debugSnapshot = CallSyncStore.loadDebugSnapshot(this)
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
        val normalizedBaseUrl = CallSyncStore.normalizeServerBaseUrl(serverInput.text.toString())
        val normalizedBackupUrl = CallSyncStore.normalizeServerBaseUrl(backupServerInput.text.toString())
        CallSyncStore.save(
            context = this,
            serverBaseUrl = normalizedBaseUrl,
            backupServerBaseUrl = normalizedBackupUrl,
            token = tokenInput.text.toString()
        )
        serverInput.setText(normalizedBaseUrl)
        backupServerInput.setText(normalizedBackupUrl)
        tokenInput.setText(tokenInput.text.toString().trim())
        return CallSyncStore.load(this)
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
}
