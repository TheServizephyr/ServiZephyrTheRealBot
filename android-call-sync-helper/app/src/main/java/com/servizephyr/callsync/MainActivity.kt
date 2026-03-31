package com.servizephyr.callsync

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.materialswitch.MaterialSwitch
import java.text.DateFormat
import java.util.Date

class MainActivity : AppCompatActivity() {
    private lateinit var serverInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var syncToggle: MaterialSwitch
    private lateinit var statusText: TextView
    private lateinit var debugText: TextView

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverInput = findViewById(R.id.serverInput)
        tokenInput = findViewById(R.id.tokenInput)
        syncToggle = findViewById(R.id.syncToggle)
        statusText = findViewById(R.id.statusText)
        debugText = findViewById(R.id.debugText)
        val saveButton: Button = findViewById(R.id.saveButton)
        val permissionButton: Button = findViewById(R.id.permissionButton)

        val config = CallSyncStore.load(this)
        serverInput.setText(config.serverBaseUrl)
        tokenInput.setText(config.token)
        syncToggle.isChecked = config.isSyncEnabled

        saveButton.setOnClickListener {
            val normalizedBaseUrl = CallSyncStore.normalizeServerBaseUrl(serverInput.text.toString())
            CallSyncStore.save(
                context = this,
                serverBaseUrl = normalizedBaseUrl,
                token = tokenInput.text.toString()
            )
            serverInput.setText(normalizedBaseUrl)
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

        syncToggle.setOnCheckedChangeListener { _, isChecked ->
            CallSyncStore.setSyncEnabled(this, isChecked)
            CallSyncStore.saveDebugSnapshot(
                context = this,
                lastEvent = "toggle",
                lastNumber = "",
                lastResult = if (isChecked) "Sync enabled from app" else "Sync disabled from app"
            )
            refreshUi()
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
        syncToggle.isChecked = config.isSyncEnabled

        statusText.text = if (!config.isSyncEnabled) {
            getString(R.string.sync_disabled)
        } else if (hasPhoneState && hasCallLog) {
            getString(R.string.permissions_ready)
        } else {
            getString(R.string.permissions_missing)
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
    }
}
