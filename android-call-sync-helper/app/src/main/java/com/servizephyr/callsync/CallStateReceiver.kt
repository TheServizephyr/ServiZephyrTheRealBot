package com.servizephyr.callsync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.Calendar

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

        val currentMinutes = Calendar.getInstance().let {
            (it.get(Calendar.HOUR_OF_DAY) * 60) + it.get(Calendar.MINUTE)
        }
        if (!CallSyncStore.isWithinOperatingHours(config, currentMinutes)) {
            CallSyncStore.saveDebugSnapshot(
                context = context,
                lastEvent = state,
                lastNumber = incomingNumber,
                lastResult = "Outside restaurant hours"
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
        val response = CallSyncPushService.pushEvent(
            context = context,
            config = config,
            event = CallSyncEvent(
                phone = phone,
                state = state,
                timestampMs = System.currentTimeMillis(),
                deviceId = config.deviceId
            )
        )

        CallSyncStore.saveDebugSnapshot(
            context = context,
            lastEvent = state,
            lastNumber = phone,
            lastResult = response.message
        )
    }
}
