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

class MainActivity : AppCompatActivity() {
    private lateinit var serverInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var statusText: TextView

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        updatePermissionStatus()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverInput = findViewById(R.id.serverInput)
        tokenInput = findViewById(R.id.tokenInput)
        statusText = findViewById(R.id.statusText)
        val saveButton: Button = findViewById(R.id.saveButton)
        val permissionButton: Button = findViewById(R.id.permissionButton)

        val config = CallSyncStore.load(this)
        serverInput.setText(config.serverBaseUrl)
        tokenInput.setText(config.token)

        saveButton.setOnClickListener {
            CallSyncStore.save(
                context = this,
                serverBaseUrl = serverInput.text.toString(),
                token = tokenInput.text.toString()
            )
            statusText.text = getString(R.string.settings_saved)
        }

        permissionButton.setOnClickListener {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.READ_CALL_LOG
                )
            )
        }

        updatePermissionStatus()
    }

    private fun updatePermissionStatus() {
        val hasPhoneState = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED
        val hasCallLog = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED

        statusText.text = if (hasPhoneState && hasCallLog) {
            getString(R.string.permissions_ready)
        } else {
            getString(R.string.permissions_missing)
        }
    }
}
