'use client';

export const APP_NOTIFICATION_EVENT = 'servizephyr:notify';
export const APP_NOTIFICATION_SYNC_EVENT = 'servizephyr:notify-sync';
export const APP_NOTIFICATION_ALARM_STORAGE_KEY = 'servizephyr:notification-alarm-state';
export const APP_NOTIFICATION_PREFS_STORAGE_KEY = 'servizephyr:notification-prefs';
export const APP_NOTIFICATION_BROADCAST_KEY = 'servizephyr:notification-broadcast';

function canUseStorage() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJson(key, fallback) {
    if (!canUseStorage()) return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    if (!canUseStorage()) return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore storage failures
    }
}

function dispatchSync(detail) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(APP_NOTIFICATION_SYNC_EVENT, { detail }));
}

function broadcast(detail) {
    dispatchSync(detail);
    if (!canUseStorage()) return;
    try {
        window.localStorage.setItem(APP_NOTIFICATION_BROADCAST_KEY, JSON.stringify({
            ...detail,
            ts: Date.now(),
        }));
    } catch {
        // Ignore storage failures
    }
}

export function readAppNotificationAlarmState(scope = 'owner') {
    const state = readJson(APP_NOTIFICATION_ALARM_STORAGE_KEY, {});
    return state?.[scope] || null;
}

export function setAppNotificationAlarmState(scope = 'owner', alarmState = null) {
    const state = readJson(APP_NOTIFICATION_ALARM_STORAGE_KEY, {});
    const nextState = {
        ...state,
        [scope]: alarmState ? { ...alarmState, scope, updatedAt: Date.now() } : null,
    };
    writeJson(APP_NOTIFICATION_ALARM_STORAGE_KEY, nextState);
    broadcast({ type: 'alarm_state', scope, alarmState: nextState[scope] });
}

export function clearAppNotificationAlarmState(scope = 'owner', alarmId = null) {
    const current = readAppNotificationAlarmState(scope);
    if (alarmId && current?.alarmId && current.alarmId !== alarmId) return;
    setAppNotificationAlarmState(scope, null);
}

export function readAppNotificationPrefs(scope = 'owner') {
    const prefs = readJson(APP_NOTIFICATION_PREFS_STORAGE_KEY, {});
    return {
        soundEnabled: prefs?.[scope]?.soundEnabled !== false,
    };
}

export function setAppNotificationPrefs(scope = 'owner', nextPrefs = {}) {
    const prefs = readJson(APP_NOTIFICATION_PREFS_STORAGE_KEY, {});
    const merged = {
        ...prefs,
        [scope]: {
            ...prefs?.[scope],
            ...nextPrefs,
            updatedAt: Date.now(),
        },
    };
    writeJson(APP_NOTIFICATION_PREFS_STORAGE_KEY, merged);
    broadcast({ type: 'prefs', scope, prefs: merged[scope] });
}

export function emitAppNotification(payload) {
    if (typeof window === 'undefined') return;
    const scope = payload?.scope || 'owner';

    if (payload?.action === 'stop_alarm') {
        clearAppNotificationAlarmState(scope, payload?.alarmId || null);
    } else if (payload?.disableAutoStop === true && payload?.alarmId) {
        setAppNotificationAlarmState(scope, {
            alarmId: payload.alarmId,
            title: payload.title || 'New Notification',
            message: payload.message || '',
            sound: payload.sound || '',
            href: payload.href || '',
            disableAutoStop: true,
        });
    }

    window.dispatchEvent(new CustomEvent(APP_NOTIFICATION_EVENT, { detail: payload }));
    broadcast({ type: 'notification', scope, payload });
}
