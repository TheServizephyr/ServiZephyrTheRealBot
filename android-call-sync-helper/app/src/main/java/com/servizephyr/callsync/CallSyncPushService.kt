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
import java.net.UnknownHostException

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

private data class QueueSanitizationResult(
    val validEvents: List<CallSyncEvent>,
    val droppedCount: Int
)

private data class CandidateAttempt(
    val baseUrl: String,
    val result: PushAttemptResult
)

object CallSyncPushService {
    private const val PREFS = "call_sync_helper"
    private const val KEY_PENDING_EVENTS = "pending_events"
    private const val KEY_LAST_SUCCESS_AT = "last_success_at"
    private const val MAX_PENDING_EVENTS = 25
    private const val LIVE_RINGING_MAX_AGE_MS = 8_000L

    fun enqueueEvent(context: Context, event: CallSyncEvent) {
        if (!isQueueable(event)) {
            return
        }
        val current = loadPendingEvents(context).toMutableList()
        current.removeAll { it.queueKey == event.queueKey }
        current.add(event)
        savePendingEvents(context, current.takeLast(MAX_PENDING_EVENTS))
    }

    fun getPendingEventCount(context: Context): Int = loadPendingEvents(context).size

    fun getLastSuccessAt(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_SUCCESS_AT, 0L)

    fun flushPendingEvents(context: Context, config: CallSyncConfig): PushAttemptResult {
        val sanitization = sanitizePendingEvents(loadPendingEvents(context))
        val pending = sanitization.validEvents
        if (sanitization.droppedCount > 0) {
            savePendingEvents(context, pending)
        }
        if (pending.isEmpty()) {
            return PushAttemptResult(
                success = true,
                message = if (sanitization.droppedCount > 0) {
                    "Dropped ${sanitization.droppedCount} invalid pending event(s)"
                } else {
                    "No pending sync events"
                }
            )
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
            PushAttemptResult(
                success = true,
                message = buildString {
                    append("Synced ")
                    append(pending.size)
                    append(" pending event(s)")
                    if (sanitization.droppedCount > 0) {
                        append(" | Dropped ")
                        append(sanitization.droppedCount)
                        append(" invalid")
                    }
                }
            )
        } else {
            lastAttempt.copy(
                message = buildString {
                    append(lastAttempt.message)
                    append(" | ")
                    append(remaining.size)
                    append(" pending")
                    if (sanitization.droppedCount > 0) {
                        append(" | Dropped ")
                        append(sanitization.droppedCount)
                        append(" invalid")
                    }
                }
            )
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
        if (!isQueueable(event)) {
            return PushAttemptResult(
                success = false,
                message = "Skipped invalid ${event.state} event without a caller number"
            )
        }

        // Live incoming calls must either land now or be dropped.
        // Replaying an old ringing event later can attach the wrong customer to a fresh bill.
        if (event.state.equals("ringing", ignoreCase = true)) {
            val result = pushSingleEvent(config, event)
            if (result.success) {
                markLastSuccess(context)
            }
            return result
        }

        val pending = loadPendingEvents(context).toMutableList()
        pending.removeAll { it.queueKey == event.queueKey }
        pending.add(event)
        savePendingEvents(context, pending.takeLast(MAX_PENDING_EVENTS))

        return flushPendingEvents(context, config)
    }

    fun checkNetworkDns(config: CallSyncConfig): PushAttemptResult {
        val candidateBaseUrls = CallSyncStore.buildCandidateBaseUrls(config)
        if (candidateBaseUrls.isEmpty()) {
            return PushAttemptResult(success = false, message = "No server base URL configured")
        }

        var reachableCount = 0
        val parts = candidateBaseUrls.map { baseUrl ->
            val result = executeReachabilityCheck(baseUrl)
            if (result.first) {
                reachableCount += 1
            }
            result.second
        }

        return PushAttemptResult(
            success = reachableCount > 0,
            message = parts.joinToString(" | ")
        )
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

    private fun sanitizePendingEvents(events: List<CallSyncEvent>): QueueSanitizationResult {
        val validEvents = mutableListOf<CallSyncEvent>()
        var droppedCount = 0
        val now = System.currentTimeMillis()
        events.forEach { event ->
            val isStaleRinging = event.state.equals("ringing", ignoreCase = true) &&
                (now - event.timestampMs) > LIVE_RINGING_MAX_AGE_MS

            if (!isStaleRinging && isQueueable(event)) {
                validEvents += event
            } else {
                droppedCount += 1
            }
        }
        return QueueSanitizationResult(validEvents = validEvents, droppedCount = droppedCount)
    }

    private fun isQueueable(event: CallSyncEvent): Boolean {
        return !(event.state.equals("ringing", ignoreCase = true) && event.phone.isBlank())
    }

    private fun markLastSuccess(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_LAST_SUCCESS_AT, System.currentTimeMillis())
            .apply()
    }

    private fun pushSingleEvent(config: CallSyncConfig, event: CallSyncEvent): PushAttemptResult {
        val defaultResult = PushAttemptResult(
            success = false,
            message = "No server base URL configured"
        )
        val attempts = mutableListOf<CandidateAttempt>()

        val payload = JSONObject()
            .put("token", config.token)
            .put("phone", event.phone)
            .put("state", event.state)
            .put("deviceId", event.deviceId)
            .toString()

        val candidateBaseUrls = CallSyncStore.buildCandidateBaseUrls(config)
        if (candidateBaseUrls.isEmpty()) {
            return defaultResult
        }

        for (baseUrl in candidateBaseUrls) {
            val endpoint = "${baseUrl.trimEnd('/')}/api/call-sync/push"
            val result = executePost(endpoint, payload, 0)
            if (result.success) {
                return result.copy(message = "${result.message} via $baseUrl", attemptedBaseUrl = baseUrl)
            }
            attempts += CandidateAttempt(
                baseUrl = baseUrl,
                result = result.copy(attemptedBaseUrl = baseUrl)
            )
        }

        val primaryAttempt = attempts.firstOrNull()
        val backupAttempts = attempts.drop(1)
        val summary = buildString {
            if (primaryAttempt != null) {
                append("Primary failed (")
                append(primaryAttempt.baseUrl)
                append("): ")
                append(primaryAttempt.result.message)
            } else {
                append(defaultResult.message)
            }

            if (backupAttempts.isNotEmpty()) {
                append(" | Backup failed")
                if (backupAttempts.size > 1) append("s")
                append(": ")
                append(
                    backupAttempts.joinToString(" ; ") { attempt ->
                        "${attempt.baseUrl} -> ${attempt.result.message}"
                    }
                )
            }
        }

        return PushAttemptResult(
            success = false,
            message = summary,
            attemptedBaseUrl = primaryAttempt?.baseUrl
        )
    }

    private fun executePost(endpoint: String, payload: String, redirectDepth: Int): PushAttemptResult {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 15000
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
                val redirectedResult = executePost(redirectLocation, payload, redirectDepth + 1)
                return if (redirectedResult.success) {
                    redirectedResult
                } else {
                    redirectedResult.copy(
                        message = "Redirected to $redirectLocation -> ${redirectedResult.message}"
                    )
                }
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
        } catch (error: UnknownHostException) {
            return PushAttemptResult(
                success = false,
                message = "DNS failed for ${URL(endpoint).host}"
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

    private fun executeReachabilityCheck(baseUrl: String): Pair<Boolean, String> {
        val endpoint = baseUrl.trimEnd('/')
        return try {
            val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 6000
                readTimeout = 6000
                instanceFollowRedirects = true
            }
            try {
                val responseCode = connection.responseCode
                val ok = responseCode in 200..399
                ok to if (ok) {
                    "$baseUrl OK (HTTP $responseCode)"
                } else {
                    "$baseUrl HTTP $responseCode"
                }
            } finally {
                connection.disconnect()
            }
        } catch (_: UnknownHostException) {
            false to "$baseUrl DNS failed"
        } catch (error: Exception) {
            false to "$baseUrl ${error.message ?: "check failed"}"
        }
    }

    private fun readStream(stream: InputStream?): String {
        if (stream == null) return ""
        return BufferedReader(InputStreamReader(stream)).use { reader ->
            reader.readText()
        }
    }
}
