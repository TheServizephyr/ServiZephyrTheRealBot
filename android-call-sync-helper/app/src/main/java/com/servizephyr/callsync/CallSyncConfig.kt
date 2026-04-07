package com.servizephyr.callsync

import android.content.Context

data class CallSyncConfig(
    val serverBaseUrl: String,
    val backupServerBaseUrl: String,
    val token: String,
    val deviceId: String,
    val isSyncEnabled: Boolean,
    val isScheduleEnabled: Boolean,
    val openMinutes: Int,
    val closeMinutes: Int
)

object CallSyncStore {
    const val DEFAULT_SERVER_BASE_URL = "https://sync.servizephyr.com"
    const val DEFAULT_BACKUP_SERVER_BASE_URL = "https://servi-zephyr-the-real-bot.vercel.app"

    private const val PREFS = "call_sync_helper"
    private const val KEY_SERVER_BASE_URL = "server_base_url"
    private const val KEY_BACKUP_SERVER_BASE_URL = "backup_server_base_url"
    private const val KEY_TOKEN = "token"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_SYNC_ENABLED = "sync_enabled"
    private const val KEY_SCHEDULE_ENABLED = "schedule_enabled"
    private const val KEY_OPEN_MINUTES = "open_minutes"
    private const val KEY_CLOSE_MINUTES = "close_minutes"
    private const val KEY_LAST_EVENT = "last_event"
    private const val KEY_LAST_NUMBER = "last_number"
    private const val KEY_LAST_RESULT = "last_result"
    private const val KEY_LAST_UPDATED_AT = "last_updated_at"
    private const val KEY_TRACKED_INCOMING_PHONE = "tracked_incoming_phone"
    private const val KEY_TRACKED_INCOMING_AT = "tracked_incoming_at"

    data class DebugSnapshot(
        val lastEvent: String,
        val lastNumber: String,
        val lastResult: String,
        val lastUpdatedAt: Long
    )

    data class TrackedIncomingCall(
        val phone: String,
        val trackedAt: Long
    )

    fun load(context: Context): CallSyncConfig {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val deviceId = prefs.getString(KEY_DEVICE_ID, null)
            ?: "android-${System.currentTimeMillis()}"
        if (!prefs.contains(KEY_DEVICE_ID)) {
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
        }

        return CallSyncConfig(
            serverBaseUrl = prefs.getString(KEY_SERVER_BASE_URL, DEFAULT_SERVER_BASE_URL) ?: DEFAULT_SERVER_BASE_URL,
            backupServerBaseUrl = prefs.getString(KEY_BACKUP_SERVER_BASE_URL, DEFAULT_BACKUP_SERVER_BASE_URL) ?: DEFAULT_BACKUP_SERVER_BASE_URL,
            token = prefs.getString(KEY_TOKEN, "") ?: "",
            deviceId = deviceId,
            isSyncEnabled = prefs.getBoolean(KEY_SYNC_ENABLED, true),
            isScheduleEnabled = prefs.getBoolean(KEY_SCHEDULE_ENABLED, false),
            openMinutes = prefs.getInt(KEY_OPEN_MINUTES, 10 * 60),
            closeMinutes = prefs.getInt(KEY_CLOSE_MINUTES, 23 * 60)
        )
    }

    fun save(
        context: Context,
        serverBaseUrl: String,
        backupServerBaseUrl: String,
        token: String,
        isScheduleEnabled: Boolean,
        openMinutes: Int,
        closeMinutes: Int
    ) {
        val normalizedBaseUrl = normalizeServerBaseUrl(serverBaseUrl)
        val normalizedBackupUrl = normalizeServerBaseUrl(backupServerBaseUrl)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_BASE_URL, normalizedBaseUrl)
            .putString(KEY_BACKUP_SERVER_BASE_URL, normalizedBackupUrl)
            .putString(KEY_TOKEN, token.trim())
            .putBoolean(KEY_SCHEDULE_ENABLED, isScheduleEnabled)
            .putInt(KEY_OPEN_MINUTES, openMinutes)
            .putInt(KEY_CLOSE_MINUTES, closeMinutes)
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

        val derivedVariants = candidates.toList().flatMap { baseUrl ->
            val trimmed = normalizeServerBaseUrl(baseUrl)
            when {
                trimmed.contains("://sync.servizephyr.com") -> emptyList()
                trimmed.contains("://www.servizephyr.com") -> listOf(trimmed.replace("://www.servizephyr.com", "://servizephyr.com"))
                trimmed.contains("://servizephyr.com") -> listOf(trimmed.replace("://servizephyr.com", "://www.servizephyr.com"))
                else -> emptyList()
            }
        }
        derivedVariants.forEach(add)

        return candidates.toList()
    }

    fun setSyncEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_SYNC_ENABLED, enabled)
            .apply()
    }

    fun isWithinOperatingHours(config: CallSyncConfig, currentMinutes: Int): Boolean {
        if (!config.isScheduleEnabled) return true
        val open = config.openMinutes.coerceIn(0, 1439)
        val close = config.closeMinutes.coerceIn(0, 1439)
        if (open == close) return true
        return if (open < close) {
            currentMinutes in open until close
        } else {
            currentMinutes >= open || currentMinutes < close
        }
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

    fun saveTrackedIncomingCall(context: Context, phone: String) {
        val normalizedPhone = phone.trim()
        if (normalizedPhone.isBlank()) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_TRACKED_INCOMING_PHONE, normalizedPhone)
            .putLong(KEY_TRACKED_INCOMING_AT, System.currentTimeMillis())
            .apply()
    }

    fun loadTrackedIncomingCall(context: Context): TrackedIncomingCall? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val phone = prefs.getString(KEY_TRACKED_INCOMING_PHONE, "")?.trim().orEmpty()
        val trackedAt = prefs.getLong(KEY_TRACKED_INCOMING_AT, 0L)
        if (phone.isBlank() || trackedAt <= 0L) return null
        return TrackedIncomingCall(phone = phone, trackedAt = trackedAt)
    }

    fun clearTrackedIncomingCall(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_TRACKED_INCOMING_PHONE)
            .remove(KEY_TRACKED_INCOMING_AT)
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
