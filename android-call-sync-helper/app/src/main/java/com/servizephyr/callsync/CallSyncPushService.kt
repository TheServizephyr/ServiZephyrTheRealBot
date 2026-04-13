package com.servizephyr.callsync

import android.content.Context
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.dnsoverhttps.DnsOverHttps
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

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
    private const val KEY_LAST_WARM_AT = "last_warm_at"
    private const val MAX_PENDING_EVENTS = 25
    private const val LIVE_RINGING_MAX_AGE_MS = 8_000L
    private const val WARM_COOLDOWN_MS = 2 * 60 * 1000L
    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    private fun buildBaseClient(
        connectTimeoutMs: Long = 15_000L,
        readTimeoutMs: Long = 15_000L,
        dns: Dns = Dns.SYSTEM
    ): OkHttpClient = OkHttpClient.Builder()
        .dns(dns)
        .connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
        .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
        .callTimeout(readTimeoutMs + 2_000L, TimeUnit.MILLISECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private fun buildDohDns(): Dns {
        val bootstrapClient = buildBaseClient(connectTimeoutMs = 8_000L, readTimeoutMs = 8_000L)
        return DnsOverHttps.Builder()
            .client(bootstrapClient)
            .url("https://dns.google/dns-query".toHttpUrl())
            .bootstrapDnsHosts(
                InetAddress.getByName("8.8.8.8"),
                InetAddress.getByName("8.8.4.4")
            )
            .includeIPv6(false)
            .resolvePrivateAddresses(false)
            .build()
    }

    private val dohDns: Dns by lazy { buildDohDns() }
    private val standardClient: OkHttpClient by lazy { buildBaseClient() }
    private val dohClient: OkHttpClient by lazy { buildBaseClient(dns = dohDns) }

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

    fun getLastWarmAt(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_LAST_WARM_AT, 0L)

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

    fun warmHosts(context: Context, config: CallSyncConfig, force: Boolean = false): PushAttemptResult {
        val now = System.currentTimeMillis()
        if (!force && (now - getLastWarmAt(context)) < WARM_COOLDOWN_MS) {
            return PushAttemptResult(success = true, message = "Host warm skipped (cooldown)")
        }

        val candidateBaseUrls = CallSyncStore.buildCandidateBaseUrls(config)
        if (candidateBaseUrls.isEmpty()) {
            return PushAttemptResult(success = false, message = "No server base URL configured")
        }

        val results = candidateBaseUrls.map { baseUrl ->
            val outcome = executeRequest(
                client = standardClient,
                request = Request.Builder().url(baseUrl).get().build()
            )
            if (outcome.success) {
                baseUrl to outcome
            } else {
                baseUrl to executeRequest(
                    client = dohClient,
                    request = Request.Builder().url(baseUrl).get().build()
                )
            }
        }

        val success = results.any { it.second.success }
        if (success) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(KEY_LAST_WARM_AT, now)
                .apply()
        }

        return PushAttemptResult(
            success = success,
            message = results.joinToString(" | ") { (baseUrl, result) ->
                "$baseUrl -> ${result.message}"
            }
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
            val request = Request.Builder()
                .url(endpoint)
                .post(payload.toRequestBody(JSON_MEDIA_TYPE))
                .build()

            val result = executeRequest(standardClient, request).let { standard ->
                if (standard.success || !shouldRetryWithDoh(standard.message)) {
                    standard
                } else {
                    val dohResult = executeRequest(dohClient, request)
                    if (dohResult.success) {
                        dohResult.copy(message = "${dohResult.message} (DoH)")
                    } else {
                        dohResult.copy(message = "${standard.message} | DoH: ${dohResult.message}")
                    }
                }
            }
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

    private fun executeRequest(client: OkHttpClient, request: Request): PushAttemptResult {
        return try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                PushAttemptResult(
                    success = response.isSuccessful,
                    message = buildString {
                        append("HTTP ")
                        append(response.code)
                        if (body.isNotBlank()) {
                            append(": ")
                            append(body.take(180))
                        }
                    }
                )
            }
        } catch (error: UnknownHostException) {
            PushAttemptResult(
                success = false,
                message = "DNS failed for ${request.url.host}"
            )
        } catch (error: SocketTimeoutException) {
            PushAttemptResult(
                success = false,
                message = "Timeout for ${request.url.host}"
            )
        } catch (error: Exception) {
            PushAttemptResult(
                success = false,
                message = "Error: ${error.message ?: "unknown"}"
            )
        }
    }

    private fun executeReachabilityCheck(baseUrl: String): Pair<Boolean, String> {
        val request = Request.Builder().url(baseUrl.trimEnd('/')).get().build()
        val direct = executeRequest(standardClient.newBuilder()
            .connectTimeout(6_000L, TimeUnit.MILLISECONDS)
            .readTimeout(6_000L, TimeUnit.MILLISECONDS)
            .callTimeout(8_000L, TimeUnit.MILLISECONDS)
            .build(), request)
        if (direct.success) {
            return true to "$baseUrl OK (${direct.message})"
        }

        val doh = executeRequest(dohClient.newBuilder()
            .connectTimeout(6_000L, TimeUnit.MILLISECONDS)
            .readTimeout(6_000L, TimeUnit.MILLISECONDS)
            .callTimeout(8_000L, TimeUnit.MILLISECONDS)
            .build(), request)

        return if (doh.success) {
            true to "$baseUrl OK (${doh.message}, DoH)"
        } else {
            false to "$baseUrl ${direct.message} | DoH ${doh.message}"
        }
    }

    private fun shouldRetryWithDoh(message: String): Boolean {
        val normalized = message.lowercase()
        return normalized.contains("dns failed") || normalized.contains("timeout")
    }
}
