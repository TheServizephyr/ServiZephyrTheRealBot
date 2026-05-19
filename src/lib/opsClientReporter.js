'use client';

const DEDUPE_WINDOW_MS = 30 * 1000;
const RECENT_REPORTS_KEY = '__servizephyrRecentClientIncidentReports';
const CHUNK_RELOAD_KEY = '__servizephyrChunkReloadAt';
const STORAGE_RELOAD_KEY = '__servizephyrStorageReloadAt';
const CHUNK_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
const STORAGE_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
const SENSITIVE_QUERY_KEYS = [
    /token/i,
    /^ref$/i,
    /auth/i,
    /code/i,
    /secret/i,
    /session/i,
    /api[_-]?key/i,
    /password/i,
];

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

function isSensitiveQueryKey(key) {
    return SENSITIVE_QUERY_KEYS.some((pattern) => pattern.test(String(key || '')));
}

export function sanitizeUrlForOps(value) {
    const raw = String(value || '');
    if (!raw) return '';

    try {
        const base = typeof window !== 'undefined' ? window.location?.origin : 'https://servizephyr.com';
        const url = new URL(raw, base);
        for (const key of Array.from(url.searchParams.keys())) {
            if (isSensitiveQueryKey(key)) {
                url.searchParams.set(key, '[redacted]');
            }
        }

        if (!/^https?:\/\//i.test(raw)) {
            return `${url.pathname}${url.search}${url.hash}`;
        }

        return url.toString();
    } catch {
        return raw.replace(/([?&][^=]*(token|ref|auth|code|secret|session|api[_-]?key|password)[^=]*=)[^&#]*/gi, '$1[redacted]');
    }
}

function isLocalhostUrl() {
    try {
        const hostname = window.location?.hostname || '';
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
    } catch {
        return false;
    }
}

function shouldReportFromCurrentLocation() {
    if (typeof window === 'undefined') return false;
    if (!isLocalhostUrl()) return true;
    return process.env.NEXT_PUBLIC_OPS_REPORT_LOCAL === 'true';
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

export function isBrowserEventNoise(errorLike) {
    if (!errorLike || typeof errorLike !== 'object' || errorLike instanceof Error) return false;
    const serialized = serializeClientError(errorLike);
    const message = String(serialized.message || '').trim();
    const hasActionableText =
        message &&
        message !== '{}' &&
        message !== '{"isTrusted":true}' &&
        message !== 'Unknown client error';

    if (hasActionableText) return false;

    const keys = Object.keys(errorLike);
    return keys.length === 0 || keys.every((key) => [
        'isTrusted',
        'type',
        'target',
        'currentTarget',
        'eventPhase',
        'bubbles',
        'cancelable',
        'defaultPrevented',
        'composed',
        'timeStamp',
        'returnValue',
    ].includes(key));
}

export function isTransientBrowserStorageNoise(errorLike) {
    const serialized = serializeClientError(errorLike);
    const message = String(serialized.message || '').toLowerCase();
    return (
        message.includes('connection to indexed database server lost') ||
        message.includes('indexeddb') && message.includes('refresh the page')
    );
}

export function recoverFromTransientBrowserStorageError(errorLike) {
    if (typeof window === 'undefined' || !isTransientBrowserStorageNoise(errorLike)) return false;

    try {
        const now = Date.now();
        const lastReloadAt = Number(sessionStorage.getItem(STORAGE_RELOAD_KEY) || 0);
        if (lastReloadAt && now - lastReloadAt < STORAGE_RELOAD_COOLDOWN_MS) return false;
        sessionStorage.setItem(STORAGE_RELOAD_KEY, String(now));

        window.setTimeout(() => {
            window.location.reload();
        }, 500);

        return true;
    } catch {
        return false;
    }
}

export function isChunkLoadError(errorLike) {
    const serialized = serializeClientError(errorLike);
    const text = `${serialized.name || ''} ${serialized.message || ''} ${serialized.stack || ''}`;
    return /ChunkLoadError/i.test(text) ||
        /Loading chunk [\w-]+ failed/i.test(text) ||
        /Failed to fetch dynamically imported module/i.test(text) ||
        /Importing a module script failed/i.test(text);
}

export function recoverFromChunkLoadError(errorLike) {
    if (typeof window === 'undefined' || !isChunkLoadError(errorLike)) return false;

    try {
        const now = Date.now();
        const lastReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
        if (lastReloadAt && now - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) return false;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));

        window.setTimeout(async () => {
            try {
                if (window.caches?.keys) {
                    const keys = await window.caches.keys();
                    await Promise.all(keys.map((key) => window.caches.delete(key)));
                }
                if (navigator.serviceWorker?.getRegistrations) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(registrations.map((registration) => registration.unregister()));
                }
            } catch {
                // A normal reload still fixes most stale chunk states.
            }
            window.location.reload();
        }, 250);

        return true;
    } catch {
        return false;
    }
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
    if (!shouldReportFromCurrentLocation()) return;

    const normalizedPayload = {
        source: payload.source || 'client',
        area: payload.area || 'browser',
        severity: payload.severity || 'error',
        title: payload.title || 'Client error',
        message: payload.message || payload.error?.message || 'Client error',
        path: sanitizeUrlForOps(payload.path || window.location?.pathname || ''),
        url: sanitizeUrlForOps(payload.url || window.location?.href || ''),
        referrer: sanitizeUrlForOps(payload.referrer || document?.referrer || ''),
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
