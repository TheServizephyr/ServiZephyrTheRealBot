'use client';

const DEDUPE_WINDOW_MS = 30 * 1000;
const RECENT_REPORTS_KEY = '__servizephyrRecentClientIncidentReports';

function getRecentReports() {
    if (!globalThis[RECENT_REPORTS_KEY]) {
        globalThis[RECENT_REPORTS_KEY] = new Map();
    }
    return globalThis[RECENT_REPORTS_KEY];
}

function safeString(value, fallback = '') {
    try {
        if (value instanceof Error) return value.message || value.name || fallback;
        if (typeof value === 'string') return value;
        if (value === null || value === undefined) return fallback;
        return JSON.stringify(value).slice(0, 2000);
    } catch {
        return fallback;
    }
}

export function serializeClientError(errorLike) {
    if (errorLike instanceof Error) {
        return {
            name: errorLike.name || 'Error',
            message: errorLike.message || String(errorLike),
            stack: errorLike.stack || '',
        };
    }

    if (typeof errorLike === 'string') {
        return { name: 'Error', message: errorLike, stack: '' };
    }

    return {
        name: safeString(errorLike?.name || errorLike?.type || 'Error', 'Error'),
        message: safeString(errorLike?.message || errorLike?.reason || errorLike, 'Unknown client error'),
        stack: safeString(errorLike?.stack, ''),
    };
}

function buildClientFingerprint(payload) {
    const error = payload?.error || {};
    return [
        payload?.source || 'client',
        payload?.area || 'client',
        payload?.path || '',
        error.name || '',
        error.message || '',
        String(error.stack || '').split('\n')[1] || '',
    ].join('|');
}

function shouldSend(payload) {
    const fingerprint = buildClientFingerprint(payload);
    const now = Date.now();
    const reports = getRecentReports();

    for (const [key, timestamp] of reports.entries()) {
        if (now - timestamp > DEDUPE_WINDOW_MS) {
            reports.delete(key);
        }
    }

    const lastSentAt = reports.get(fingerprint);
    if (lastSentAt && now - lastSentAt < DEDUPE_WINDOW_MS) return false;

    reports.set(fingerprint, now);
    return true;
}

export function reportClientIncident(payload = {}) {
    if (typeof window === 'undefined') return;

    const normalizedPayload = {
        source: payload.source || 'client',
        area: payload.area || 'browser',
        severity: payload.severity || 'error',
        title: payload.title || 'Client error',
        message: payload.message || payload.error?.message || 'Client error',
        path: payload.path || window.location?.pathname || '',
        url: window.location?.href || '',
        referrer: document?.referrer || '',
        error: serializeClientError(payload.error || payload.message),
        user: payload.user || null,
        browser: payload.browser || {
            userAgent: navigator?.userAgent || '',
            platform: navigator?.platform || '',
            language: navigator?.language || '',
            online: navigator?.onLine ?? null,
        },
        screen: payload.screen || {
            width: window.screen?.width || 0,
            height: window.screen?.height || 0,
            colorDepth: window.screen?.colorDepth || 0,
        },
        context: payload.context || {},
        at: Date.now(),
    };

    if (!shouldSend(normalizedPayload)) return;

    const body = JSON.stringify(normalizedPayload);

    try {
        if (navigator?.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon('/api/ops/incident', blob);
            return;
        }
    } catch {
        // Fallback to fetch below.
    }

    fetch('/api/ops/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
    }).catch(() => {});
}
