package com.servizephyr.callsync

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class CallSyncEvent(
    val phone: String,
    val state: String,
    val timestampMs: Long,
    val deviceId: String
) {
    val queueKey: String
        get() = "${state}:${phone}:${timestampMs}:${deviceId}"

    fun toJson(): JSONObject = JSONObject()
        .put("phone", phone)
        .put("state", state)
        .put("timestampMs", timestampMs)
        .put("deviceId", deviceId)

    companion object {
        fun fromJson(json: JSONObject): CallSyncEvent? {
            val state = json.optString("state", "").trim()
            val timestampMs = json.optLong("timestampMs", 0L)
            val deviceId = json.optString("deviceId", "").trim()
            if (state.isBlank() || timestampMs <= 0L || deviceId.isBlank()) return null
            return CallSyncEvent(
                phone = json.optString("phone", ""),
                state = state,
                timestampMs = timestampMs,
                deviceId = deviceId
            )
        }
    }
}

data class PushAttemptResult(
    val success: Boolean,
    val message: String,
    val attemptedBaseUrl: String? = null
)

object CallSyncPushService {
    private const val PREFS = "call_sync_helper"
    private const val KEY_PENDING_EVENTS = "pending_events"
    private const val KEY_LAST_SUCCESS_AT = "last_success_at"
    private const val MAX_PENDING_EVENTS = 25

    fun enqueueEvent(context: Context, event: CallSyncEvent) {
        val current = loadPendingEvents(context).toMutableList()
        current.removeAll { it.queueKey == event.queueKey }
        current.add(event)
        savePendingEvents(context, current.takeLast(MAX_PENDING_EVENTS))
    }

    fun getPendingEventCount(context: Context): Int = loadPendingEvents(context).size

    fun getLastSuccessAt(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_SUCCESS_AT, 0L)

    fun flushPendingEvents(context: Context, config: CallSyncConfig): PushAttemptResult {
        val pending = loadPendingEvents(context)
        if (pending.isEmpty()) {
            return PushAttemptResult(success = true, message = "No pending sync events")
        }

        val remaining = mutableListOf<CallSyncEvent>()
        var lastAttempt = PushAttemptResult(success = true, message = "No pending sync events")

        for (event in pending) {
            val result = pushSingleEvent(config, event)
            if (!result.success) {
                remaining.add(event)
                lastAttempt = result
            } else {
                lastAttempt = result
            }
        }

        savePendingEvents(context, remaining)
        if (remaining.size < pending.size) {
            markLastSuccess(context)
        }

        return if (remaining.isEmpty()) {
            PushAttemptResult(success = true, message = "Synced ${pending.size} pending event(s)")
        } else {
            lastAttempt.copy(message = "${lastAttempt.message} | ${remaining.size} pending")
        }
    }

    fun testConnection(context: Context, config: CallSyncConfig): PushAttemptResult {
        val event = CallSyncEvent(
            phone = "",
            state = "ended",
            timestampMs = System.currentTimeMillis(),
            deviceId = config.deviceId
        )
        val result = pushSingleEvent(config, event)
        if (result.success) {
            markLastSuccess(context)
        }
        return result
    }

    fun pushEvent(context: Context, config: CallSyncConfig, event: CallSyncEvent): PushAttemptResult {
        val pending = loadPendingEvents(context).toMutableList()
        pending.removeAll { it.queueKey == event.queueKey }
        pending.add(event)
        savePendingEvents(context, pending.takeLast(MAX_PENDING_EVENTS))

        val flushResult = flushPendingEvents(context, config)
        return if (flushResult.success) {
            flushResult
        } else {
            flushResult
        }
    }

    private fun loadPendingEvents(context: Context): List<CallSyncEvent> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_PENDING_EVENTS, "[]")
            ?: "[]"
        return try {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    val event = CallSyncEvent.fromJson(item) ?: continue
                    add(event)
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun savePendingEvents(context: Context, events: List<CallSyncEvent>) {
        val array = JSONArray()
        events.takeLast(MAX_PENDING_EVENTS).forEach { array.put(it.toJson()) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PENDING_EVENTS, array.toString())
            .apply()
    }

    private fun markLastSuccess(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_LAST_SUCCESS_AT, System.currentTimeMillis())
            .apply()
    }

    private fun pushSingleEvent(config: CallSyncConfig, event: CallSyncEvent): PushAttemptResult {
        var lastResult = PushAttemptResult(
            success = false,
            message = "No server base URL configured"
        )

        val payload = JSONObject()
            .put("token", config.token)
            .put("phone", event.phone)
            .put("state", event.state)
            .put("deviceId", event.deviceId)
            .toString()

        for (baseUrl in CallSyncStore.buildCandidateBaseUrls(config)) {
            val endpoint = "${baseUrl.trimEnd('/')}/api/call-sync/push"
            val result = executePost(endpoint, payload, 0)
            if (result.success) {
                return result.copy(message = "${result.message} via $baseUrl", attemptedBaseUrl = baseUrl)
            }
            lastResult = result.copy(message = "${result.message} via $baseUrl", attemptedBaseUrl = baseUrl)
        }

        return lastResult
    }

    private fun executePost(endpoint: String, payload: String, redirectDepth: Int): PushAttemptResult {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10000
            readTimeout = 10000
            doOutput = true
            instanceFollowRedirects = false
            setRequestProperty("Content-Type", "application/json")
        }

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

            return PushAttemptResult(
                success = responseCode in 200..299,
                message = buildString {
                    append("HTTP ")
                    append(responseCode)
                    if (responseText.isNotBlank()) {
                        append(": ")
                        append(responseText.take(180))
                    }
                }
            )
        } catch (error: Exception) {
            return PushAttemptResult(
                success = false,
                message = "Error: ${error.message ?: "unknown"}"
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
