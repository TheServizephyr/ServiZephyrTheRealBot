package com.servizephyr.callsync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER).orEmpty()
        val config = CallSyncStore.load(context)
        if (!config.isSyncEnabled) {
            CallSyncStore.saveDebugSnapshot(
                context = context,
                lastEvent = state,
                lastNumber = incomingNumber,
                lastResult = "Sync disabled"
            )
            return
        }
        if (config.token.isBlank() || config.serverBaseUrl.isBlank()) {
            CallSyncStore.saveDebugSnapshot(
                context = context,
                lastEvent = state,
                lastNumber = incomingNumber,
                lastResult = "Missing token or server URL"
            )
            return
        }

        val normalizedState = when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> "ringing"
            TelephonyManager.EXTRA_STATE_IDLE -> "ended"
            TelephonyManager.EXTRA_STATE_OFFHOOK -> "offhook"
            else -> return
        }

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                pushCallEvent(context, config, incomingNumber, normalizedState)
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun pushCallEvent(context: Context, config: CallSyncConfig, phone: String, state: String) {
        val endpoint = "${CallSyncStore.normalizeServerBaseUrl(config.serverBaseUrl)}/api/call-sync/push"
        val payload = JSONObject()
            .put("token", config.token)
            .put("phone", phone)
            .put("state", state)
            .put("deviceId", config.deviceId)
            .toString()

        val response = executePost(endpoint, payload, redirectDepth = 0)

        CallSyncStore.saveDebugSnapshot(
            context = context,
            lastEvent = state,
            lastNumber = phone,
            lastResult = response.debugMessage
        )
    }

    private data class PushResponse(
        val code: Int,
        val body: String,
        val debugMessage: String
    )

    private fun openJsonPostConnection(endpoint: String): HttpURLConnection {
        return (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10000
            readTimeout = 10000
            doOutput = true
            instanceFollowRedirects = false
            setRequestProperty("Content-Type", "application/json")
        }
    }

    private fun executePost(endpoint: String, payload: String, redirectDepth: Int): PushResponse {
        val connection = openJsonPostConnection(endpoint)
        try {
            OutputStreamWriter(connection.outputStream).use { writer ->
                writer.write(payload)
                writer.flush()
            }

            val responseCode = connection.responseCode
            val redirectLocation = connection.getHeaderField("Location")
            if (
                responseCode in listOf(
                    HttpURLConnection.HTTP_MOVED_PERM,
                    HttpURLConnection.HTTP_MOVED_TEMP,
                    HttpURLConnection.HTTP_SEE_OTHER,
                    307,
                    308
                ) &&
                !redirectLocation.isNullOrBlank() &&
                redirectDepth < 3
            ) {
                return executePost(redirectLocation, payload, redirectDepth + 1)
            }

            val responseText = readStream(
                if (responseCode in 200..299) connection.inputStream else connection.errorStream
            )

            return PushResponse(
                code = responseCode,
                body = responseText,
                debugMessage = buildString {
                    append("HTTP ")
                    append(responseCode)
                    if (responseText.isNotBlank()) {
                        append(": ")
                        append(responseText.take(180))
                    }
                }
            )
        } catch (error: Exception) {
            return PushResponse(
                code = -1,
                body = "",
                debugMessage = "Error: ${error.message ?: "unknown"}"
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun readStream(stream: InputStream?): String {
        if (stream == null) return ""
        return BufferedReader(InputStreamReader(stream)).use { reader ->
            reader.readText()
        }
    }
}
