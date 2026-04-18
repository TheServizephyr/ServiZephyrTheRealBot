package com.servizephyr.callsync

import android.Manifest
import android.app.TimePickerDialog
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.media.MediaRecorder
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.text.method.HideReturnsTransformationMethod
import android.text.method.PasswordTransformationMethod
import android.text.format.DateFormat as AndroidDateFormat
import android.view.MotionEvent
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.content.ContextCompat
import androidx.core.view.GravityCompat
import androidx.drawerlayout.widget.DrawerLayout
import com.google.android.material.card.MaterialCardView
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.materialswitch.MaterialSwitch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.io.File

class MainActivity : AppCompatActivity() {
    companion object {
        private const val VOICE_TAG = "CallSyncVoice"
        private const val VOICE_CAPTURE_NONE = "none"
        private const val VOICE_CAPTURE_NATIVE = "native"
        private const val VOICE_CAPTURE_AUDIO = "audio"
    }

    private lateinit var drawerLayout: DrawerLayout
    private lateinit var menuButton: ImageButton
    private lateinit var themeSwitch: MaterialSwitch
    private lateinit var syncPowerButton: ImageButton
    private lateinit var syncButtonCard: MaterialCardView
    private lateinit var warningBannerCard: MaterialCardView
    private lateinit var warningTitleText: TextView
    private lateinit var warningMessageText: TextView
    private lateinit var statusLabel: TextView
    private lateinit var statusText: TextView
    private lateinit var scheduleSummaryText: TextView
    private lateinit var quickStatusText: TextView
    private lateinit var mainInfoText: TextView
    private lateinit var testConnectionButton: Button
    private lateinit var tokenEditButton: Button
    private lateinit var tokenVisibilityButton: ImageButton
    private lateinit var scheduleEditButton: Button
    private lateinit var tokenInput: EditText
    private lateinit var primaryUrlValue: TextView
    private lateinit var backupUrlValue: TextView
    private lateinit var scheduleSwitch: MaterialSwitch
    private lateinit var openTimeButton: Button
    private lateinit var closeTimeButton: Button
    private lateinit var networkCheckButton: Button
    private lateinit var retryPendingButton: Button
    private lateinit var dummyCallButton: Button
    private lateinit var voiceRefreshButton: Button
    private lateinit var pendingStatusText: TextView
    private lateinit var lastSuccessText: TextView
    private lateinit var networkStatusText: TextView
    private lateinit var debugText: TextView
    private lateinit var voiceStatusText: TextView
    private lateinit var voiceContextText: TextView
    private lateinit var voiceSummaryText: TextView
    private lateinit var voiceItemsText: TextView
    private lateinit var voicePendingText: TextView
    private lateinit var voiceRecordFab: FloatingActionButton

    private lateinit var connectivityManager: ConnectivityManager
    private var networkCallbackRegistered = false
    private var selectedOpenMinutes: Int = 10 * 60
    private var selectedCloseMinutes: Int = 23 * 60
    private var isTokenEditing = false
    private var isTokenVisible = false
    private var isScheduleEditing = false
    private var currentVoiceDraft: CompanionVoiceDraft? = null
    private var mediaRecorder: MediaRecorder? = null
    private var pendingRecordingFile: File? = null
    private var pendingRecordingStartedAtMs: Long = 0L
    private var isVoiceRecording = false
    private var isVoiceSyncRunning = false
    private var lastVoiceUiMessage = ""
    private var lastVoiceUiTranscript = ""
    private var currentVoiceSttKeyterms: List<String> = emptyList()
    private var activeVoiceCaptureMode: String = VOICE_CAPTURE_NONE
    private val voiceUiHandler = Handler(Looper.getMainLooper())
    private var speechRecognizer: SpeechRecognizer? = null
    private var nativeSpeechTranscript = ""
    private var nativeSpeechPartialTranscript = ""
    private var nativeSpeechError = ""
    private var awaitingNativeSpeechResult = false
    private val finalizeNativeSpeechTimeout = Runnable {
        finalizeNativeSpeechCapture(reason = "timeout")
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            runOnUiThread { warmHostsInBackground(force = false) }
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        applyThemeFromPrefs()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        bindViews()
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

        val config = CallSyncStore.load(this)
        selectedOpenMinutes = config.openMinutes
        selectedCloseMinutes = config.closeMinutes

        menuButton.setOnClickListener { toggleDrawer() }
        themeSwitch.setOnCheckedChangeListener { _, isChecked ->
            CallSyncStore.setDarkMode(this, isChecked)
            AppCompatDelegate.setDefaultNightMode(
                if (isChecked) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
            )
        }

        syncPowerButton.setOnClickListener {
            val nextEnabled = !CallSyncStore.load(this).isSyncEnabled
            CallSyncStore.setSyncEnabled(this, nextEnabled)
            CallSyncStore.saveDebugSnapshot(
                context = this,
                lastEvent = "toggle",
                lastNumber = "",
                lastResult = if (nextEnabled) "Sync enabled from app" else "Sync disabled from app"
            )
            refreshUi()
        }

        testConnectionButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            runBackgroundAction("manual-test", "") {
                CallSyncPushService.testConnection(this, configToUse)
            }
        }

        dummyCallButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            val dummyPhone = buildDummyPhoneNumber()
            runBackgroundAction("dummy-call", dummyPhone) {
                CallSyncPushService.pushEvent(
                    context = this,
                    config = configToUse,
                    event = CallSyncEvent(
                        phone = dummyPhone,
                        state = "ringing",
                        timestampMs = System.currentTimeMillis(),
                        deviceId = configToUse.deviceId
                    )
                )
            }
        }

        retryPendingButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            runBackgroundAction("manual-retry", "") {
                CallSyncPushService.flushPendingEvents(this, configToUse)
            }
        }

        networkCheckButton.setOnClickListener {
            val configToUse = persistCurrentConfig()
            if (!canRunSyncActions(configToUse)) return@setOnClickListener
            runBackgroundAction("network-check", "") {
                CallSyncPushService.checkNetworkDns(configToUse)
            }
        }

        voiceRefreshButton.setOnClickListener {
            refreshVoiceDraftInBackground(force = true)
        }

        voiceRecordFab.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startVoiceCapture()
                    true
                }

                MotionEvent.ACTION_UP,
                MotionEvent.ACTION_CANCEL -> {
                    stopVoiceCaptureAndSync()
                    true
                }

                else -> false
            }
        }

        tokenEditButton.setOnClickListener {
            if (!isTokenEditing) {
                isTokenEditing = true
            } else {
                isTokenEditing = false
                persistCurrentConfig()
            }
            updateEditorStates()
        }

        tokenVisibilityButton.setOnClickListener {
            isTokenVisible = !isTokenVisible
            updateTokenVisibility()
        }

        scheduleEditButton.setOnClickListener {
            if (!isScheduleEditing) {
                isScheduleEditing = true
            } else {
                isScheduleEditing = false
                persistCurrentConfig()
            }
            updateEditorStates()
        }

        openTimeButton.setOnClickListener {
            if (!isScheduleEditing) return@setOnClickListener
            showTimePicker(selectedOpenMinutes) {
                selectedOpenMinutes = it
                updateTimeButtons()
            }
        }

        closeTimeButton.setOnClickListener {
            if (!isScheduleEditing) return@setOnClickListener
            showTimePicker(selectedCloseMinutes) {
                selectedCloseMinutes = it
                updateTimeButtons()
            }
        }

        refreshUi()
    }

    override fun onResume() {
        super.onResume()
        registerNetworkCallbackIfNeeded()
        refreshUi()
        warmHostsInBackground(force = false)
        refreshVoiceDraftInBackground(force = false)
    }

    override fun onPause() {
        super.onPause()
        unregisterNetworkCallbackIfNeeded()
        if (isVoiceRecording) {
            Log.w(VOICE_TAG, "onPause cancelling active voice recording")
            releaseVoiceRecorder(deleteFile = true)
            releaseSpeechRecognizer(clearSession = true)
            activeVoiceCaptureMode = VOICE_CAPTURE_NONE
            isVoiceRecording = false
            lastVoiceUiMessage = "Voice recording was cancelled."
            refreshUi()
        }
    }

    override fun onDestroy() {
        Log.d(VOICE_TAG, "onDestroy releasing recorder resources")
        voiceUiHandler.removeCallbacks(finalizeNativeSpeechTimeout)
        releaseSpeechRecognizer(clearSession = true)
        releaseVoiceRecorder(deleteFile = true)
        super.onDestroy()
    }

    private fun bindViews() {
        drawerLayout = findViewById(R.id.drawerLayout)
        menuButton = findViewById(R.id.menuButton)
        themeSwitch = findViewById(R.id.themeSwitch)
        syncPowerButton = findViewById(R.id.syncPowerButton)
        syncButtonCard = findViewById(R.id.syncButtonCard)
        warningBannerCard = findViewById(R.id.warningBannerCard)
        warningTitleText = findViewById(R.id.warningTitleText)
        warningMessageText = findViewById(R.id.warningMessageText)
        statusLabel = findViewById(R.id.statusLabel)
        statusText = findViewById(R.id.statusText)
        scheduleSummaryText = findViewById(R.id.scheduleSummaryText)
        quickStatusText = findViewById(R.id.quickStatusText)
        mainInfoText = findViewById(R.id.mainInfoText)
        testConnectionButton = findViewById(R.id.testConnectionButton)
        tokenEditButton = findViewById(R.id.tokenEditButton)
        tokenVisibilityButton = findViewById(R.id.tokenVisibilityButton)
        scheduleEditButton = findViewById(R.id.scheduleEditButton)
        tokenInput = findViewById(R.id.tokenInput)
        primaryUrlValue = findViewById(R.id.primaryUrlValue)
        backupUrlValue = findViewById(R.id.backupUrlValue)
        scheduleSwitch = findViewById(R.id.scheduleSwitch)
        openTimeButton = findViewById(R.id.openTimeButton)
        closeTimeButton = findViewById(R.id.closeTimeButton)
        networkCheckButton = findViewById(R.id.networkCheckButton)
        retryPendingButton = findViewById(R.id.retryPendingButton)
        dummyCallButton = findViewById(R.id.dummyCallButton)
        voiceRefreshButton = findViewById(R.id.voiceRefreshButton)
        pendingStatusText = findViewById(R.id.pendingStatusText)
        lastSuccessText = findViewById(R.id.lastSuccessText)
        networkStatusText = findViewById(R.id.networkStatusText)
        debugText = findViewById(R.id.debugText)
        voiceStatusText = findViewById(R.id.voiceStatusText)
        voiceContextText = findViewById(R.id.voiceContextText)
        voiceSummaryText = findViewById(R.id.voiceSummaryText)
        voiceItemsText = findViewById(R.id.voiceItemsText)
        voicePendingText = findViewById(R.id.voicePendingText)
        voiceRecordFab = findViewById(R.id.voiceRecordFab)
    }

    private fun applyThemeFromPrefs() {
        val config = CallSyncStore.load(this)
        AppCompatDelegate.setDefaultNightMode(
            if (config.isDarkMode) AppCompatDelegate.MODE_NIGHT_YES else AppCompatDelegate.MODE_NIGHT_NO
        )
    }

    private fun refreshUi() {
        val config = CallSyncStore.load(this)
        val hasPhoneState = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED
        val hasCallLog = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_CALL_LOG
        ) == PackageManager.PERMISSION_GRANTED
        val hasMicPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        val hasPermissions = hasPhoneState && hasCallLog
        val withinHours = CallSyncStore.isWithinOperatingHours(config, currentMinutes())
        val debugSnapshot = CallSyncStore.loadDebugSnapshot(this)

        themeSwitch.isChecked = config.isDarkMode
        primaryUrlValue.text = config.serverBaseUrl
        backupUrlValue.text = config.backupServerBaseUrl
        tokenInput.setText(config.token)
        selectedOpenMinutes = config.openMinutes
        selectedCloseMinutes = config.closeMinutes
        scheduleSwitch.isChecked = config.isScheduleEnabled
        updateTimeButtons()
        updateEditorStates()

        statusLabel.text = if (config.isSyncEnabled) getString(R.string.sync_on_label) else getString(R.string.sync_off_label)
        statusText.text = when {
            !config.isSyncEnabled -> getString(R.string.sync_disabled)
            !withinHours -> getString(R.string.outside_schedule)
            hasPermissions -> getString(R.string.permissions_ready)
            else -> getString(R.string.permissions_missing)
        }
        scheduleSummaryText.text = if (config.isScheduleEnabled) {
            getString(R.string.schedule_summary_on, formatMinutes(config.openMinutes), formatMinutes(config.closeMinutes))
        } else {
            getString(R.string.schedule_summary_off)
        }
        syncButtonCard.setCardBackgroundColor(if (config.isSyncEnabled) Color.parseColor("#FFCC1B") else Color.parseColor("#D8D0E8"))
        quickStatusText.text = buildQuickStatus(debugSnapshot.lastResult)
        mainInfoText.text = buildMainInfoText(config, debugSnapshot)

        pendingStatusText.text = getString(R.string.pending_events, CallSyncPushService.getPendingEventCount(this))
        lastSuccessText.text = buildLastSuccessText()
        networkStatusText.text = getString(
            R.string.network_status_value,
            if (debugSnapshot.lastEvent == "network-check") debugSnapshot.lastResult.ifBlank { getString(R.string.network_status_unknown) }
            else getString(R.string.network_status_unknown)
        )
        debugText.text = buildDebugText(debugSnapshot)
        warningBannerCard.setOnClickListener {
            if (!hasPermissions || !hasMicPermission) {
                permissionLauncher.launch(
                    arrayOf(
                        Manifest.permission.READ_PHONE_STATE,
                        Manifest.permission.READ_CALL_LOG,
                        Manifest.permission.RECORD_AUDIO
                    )
                )
            }
        }

        voiceRefreshButton.isEnabled = config.token.isNotBlank() && !isVoiceSyncRunning
        voiceRecordFab.isEnabled = config.isSyncEnabled && hasMicPermission && config.token.isNotBlank() && !isVoiceSyncRunning
        voiceRecordFab.backgroundTintList = ColorStateList.valueOf(
            Color.parseColor(
                when {
                    isVoiceRecording -> "#FF9F1C"
                    isVoiceSyncRunning -> "#D8D0E8"
                    else -> "#FFCC1B"
                }
            )
        )
        voiceRecordFab.setImageResource(
            when {
                isVoiceRecording -> android.R.drawable.ic_media_pause
                isVoiceSyncRunning -> android.R.drawable.stat_notify_sync
                else -> android.R.drawable.ic_btn_speak_now
            }
        )
        voiceRecordFab.scaleX = if (isVoiceRecording) 1.14f else 1.0f
        voiceRecordFab.scaleY = if (isVoiceRecording) 1.14f else 1.0f
        voiceStatusText.text = when {
            !config.isSyncEnabled -> getString(R.string.voice_status_paused)
            !hasMicPermission -> getString(R.string.voice_status_missing_mic)
            isVoiceRecording -> getString(R.string.voice_status_recording)
            isVoiceSyncRunning && awaitingNativeSpeechResult -> getString(R.string.voice_status_transcribing_phone)
            isVoiceSyncRunning -> getString(R.string.voice_status_syncing)
            else -> getString(R.string.voice_status_ready)
        }
        voiceContextText.text = buildVoiceContextText(currentVoiceDraft)
        voiceSummaryText.text = buildVoiceSummaryText(currentVoiceDraft)
        voiceItemsText.text = buildVoiceItemsText(currentVoiceDraft)
        voicePendingText.text = buildVoicePendingText(currentVoiceDraft)

        applyWarningBanner(
            debugSnapshot.lastEvent,
            debugSnapshot.lastResult,
            config.isSyncEnabled,
            hasPermissions && hasMicPermission,
            withinHours
        )
    }

    private fun updateEditorStates() {
        tokenInput.isEnabled = isTokenEditing
        tokenEditButton.text = if (isTokenEditing) getString(R.string.save_label) else getString(R.string.edit_label)
        scheduleSwitch.isEnabled = isScheduleEditing
        openTimeButton.isEnabled = isScheduleEditing
        closeTimeButton.isEnabled = isScheduleEditing
        scheduleEditButton.text = if (isScheduleEditing) getString(R.string.save_label) else getString(R.string.edit_label)
        updateTokenVisibility()
    }

    private fun updateTokenVisibility() {
        tokenInput.transformationMethod = if (isTokenVisible) {
            HideReturnsTransformationMethod.getInstance()
        } else {
            PasswordTransformationMethod.getInstance()
        }
        tokenInput.setSelection(tokenInput.text?.length ?: 0)
        tokenVisibilityButton.contentDescription = if (isTokenVisible) getString(R.string.hide_token) else getString(R.string.show_token)
    }

    private fun buildQuickStatus(latestResult: String): String {
        val normalized = latestResult.lowercase()
        return when {
            normalized.contains("dns failed") -> getString(R.string.quick_status_dns_issue)
            normalized.contains("timeout") || normalized.contains("unable") -> getString(R.string.quick_status_network_issue)
            normalized.contains("http 200") -> getString(R.string.quick_status_healthy)
            latestResult.isBlank() -> getString(R.string.quick_status_idle)
            else -> getString(R.string.quick_status_monitoring)
        }
    }

    private fun buildMainInfoText(config: CallSyncConfig, debugSnapshot: CallSyncStore.DebugSnapshot): String {
        val lastSuccess = CallSyncPushService.getLastSuccessAt(this)
        val lastSuccessText = if (lastSuccess > 0L) {
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(lastSuccess))
        } else {
            getString(R.string.last_success_not_yet_short)
        }
        return getString(
            R.string.main_info_template,
            if (config.isSyncEnabled) getString(R.string.sync_state_enabled) else getString(R.string.sync_state_disabled),
            lastSuccessText,
            debugSnapshot.lastEvent.ifBlank { getString(R.string.none_label) }
        )
    }

    private fun buildLastSuccessText(): String {
        val lastSuccessAt = CallSyncPushService.getLastSuccessAt(this)
        return if (lastSuccessAt > 0L) {
            getString(
                R.string.last_success,
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(lastSuccessAt))
            )
        } else {
            getString(R.string.last_success_never)
        }
    }

    private fun buildDebugText(debugSnapshot: CallSyncStore.DebugSnapshot): String = buildString {
        append(getString(R.string.debug_last_event, debugSnapshot.lastEvent.ifBlank { getString(R.string.none_label) }))
        append("\n")
        append(getString(R.string.debug_last_number, debugSnapshot.lastNumber.ifBlank { "empty" }))
        append("\n")
        append(getString(R.string.debug_last_result, debugSnapshot.lastResult.ifBlank { getString(R.string.none_label) }))
        if (debugSnapshot.lastUpdatedAt > 0L) {
            append("\n")
            append(getString(
                R.string.debug_last_updated,
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(debugSnapshot.lastUpdatedAt))
            ))
        }
    }

    private fun applyWarningBanner(
        lastEvent: String,
        latestResult: String,
        isSyncEnabled: Boolean,
        hasPermissions: Boolean,
        withinHours: Boolean
    ) {
        if (!isSyncEnabled || !withinHours) {
            showBanner(getString(R.string.banner_paused_title), getString(R.string.banner_paused_message), "#FFE7A6")
            return
        }
        if (!hasPermissions) {
            showBanner(getString(R.string.banner_permission_title), getString(R.string.banner_permission_message), "#FFCDD2")
            return
        }

        val normalized = latestResult.lowercase()
        when {
            normalized.contains("dns failed") -> showBanner(
                getString(R.string.banner_dns_title),
                getString(R.string.banner_dns_message),
                "#FFE082"
            )
            normalized.contains("timeout") || normalized.contains("unable") || normalized.contains("error:") -> showBanner(
                getString(R.string.banner_network_title),
                getString(R.string.banner_network_message),
                "#FFCDD2"
            )
            lastEvent in setOf("manual-test", "network-check", "dummy-call") && normalized.contains("http 200") -> showBanner(
                getString(R.string.banner_healthy_title),
                getString(R.string.banner_healthy_message),
                "#C8E6C9"
            )
            else -> hideBanner()
        }
    }

    private fun showBanner(title: String, message: String, backgroundColor: String) {
        warningBannerCard.visibility = android.view.View.VISIBLE
        warningBannerCard.setCardBackgroundColor(Color.parseColor(backgroundColor))
        warningTitleText.text = title
        warningMessageText.text = message
    }

    private fun hideBanner() {
        warningBannerCard.visibility = android.view.View.GONE
    }

    private fun persistCurrentConfig(): CallSyncConfig {
        CallSyncStore.save(
            context = this,
            serverBaseUrl = CallSyncStore.DEFAULT_SERVER_BASE_URL,
            backupServerBaseUrl = CallSyncStore.DEFAULT_BACKUP_SERVER_BASE_URL,
            token = tokenInput.text.toString(),
            isScheduleEnabled = scheduleSwitch.isChecked,
            openMinutes = selectedOpenMinutes,
            closeMinutes = selectedCloseMinutes
        )
        return CallSyncStore.load(this)
    }

    private fun canRunSyncActions(config: CallSyncConfig): Boolean {
        if (config.serverBaseUrl.isBlank() || config.token.isBlank()) {
            CallSyncStore.saveDebugSnapshot(this, "manual-check", "", getString(R.string.not_configured))
            refreshUi()
            return false
        }
        return true
    }

    private fun runBackgroundAction(debugEvent: String, debugNumber: String, action: () -> PushAttemptResult) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = action()
            CallSyncStore.saveDebugSnapshot(this@MainActivity, debugEvent, debugNumber, result.message)
            runOnUiThread { refreshUi() }
        }
    }

    private fun refreshVoiceDraftInBackground(force: Boolean) {
        val config = persistCurrentConfig()
        if (!force && (isVoiceSyncRunning || isVoiceRecording)) {
            Log.d(
                VOICE_TAG,
                "refreshVoiceDraft skipped force=$force recording=$isVoiceRecording syncing=$isVoiceSyncRunning"
            )
            return
        }
        if (config.token.isBlank()) {
            Log.w(VOICE_TAG, "refreshVoiceDraft skipped: token missing")
            currentVoiceDraft = null
            currentVoiceSttKeyterms = emptyList()
            lastVoiceUiMessage = getString(R.string.not_configured)
            lastVoiceUiTranscript = ""
            refreshUi()
            return
        }

        isVoiceSyncRunning = true
        Log.d(
            VOICE_TAG,
            "refreshVoiceDraft start force=$force deviceId=${config.deviceId} candidates=${CallSyncStore.buildCandidateBaseUrls(config).size}"
        )
        refreshUi()
        CoroutineScope(Dispatchers.IO).launch {
            val result = CallSyncVoiceService.fetchDraft(config)
            CallSyncStore.saveDebugSnapshot(
                this@MainActivity,
                "voice-refresh",
                "",
                result.message
            )
            runOnUiThread {
                if (result.success && result.draft != null) {
                    currentVoiceDraft = result.draft
                    lastVoiceUiMessage = result.draft.note.ifBlank { result.message }
                    lastVoiceUiTranscript = result.draft.lastTranscript.ifBlank { result.transcript }
                    if (result.sttKeyterms.isNotEmpty()) {
                        currentVoiceSttKeyterms = result.sttKeyterms
                    }
                } else if (force) {
                    lastVoiceUiMessage = result.message
                    lastVoiceUiTranscript = result.transcript
                    showShortToast(result.message)
                }
                isVoiceSyncRunning = false
                Log.d(
                    VOICE_TAG,
                    "refreshVoiceDraft finished success=${result.success} baseUrl=${result.attemptedBaseUrl ?: ""} message=${result.message} transcriptLen=${result.transcript.length} items=${result.draft?.items?.size ?: 0} pending=${result.draft?.pendingItems?.size ?: 0} keyterms=${currentVoiceSttKeyterms.size}"
                )
                refreshUi()
            }
        }
    }

    private fun warmHostsInBackground(force: Boolean) {
        val config = CallSyncStore.load(this)
        if (config.serverBaseUrl.isBlank() || config.token.isBlank()) return
        CoroutineScope(Dispatchers.IO).launch {
            val result = CallSyncPushService.warmHosts(this@MainActivity, config, force)
            if (!result.success) {
                CallSyncStore.saveDebugSnapshot(this@MainActivity, "warm-up", "", result.message)
                runOnUiThread { refreshUi() }
            }
        }
    }

    private fun registerNetworkCallbackIfNeeded() {
        if (networkCallbackRegistered) return
        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback)
            networkCallbackRegistered = true
        } catch (_: Exception) {
            networkCallbackRegistered = false
        }
    }

    private fun unregisterNetworkCallbackIfNeeded() {
        if (!networkCallbackRegistered) return
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) {
        } finally {
            networkCallbackRegistered = false
        }
    }

    private fun toggleDrawer() {
        if (drawerLayout.isDrawerOpen(GravityCompat.START)) {
            drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            drawerLayout.openDrawer(GravityCompat.START)
        }
    }

    private fun showTimePicker(initialMinutes: Int, onSelected: (Int) -> Unit) {
        val hour = initialMinutes / 60
        val minute = initialMinutes % 60
        TimePickerDialog(
            this,
            { _, pickedHour, pickedMinute -> onSelected((pickedHour * 60) + pickedMinute) },
            hour,
            minute,
            AndroidDateFormat.is24HourFormat(this)
        ).show()
    }

    private fun updateTimeButtons() {
        openTimeButton.text = formatMinutes(selectedOpenMinutes)
        closeTimeButton.text = formatMinutes(selectedCloseMinutes)
    }

    private fun formatMinutes(totalMinutes: Int): String {
        val hour = (totalMinutes / 60) % 24
        val minute = totalMinutes % 60
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
        }
        return DateFormat.getTimeInstance(DateFormat.SHORT).format(calendar.time)
    }

    private fun currentMinutes(): Int {
        val calendar = Calendar.getInstance()
        return calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    }

    private fun buildDummyPhoneNumber(): String {
        val suffix = (System.currentTimeMillis() % 1_000_000_000L).toString().padStart(9, '0')
        return "9$suffix".take(10)
    }

    private fun startVoiceCapture() {
        val config = persistCurrentConfig()
        if (!config.isSyncEnabled) {
            Log.w(VOICE_TAG, "startVoiceCapture skipped: sync disabled")
            CallSyncStore.saveDebugSnapshot(this, "voice-start", "", getString(R.string.voice_status_paused))
            lastVoiceUiMessage = getString(R.string.voice_status_paused)
            lastVoiceUiTranscript = ""
            showShortToast(lastVoiceUiMessage)
            refreshUi()
            return
        }
        if (config.token.isBlank()) {
            Log.w(VOICE_TAG, "startVoiceCapture skipped: token missing")
            CallSyncStore.saveDebugSnapshot(this, "voice-start", "", getString(R.string.not_configured))
            lastVoiceUiMessage = getString(R.string.not_configured)
            lastVoiceUiTranscript = ""
            showShortToast(lastVoiceUiMessage)
            refreshUi()
            return
        }
        val hasMicPermission = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasMicPermission) {
            Log.w(VOICE_TAG, "startVoiceCapture skipped: mic permission missing")
            CallSyncStore.saveDebugSnapshot(this, "voice-start", "", getString(R.string.voice_permission_prompt))
            lastVoiceUiMessage = getString(R.string.voice_permission_prompt)
            lastVoiceUiTranscript = ""
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.READ_CALL_LOG,
                    Manifest.permission.RECORD_AUDIO
                )
            )
            showShortToast(lastVoiceUiMessage)
            refreshUi()
            return
        }
        if (isVoiceRecording || isVoiceSyncRunning) {
            Log.w(VOICE_TAG, "startVoiceCapture skipped: recording=$isVoiceRecording syncing=$isVoiceSyncRunning")
            return
        }

        resetSpeechSession()
        if (startNativeSpeechCapture()) {
            activeVoiceCaptureMode = VOICE_CAPTURE_NATIVE
            pendingRecordingFile = null
            pendingRecordingStartedAtMs = 0L
            mediaRecorder = null
            isVoiceRecording = true
            lastVoiceUiMessage = getString(R.string.voice_status_recording)
            lastVoiceUiTranscript = ""
            Log.d(VOICE_TAG, "voice capture started mode=native-speech")
            CallSyncStore.saveDebugSnapshot(this, "voice-start", "", "Phone speech capture started")
            refreshUi()
            return
        }

        val audioFile = File(cacheDir, "voice-billing-${System.currentTimeMillis()}.m4a")
        val startError = startVoiceRecorderWithFallback(audioFile)
        if (startError == null) {
            activeVoiceCaptureMode = VOICE_CAPTURE_AUDIO
            pendingRecordingFile = audioFile
            pendingRecordingStartedAtMs = System.currentTimeMillis()
            isVoiceRecording = true
            lastVoiceUiMessage = getString(R.string.voice_status_recording)
            lastVoiceUiTranscript = ""
            Log.d(VOICE_TAG, "voice capture started mode=audio file=${audioFile.absolutePath}")
            CallSyncStore.saveDebugSnapshot(this, "voice-start", "", "Audio voice capture started")
        } else {
            if (audioFile.exists()) {
                audioFile.delete()
            }
            activeVoiceCaptureMode = VOICE_CAPTURE_NONE
            pendingRecordingFile = null
            pendingRecordingStartedAtMs = 0L
            mediaRecorder = null
            isVoiceRecording = false
            lastVoiceUiMessage = "Voice capture failed: $startError"
            lastVoiceUiTranscript = ""
            Log.e(VOICE_TAG, "voice capture failed startError=$startError")
            CallSyncStore.saveDebugSnapshot(this, "voice-start", "", lastVoiceUiMessage)
            showShortToast(lastVoiceUiMessage)
        }
        refreshUi()
    }

    private fun stopVoiceCaptureAndSync() {
        if (!isVoiceRecording) {
            Log.w(VOICE_TAG, "stopVoiceCaptureAndSync ignored: recording not active")
            return
        }

        when (activeVoiceCaptureMode) {
            VOICE_CAPTURE_NATIVE -> stopNativeSpeechCaptureAndSync()
            VOICE_CAPTURE_AUDIO -> stopAudioCaptureAndSync()
            else -> {
                Log.w(VOICE_TAG, "stopVoiceCaptureAndSync ignored: unknown capture mode")
                isVoiceRecording = false
                activeVoiceCaptureMode = VOICE_CAPTURE_NONE
                refreshUi()
            }
        }
    }

    private fun stopNativeSpeechCaptureAndSync() {
        isVoiceRecording = false
        isVoiceSyncRunning = true
        awaitingNativeSpeechResult = true
        activeVoiceCaptureMode = VOICE_CAPTURE_NONE
        lastVoiceUiMessage = getString(R.string.voice_status_transcribing_phone)
        lastVoiceUiTranscript = nativeSpeechPartialTranscript.ifBlank { nativeSpeechTranscript }
        Log.d(
            VOICE_TAG,
            "native speech stop requested partialLen=${nativeSpeechPartialTranscript.length} finalLen=${nativeSpeechTranscript.length}"
        )
        refreshUi()

        if (nativeSpeechTranscript.isNotBlank()) {
            finalizeNativeSpeechCapture(reason = "cached-result")
            return
        }

        val recognizer = speechRecognizer
        if (recognizer == null) {
            finalizeNativeSpeechCapture(reason = "missing-recognizer")
            return
        }

        voiceUiHandler.removeCallbacks(finalizeNativeSpeechTimeout)
        val stopFailure = runCatching { recognizer.stopListening() }.exceptionOrNull()
        if (stopFailure != null) {
            nativeSpeechError = stopFailure.message ?: "Phone speech listener could not stop cleanly."
            Log.e(VOICE_TAG, "native speech stop failed message=${nativeSpeechError}", stopFailure)
            finalizeNativeSpeechCapture(reason = "stop-failed")
            return
        }
        voiceUiHandler.postDelayed(finalizeNativeSpeechTimeout, 1500L)
    }

    private fun stopAudioCaptureAndSync() {
        val audioFile = pendingRecordingFile
        val recorder = mediaRecorder
        val startedAtMs = pendingRecordingStartedAtMs
        var captureStoppedCleanly = true
        try {
            recorder?.stop()
        } catch (_: RuntimeException) {
            captureStoppedCleanly = false
        } finally {
            runCatching { recorder?.reset() }
            runCatching { recorder?.release() }
            mediaRecorder = null
            pendingRecordingFile = null
            pendingRecordingStartedAtMs = 0L
        }

        isVoiceRecording = false
        activeVoiceCaptureMode = VOICE_CAPTURE_NONE
        val captureDurationMs = if (startedAtMs > 0L) {
            System.currentTimeMillis() - startedAtMs
        } else {
            0L
        }
        Log.d(
            VOICE_TAG,
            "voice capture stopped clean=$captureStoppedCleanly durationMs=$captureDurationMs fileExists=${audioFile?.exists()} fileBytes=${audioFile?.length() ?: -1L}"
        )
        if (!captureStoppedCleanly || audioFile == null || !audioFile.exists() || audioFile.length() <= 0L || captureDurationMs < 350L) {
            if (audioFile != null && audioFile.exists()) {
                audioFile.delete()
            }
            lastVoiceUiMessage = if (!captureStoppedCleanly) {
                "Voice capture could not finish on this phone."
            } else {
                getString(R.string.voice_capture_too_short)
            }
            lastVoiceUiTranscript = ""
            Log.e(VOICE_TAG, "voice capture rejected message=$lastVoiceUiMessage")
            CallSyncStore.saveDebugSnapshot(this, "voice-sync", "", lastVoiceUiMessage)
            showShortToast(lastVoiceUiMessage)
            refreshUi()
            return
        }

        syncRecordedAudioCapture(audioFile, captureDurationMs)
    }

    private fun startNativeSpeechCapture(): Boolean {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Log.w(VOICE_TAG, "native speech recognition unavailable on device")
            return false
        }

        releaseSpeechRecognizer(clearSession = false)
        resetSpeechSession()

        return try {
            val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    Log.d(VOICE_TAG, "native speech ready for speech")
                }

                override fun onBeginningOfSpeech() {
                    Log.d(VOICE_TAG, "native speech beginning of speech")
                }

                override fun onRmsChanged(rmsdB: Float) = Unit

                override fun onBufferReceived(buffer: ByteArray?) = Unit

                override fun onEndOfSpeech() {
                    Log.d(VOICE_TAG, "native speech end of speech")
                }

                override fun onError(error: Int) {
                    nativeSpeechError = mapSpeechRecognizerError(error)
                    Log.w(
                        VOICE_TAG,
                        "native speech error code=$error message=$nativeSpeechError awaiting=$awaitingNativeSpeechResult"
                    )
                    if (awaitingNativeSpeechResult) {
                        finalizeNativeSpeechCapture(reason = "error-$error")
                    }
                }

                override fun onResults(results: Bundle?) {
                    nativeSpeechTranscript = extractBestSpeechTranscript(results)
                    Log.d(
                        VOICE_TAG,
                        "native speech results transcriptLen=${nativeSpeechTranscript.length} awaiting=$awaitingNativeSpeechResult"
                    )
                    if (awaitingNativeSpeechResult) {
                        finalizeNativeSpeechCapture(reason = "results")
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    val partialTranscript = extractBestSpeechTranscript(partialResults)
                    if (partialTranscript.isBlank()) return
                    nativeSpeechPartialTranscript = partialTranscript
                    lastVoiceUiTranscript = partialTranscript
                    Log.d(VOICE_TAG, "native speech partial transcript=$partialTranscript")
                    if (isVoiceRecording && activeVoiceCaptureMode == VOICE_CAPTURE_NATIVE) {
                        refreshUi()
                    }
                }

                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            speechRecognizer = recognizer
            recognizer.startListening(
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                    putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
                }
            )
            true
        } catch (error: Exception) {
            Log.e(VOICE_TAG, "native speech start failed message=${error.message}", error)
            releaseSpeechRecognizer(clearSession = true)
            false
        }
    }

    private fun finalizeNativeSpeechCapture(reason: String) {
        voiceUiHandler.removeCallbacks(finalizeNativeSpeechTimeout)
        if (!awaitingNativeSpeechResult && nativeSpeechTranscript.isBlank() && nativeSpeechPartialTranscript.isBlank()) {
            return
        }

        awaitingNativeSpeechResult = false
        val resolvedTranscript = nativeSpeechTranscript
            .ifBlank { nativeSpeechPartialTranscript }
            .trim()
        val resolvedError = nativeSpeechError
        Log.d(
            VOICE_TAG,
            "finalizeNativeSpeechCapture reason=$reason transcriptLen=${resolvedTranscript.length} error=$resolvedError"
        )
        releaseSpeechRecognizer(clearSession = false)

        if (resolvedTranscript.isBlank()) {
            isVoiceSyncRunning = false
            lastVoiceUiMessage = resolvedError.ifBlank { getString(R.string.voice_native_no_match) }
            lastVoiceUiTranscript = ""
            CallSyncStore.saveDebugSnapshot(this, "voice-sync", "", lastVoiceUiMessage)
            showShortToast(lastVoiceUiMessage)
            resetSpeechSession()
            refreshUi()
            return
        }

        resetSpeechSession()
        syncVoiceTranscript(resolvedTranscript)
    }

    private fun syncVoiceTranscript(transcript: String) {
        val normalizedTranscript = transcript.trim()
        if (normalizedTranscript.isBlank()) {
            isVoiceSyncRunning = false
            lastVoiceUiMessage = getString(R.string.voice_native_no_match)
            lastVoiceUiTranscript = ""
            refreshUi()
            return
        }

        val config = persistCurrentConfig()
        isVoiceSyncRunning = true
        lastVoiceUiMessage = getString(R.string.voice_status_syncing)
        lastVoiceUiTranscript = normalizedTranscript
        Log.d(
            VOICE_TAG,
            "voice transcript sync starting chars=${normalizedTranscript.length} deviceId=${config.deviceId}"
        )
        refreshUi()

        CoroutineScope(Dispatchers.IO).launch {
            val commandId = "android-${config.deviceId}-${System.currentTimeMillis()}"
            val result = CallSyncVoiceService.pushVoiceTranscript(
                config = config,
                transcript = normalizedTranscript,
                commandId = commandId,
                sttKeyterms = currentVoiceSttKeyterms
            )
            CallSyncStore.saveDebugSnapshot(
                this@MainActivity,
                "voice-sync",
                result.transcript.ifBlank { normalizedTranscript },
                result.message
            )
            runOnUiThread {
                applyVoiceSyncResult(
                    result = result,
                    fallbackTranscript = normalizedTranscript,
                    sourceLabel = "native"
                )
            }
        }
    }

    private fun syncRecordedAudioCapture(audioFile: File, captureDurationMs: Long) {
        val config = persistCurrentConfig()
        isVoiceSyncRunning = true
        lastVoiceUiMessage = getString(R.string.voice_status_syncing)
        lastVoiceUiTranscript = ""
        Log.d(
            VOICE_TAG,
            "voice upload starting bytes=${audioFile.length()} durationMs=$captureDurationMs deviceId=${config.deviceId}"
        )
        refreshUi()

        CoroutineScope(Dispatchers.IO).launch {
            val commandId = "android-${config.deviceId}-${System.currentTimeMillis()}"
            val result = CallSyncVoiceService.pushVoiceCommand(
                config = config,
                audioFile = audioFile,
                mimeType = "audio/mp4",
                commandId = commandId,
                sttKeyterms = currentVoiceSttKeyterms
            )
            audioFile.delete()
            CallSyncStore.saveDebugSnapshot(
                this@MainActivity,
                "voice-sync",
                result.transcript,
                result.message
            )
            runOnUiThread {
                applyVoiceSyncResult(
                    result = result,
                    fallbackTranscript = "",
                    sourceLabel = "audio"
                )
            }
        }
    }

    private fun applyVoiceSyncResult(result: VoiceDraftResult, fallbackTranscript: String, sourceLabel: String) {
        if (result.success && result.draft != null) {
            currentVoiceDraft = result.draft
        }
        if (result.sttKeyterms.isNotEmpty()) {
            currentVoiceSttKeyterms = result.sttKeyterms
        }
        lastVoiceUiMessage = result.draft?.note?.ifBlank { result.message } ?: result.message
        lastVoiceUiTranscript = result.draft?.lastTranscript
            ?.ifBlank { result.transcript.ifBlank { fallbackTranscript } }
            ?: result.transcript.ifBlank { fallbackTranscript }
        isVoiceSyncRunning = false
        Log.d(
            VOICE_TAG,
            "voice sync finished source=$sourceLabel success=${result.success} baseUrl=${result.attemptedBaseUrl ?: ""} message=${result.message} transcriptLen=${lastVoiceUiTranscript.length} items=${result.draft?.items?.size ?: 0} pending=${result.draft?.pendingItems?.size ?: 0} keyterms=${currentVoiceSttKeyterms.size}"
        )
        showShortToast(lastVoiceUiMessage)
        refreshUi()
    }

    private fun resetSpeechSession() {
        voiceUiHandler.removeCallbacks(finalizeNativeSpeechTimeout)
        nativeSpeechTranscript = ""
        nativeSpeechPartialTranscript = ""
        nativeSpeechError = ""
        awaitingNativeSpeechResult = false
    }

    private fun releaseSpeechRecognizer(clearSession: Boolean) {
        voiceUiHandler.removeCallbacks(finalizeNativeSpeechTimeout)
        val recognizer = speechRecognizer
        speechRecognizer = null
        runCatching { recognizer?.cancel() }
        runCatching { recognizer?.destroy() }
        if (clearSession) {
            resetSpeechSession()
        }
    }

    private fun extractBestSpeechTranscript(results: Bundle?): String {
        val matches = results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            .orEmpty()
            .map { it.trim() }
            .filter { it.isNotBlank() }
        return matches.firstOrNull().orEmpty()
    }

    private fun mapSpeechRecognizerError(error: Int): String {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "Phone speech audio capture failed."
            SpeechRecognizer.ERROR_CLIENT -> "Phone speech service stopped unexpectedly."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> getString(R.string.voice_permission_prompt)
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Phone speech service needs a better network connection."
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> getString(R.string.voice_native_no_match)
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Phone speech service is busy right now."
            SpeechRecognizer.ERROR_SERVER -> "Phone speech service had a server error."
            else -> "Phone speech recognition failed."
        }
    }

    private fun releaseVoiceRecorder(deleteFile: Boolean) {
        val recorder = mediaRecorder
        mediaRecorder = null
        runCatching { recorder?.reset() }
        runCatching { recorder?.release() }
        val audioFile = pendingRecordingFile
        pendingRecordingFile = null
        pendingRecordingStartedAtMs = 0L
        Log.d(
            VOICE_TAG,
            "releaseVoiceRecorder deleteFile=$deleteFile hadRecorder=${recorder != null} file=${audioFile?.name ?: ""} fileExists=${audioFile?.exists() ?: false}"
        )
        if (deleteFile && audioFile != null && audioFile.exists()) {
            audioFile.delete()
        }
    }

    private fun startVoiceRecorderWithFallback(audioFile: File): String? {
        val audioSources = listOf(
            MediaRecorder.AudioSource.VOICE_RECOGNITION to "voice recognition",
            MediaRecorder.AudioSource.MIC to "microphone"
        )
        val failures = mutableListOf<String>()

        for ((audioSource, sourceLabel) in audioSources) {
            val recorder = buildMediaRecorder()
            try {
                Log.d(VOICE_TAG, "trying recorder source=$sourceLabel")
                recorder.setAudioSource(audioSource)
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                recorder.setAudioChannels(1)
                recorder.setAudioEncodingBitRate(64_000)
                recorder.setAudioSamplingRate(16_000)
                recorder.setOutputFile(audioFile.absolutePath)
                recorder.prepare()
                recorder.start()
                mediaRecorder = recorder
                Log.d(VOICE_TAG, "recorder started source=$sourceLabel")
                return null
            } catch (error: Exception) {
                runCatching { recorder.reset() }
                runCatching { recorder.release() }
                Log.e(VOICE_TAG, "recorder source failed source=$sourceLabel message=${error.message}", error)
                failures += "$sourceLabel: ${error.message ?: "unknown"}"
            }
        }

        return failures.joinToString(" | ").ifBlank { "unknown recorder error" }
    }

    private fun buildMediaRecorder(): MediaRecorder {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(this)
        } else {
            MediaRecorder()
        }
    }

    private fun buildVoiceContextText(draft: CompanionVoiceDraft?): String {
        if (draft == null) return getString(R.string.voice_context_placeholder)

        val tableSuffix = if (draft.activeTableName.isNotBlank()) {
            "\nTable: ${draft.activeTableName}"
        } else {
            ""
        }
        val updatedLabel = if (draft.updatedAt > 0L) {
            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(draft.updatedAt))
        } else {
            getString(R.string.none_label)
        }
        return getString(
            R.string.voice_context_template,
            draft.restaurantName.ifBlank { getString(R.string.voice_empty_draft) },
            draft.orderType.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString() },
            tableSuffix,
            updatedLabel
        )
    }

    private fun buildVoiceItemsText(draft: CompanionVoiceDraft?): String {
        val items = draft?.items.orEmpty()
        if (items.isEmpty()) return getString(R.string.voice_items_placeholder)

        return items.joinToString("\n") { item ->
            buildString {
                append("${item.quantity} x ${item.name}")
                if (item.portionLabel.isNotBlank()) {
                    append(" (${item.portionLabel})")
                }
                if (item.totalPrice > 0.0) {
                    append(" - ")
                    append(String.format(Locale.US, "%.2f", item.totalPrice))
                }
            }
        }
    }

    private fun buildVoicePendingText(draft: CompanionVoiceDraft?): String {
        val pending = draft?.pendingItems.orEmpty()
        if (pending.isEmpty()) return getString(R.string.voice_pending_placeholder)

        return pending.joinToString("\n") { item ->
            val reasonLabel = when (item.reason.lowercase()) {
                "portion-selection" -> getString(R.string.voice_pending_reason_portion)
                "family-confirmation" -> getString(R.string.voice_pending_reason_family)
                else -> item.reason.replace('-', ' ').replaceFirstChar {
                    if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString()
                }
            }
            "${item.quantity} x ${item.spokenText} - $reasonLabel"
        }
    }

    private fun buildVoiceSummaryText(draft: CompanionVoiceDraft?): String {
        val summaryMessage = draft?.note
            ?.ifBlank { draft.lastAction }
            ?.ifBlank { lastVoiceUiMessage }
            ?.ifBlank { getString(R.string.voice_summary_placeholder) }
            ?: getString(R.string.voice_summary_placeholder)

        val transcript = draft?.lastTranscript
            ?.ifBlank { lastVoiceUiTranscript }
            ?.ifBlank { "" }
            ?: ""

        return buildString {
            append(summaryMessage)
            if (transcript.isNotBlank()) {
                append("\n\n")
                append("Heard: ")
                append(transcript)
            }
        }
    }

    private fun showShortToast(message: String) {
        if (message.isBlank()) return
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
