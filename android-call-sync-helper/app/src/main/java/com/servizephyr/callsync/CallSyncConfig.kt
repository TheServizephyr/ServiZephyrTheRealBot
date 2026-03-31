package com.servizephyr.callsync

import android.content.Context

data class CallSyncConfig(
    val serverBaseUrl: String,
    val backupServerBaseUrl: String,
    val token: String,
    val deviceId: String,
    val isSyncEnabled: Boolean
)

object CallSyncStore {
    private const val PREFS = "call_sync_helper"
    private const val KEY_SERVER_BASE_URL = "server_base_url"
    private const val KEY_BACKUP_SERVER_BASE_URL = "backup_server_base_url"
    private const val KEY_TOKEN = "token"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_SYNC_ENABLED = "sync_enabled"
    private const val KEY_LAST_EVENT = "last_event"
    private const val KEY_LAST_NUMBER = "last_number"
    private const val KEY_LAST_RESULT = "last_result"
    private const val KEY_LAST_UPDATED_AT = "last_updated_at"

    data class DebugSnapshot(
        val lastEvent: String,
        val lastNumber: String,
        val lastResult: String,
        val lastUpdatedAt: Long
    )

    fun load(context: Context): CallSyncConfig {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val deviceId = prefs.getString(KEY_DEVICE_ID, null)
            ?: "android-${System.currentTimeMillis()}"
        if (!prefs.contains(KEY_DEVICE_ID)) {
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
        }

        return CallSyncConfig(
            serverBaseUrl = prefs.getString(KEY_SERVER_BASE_URL, "https://servizephyr.com") ?: "https://servizephyr.com",
            backupServerBaseUrl = prefs.getString(KEY_BACKUP_SERVER_BASE_URL, "") ?: "",
            token = prefs.getString(KEY_TOKEN, "") ?: "",
            deviceId = deviceId,
            isSyncEnabled = prefs.getBoolean(KEY_SYNC_ENABLED, true)
        )
    }

    fun save(context: Context, serverBaseUrl: String, backupServerBaseUrl: String, token: String) {
        val normalizedBaseUrl = normalizeServerBaseUrl(serverBaseUrl)
        val normalizedBackupUrl = normalizeServerBaseUrl(backupServerBaseUrl)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_BASE_URL, normalizedBaseUrl)
            .putString(KEY_BACKUP_SERVER_BASE_URL, normalizedBackupUrl)
            .putString(KEY_TOKEN, token.trim())
            .apply()
    }

    fun normalizeServerBaseUrl(serverBaseUrl: String): String {
        return serverBaseUrl.trim().trimEnd('/')
    }

    fun buildCandidateBaseUrls(config: CallSyncConfig): List<String> {
        val candidates = linkedSetOf<String>()
        val add = { raw: String ->
            val normalized = normalizeServerBaseUrl(raw)
            if (normalized.isNotBlank()) {
                candidates.add(normalized)
            }
        }

        add(config.serverBaseUrl)
        add(config.backupServerBaseUrl)

        if (config.serverBaseUrl.contains("servizephyr.com", ignoreCase = true)) {
            candidates.add("https://servizephyr.com")
            candidates.add("https://www.servizephyr.com")
        }

        return candidates.toList()
    }

    fun setSyncEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SYNC_ENABLED, enabled)
            .apply()
    }

    fun saveDebugSnapshot(
        context: Context,
        lastEvent: String,
        lastNumber: String,
        lastResult: String
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_EVENT, lastEvent)
            .putString(KEY_LAST_NUMBER, lastNumber)
            .putString(KEY_LAST_RESULT, lastResult)
            .putLong(KEY_LAST_UPDATED_AT, System.currentTimeMillis())
            .apply()
    }

    fun loadDebugSnapshot(context: Context): DebugSnapshot {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return DebugSnapshot(
            lastEvent = prefs.getString(KEY_LAST_EVENT, "") ?: "",
            lastNumber = prefs.getString(KEY_LAST_NUMBER, "") ?: "",
            lastResult = prefs.getString(KEY_LAST_RESULT, "") ?: "",
            lastUpdatedAt = prefs.getLong(KEY_LAST_UPDATED_AT, 0L)
        )
    }
}
