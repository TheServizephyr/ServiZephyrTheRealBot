package com.servizephyr.callsync

import android.util.Log
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.dnsoverhttps.DnsOverHttps
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

data class CompanionVoiceDraftItem(
    val id: String,
    val name: String,
    val quantity: Int,
    val totalPrice: Double,
    val portionLabel: String
)

data class CompanionVoicePendingItem(
    val spokenText: String,
    val quantity: Int,
    val reason: String
)

data class CompanionVoiceDraft(
    val restaurantName: String,
    val businessType: String,
    val orderType: String,
    val activeTableName: String,
    val lastTranscript: String,
    val lastAction: String,
    val note: String,
    val updatedAt: Long,
    val items: List<CompanionVoiceDraftItem>,
    val pendingItems: List<CompanionVoicePendingItem>
)

data class VoiceDraftResult(
    val success: Boolean,
    val message: String,
    val draft: CompanionVoiceDraft? = null,
    val transcript: String = "",
    val sttKeyterms: List<String> = emptyList(),
    val attemptedBaseUrl: String? = null
)

object CallSyncVoiceService {
    private const val TAG = "CallSyncVoice"
    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

    private fun buildBaseClient(
        connectTimeoutMs: Long = 15_000L,
        readTimeoutMs: Long = 20_000L,
        dns: Dns = Dns.SYSTEM
    ): OkHttpClient = OkHttpClient.Builder()
        .dns(dns)
        .connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
        .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
        .callTimeout(readTimeoutMs + 3_000L, TimeUnit.MILLISECONDS)
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

    fun fetchDraft(config: CallSyncConfig): VoiceDraftResult {
        Log.d(TAG, "fetchDraft start candidates=${CallSyncStore.buildCandidateBaseUrls(config).size}")
        val payload = JSONObject()
            .put("token", config.token)
            .toString()

        return executeAcrossCandidateBaseUrls(config) { baseUrl ->
            val endpoint = "${baseUrl.trimEnd('/')}/api/call-sync/voice/bootstrap"
            Request.Builder()
                .url(endpoint)
                .post(payload.toRequestBody(JSON_MEDIA_TYPE))
                .build()
        }
    }

    fun pushVoiceTranscript(
        config: CallSyncConfig,
        transcript: String,
        commandId: String,
        sttKeyterms: List<String> = emptyList()
    ): VoiceDraftResult {
        val normalizedTranscript = transcript.trim()
        if (normalizedTranscript.isBlank()) {
            Log.w(TAG, "pushVoiceTranscript skipped: transcript empty commandId=$commandId")
            return VoiceDraftResult(success = false, message = "Transcript is empty")
        }

        Log.d(
            TAG,
            "pushVoiceTranscript start chars=${normalizedTranscript.length} commandId=$commandId keyterms=${sttKeyterms.size}"
        )
        val payload = JSONObject()
            .put("token", config.token)
            .put("commandId", commandId)
            .put("transcript", normalizedTranscript)
        if (sttKeyterms.isNotEmpty()) {
            payload.put("keyterms", JSONArray(sttKeyterms))
        }

        return executeAcrossCandidateBaseUrls(config) { baseUrl ->
            val endpoint = "${baseUrl.trimEnd('/')}/api/call-sync/voice/command"
            Request.Builder()
                .url(endpoint)
                .post(payload.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
        }
    }

    fun pushVoiceCommand(
        config: CallSyncConfig,
        audioFile: File,
        mimeType: String,
        commandId: String,
        sttKeyterms: List<String> = emptyList()
    ): VoiceDraftResult {
        Log.d(
            TAG,
            "pushVoiceCommand start file=${audioFile.name} bytes=${audioFile.length()} mime=${mimeType.ifBlank { "audio/mp4" }} commandId=$commandId keyterms=${sttKeyterms.size}"
        )
        val mediaType = (mimeType.ifBlank { "audio/mp4" }).toMediaTypeOrNull()
        val multipartBuilder = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("token", config.token)
            .addFormDataPart("commandId", commandId)
            .addFormDataPart(
                "audio",
                audioFile.name,
                audioFile.asRequestBody(mediaType)
            )
            .addFormDataPart("mimeType", mimeType.ifBlank { "audio/mp4" })
        if (sttKeyterms.isNotEmpty()) {
            multipartBuilder.addFormDataPart("keyterms", JSONArray(sttKeyterms).toString())
        }
        val multipartBody = multipartBuilder.build()

        return executeAcrossCandidateBaseUrls(config) { baseUrl ->
            val endpoint = "${baseUrl.trimEnd('/')}/api/call-sync/voice/command"
            Request.Builder()
                .url(endpoint)
                .post(multipartBody)
                .build()
        }
    }

    private fun executeAcrossCandidateBaseUrls(
        config: CallSyncConfig,
        requestFactory: (String) -> Request
    ): VoiceDraftResult {
        val candidateBaseUrls = CallSyncStore.buildCandidateBaseUrls(config)
        if (candidateBaseUrls.isEmpty()) {
            Log.w(TAG, "executeAcrossCandidateBaseUrls aborted: no base URL configured")
            return VoiceDraftResult(success = false, message = "No server base URL configured")
        }

        val attempts = mutableListOf<String>()
        for (baseUrl in candidateBaseUrls) {
            Log.d(TAG, "executeAcrossCandidateBaseUrls trying $baseUrl")
            val request = requestFactory(baseUrl)
            val directResult = executeRequest(standardClient, request)
            if (directResult.success) {
                Log.d(TAG, "request success via direct baseUrl=$baseUrl message=${directResult.message}")
                return directResult.copy(attemptedBaseUrl = baseUrl)
            }

            val shouldRetryWithDoh = directResult.message.lowercase().contains("dns failed") ||
                directResult.message.lowercase().contains("timeout")
            if (!shouldRetryWithDoh) {
                Log.w(TAG, "request failed without DoH retry baseUrl=$baseUrl message=${directResult.message}")
                attempts += "$baseUrl -> ${directResult.message}"
                continue
            }

            Log.w(TAG, "request direct failed, retrying with DoH baseUrl=$baseUrl message=${directResult.message}")
            val dohResult = executeRequest(dohClient, request)
            if (dohResult.success) {
                Log.d(TAG, "request success via DoH baseUrl=$baseUrl message=${dohResult.message}")
                return dohResult.copy(
                    attemptedBaseUrl = baseUrl,
                    message = "${dohResult.message} (DoH)"
                )
            }
            Log.e(TAG, "request failed via DoH baseUrl=$baseUrl message=${dohResult.message}")
            attempts += "$baseUrl -> ${directResult.message} | DoH ${dohResult.message}"
        }

        Log.e(TAG, "all candidate base URLs failed attempts=${attempts.joinToString(" || ")}")
        return VoiceDraftResult(
            success = false,
            message = attempts.joinToString(" | ").ifBlank { "Voice draft request failed" }
        )
    }

    private fun executeRequest(client: OkHttpClient, request: Request): VoiceDraftResult {
        return try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val payload = runCatching { JSONObject(body) }.getOrNull()
                    val message = payload?.optString("message")?.takeIf { it.isNotBlank() }
                        ?: "HTTP ${response.code}"
                    Log.e(
                        TAG,
                        "HTTP failure url=${request.url} code=${response.code} message=$message body=${body.take(220)}"
                    )
                    return VoiceDraftResult(success = false, message = message)
                }

                Log.d(
                    TAG,
                    "HTTP success url=${request.url} code=${response.code} body=${body.take(220)}"
                )
                parseVoiceDraftResponse(body)
            }
        } catch (error: UnknownHostException) {
            Log.e(TAG, "DNS failure url=${request.url}", error)
            VoiceDraftResult(success = false, message = "DNS failed for ${request.url.host}")
        } catch (error: SocketTimeoutException) {
            Log.e(TAG, "Timeout url=${request.url}", error)
            VoiceDraftResult(success = false, message = "Timeout for ${request.url.host}")
        } catch (error: Exception) {
            Log.e(TAG, "Unexpected request failure url=${request.url}", error)
            VoiceDraftResult(success = false, message = "Error: ${error.message ?: "unknown"}")
        }
    }

    private fun parseVoiceDraftResponse(body: String): VoiceDraftResult {
        val payload = runCatching { JSONObject(body) }.getOrNull()
            ?: run {
                Log.e(TAG, "Invalid JSON response body=${body.take(220)}")
                return VoiceDraftResult(success = false, message = "Invalid voice draft response")
            }

        val message = payload.optString("message").ifBlank { "Voice draft synced" }
        val transcript = payload.optString("transcript")
        val sttKeyterms = buildList {
            val array = payload.optJSONArray("sttKeyterms")
            if (array != null) {
                for (index in 0 until array.length()) {
                    val term = array.optString(index).trim()
                    if (term.isNotBlank()) add(term)
                }
            }
        }
        val draft = payload.optJSONObject("draft")?.let { draftJson ->
            CompanionVoiceDraft(
                restaurantName = draftJson.optString("restaurantName", payload.optString("restaurantName", "")),
                businessType = draftJson.optString("businessType", payload.optString("businessType", "restaurant")),
                orderType = draftJson.optString("orderType", "delivery"),
                activeTableName = draftJson.optJSONObject("activeTable")?.optString("name").orEmpty(),
                lastTranscript = draftJson.optString("lastTranscript"),
                lastAction = draftJson.optString("lastAction"),
                note = draftJson.optString("note"),
                updatedAt = draftJson.optLong("updatedAt", 0L),
                items = buildList {
                    val array = draftJson.optJSONArray("items")
                    if (array != null) {
                        for (index in 0 until array.length()) {
                            val item = array.optJSONObject(index) ?: continue
                            add(
                                CompanionVoiceDraftItem(
                                    id = item.optString("id"),
                                    name = item.optString("name", "Item"),
                                    quantity = item.optInt("quantity", 1).coerceAtLeast(1),
                                    totalPrice = item.optDouble("totalPrice", 0.0),
                                    portionLabel = item.optJSONObject("portion")?.optString("label").orEmpty()
                                )
                            )
                        }
                    }
                },
                pendingItems = buildList {
                    val array = draftJson.optJSONArray("pendingItems")
                    if (array != null) {
                        for (index in 0 until array.length()) {
                            val item = array.optJSONObject(index) ?: continue
                            add(
                                CompanionVoicePendingItem(
                                    spokenText = item.optString("spokenText"),
                                    quantity = item.optInt("quantity", 1).coerceAtLeast(1),
                                    reason = item.optString("reason", "ambiguous-match")
                                )
                            )
                        }
                    }
                }
            )
        }

        val result = VoiceDraftResult(
            success = payload.optBoolean("ok", true),
            message = message,
            draft = draft,
            transcript = transcript,
            sttKeyterms = sttKeyterms
        )
        Log.d(
            TAG,
            "Parsed response ok=${result.success} message=${result.message} transcriptLen=${result.transcript.length} items=${result.draft?.items?.size ?: 0} pending=${result.draft?.pendingItems?.size ?: 0} keyterms=${result.sttKeyterms.size}"
        )
        return result
    }
}
