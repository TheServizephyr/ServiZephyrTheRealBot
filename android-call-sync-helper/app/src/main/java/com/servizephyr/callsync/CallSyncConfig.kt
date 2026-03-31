package com.servizephyr.callsync

import android.content.Context

data class CallSyncConfig(
    val serverBaseUrl: String,
    val token: String,
    val deviceId: String
)

object CallSyncStore {
    private const val PREFS = "call_sync_helper"
    private const val KEY_SERVER_BASE_URL = "server_base_url"
    private const val KEY_TOKEN = "token"
    private const val KEY_DEVICE_ID = "device_id"

    fun load(context: Context): CallSyncConfig {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val deviceId = prefs.getString(KEY_DEVICE_ID, null)
            ?: "android-${System.currentTimeMillis()}"
        if (!prefs.contains(KEY_DEVICE_ID)) {
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
        }

        return CallSyncConfig(
            serverBaseUrl = prefs.getString(KEY_SERVER_BASE_URL, "https://servizephyr.com") ?: "https://servizephyr.com",
            token = prefs.getString(KEY_TOKEN, "") ?: "",
            deviceId = deviceId
        )
    }

    fun save(context: Context, serverBaseUrl: String, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_BASE_URL, serverBaseUrl.trim().trimEnd('/'))
            .putString(KEY_TOKEN, token.trim())
            .apply()
    }
}
