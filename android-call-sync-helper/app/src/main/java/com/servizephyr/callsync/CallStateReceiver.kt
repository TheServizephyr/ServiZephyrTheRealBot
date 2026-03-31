package com.servizephyr.callsync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER).orEmpty()
        val config = CallSyncStore.load(context)
        if (config.token.isBlank() || config.serverBaseUrl.isBlank()) return

        val normalizedState = when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> "ringing"
            TelephonyManager.EXTRA_STATE_IDLE -> "ended"
            TelephonyManager.EXTRA_STATE_OFFHOOK -> "offhook"
            else -> return
        }

        CoroutineScope(Dispatchers.IO).launch {
            pushCallEvent(config, incomingNumber, normalizedState)
        }
    }

    private fun pushCallEvent(config: CallSyncConfig, phone: String, state: String) {
        val endpoint = "${config.serverBaseUrl}/api/call-sync/push"
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10000
            readTimeout = 10000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }

        try {
            val payload = JSONObject()
                .put("token", config.token)
                .put("phone", phone)
                .put("state", state)
                .put("deviceId", config.deviceId)
                .toString()

            OutputStreamWriter(connection.outputStream).use { writer ->
                writer.write(payload)
                writer.flush()
            }

            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }
}
