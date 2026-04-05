export const TRACKING_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
export const WHATSAPP_SESSION_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const DINE_IN_SESSION_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SECURITY_EVENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const SECURITY_ANOMALY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function ttlDateFromNow(ttlMs) {
    return new Date(Date.now() + Math.max(1000, Number(ttlMs) || 0));
}

export function ttlDateFromSource(sourceDate, fallbackTtlMs) {
    const base =
        sourceDate instanceof Date
            ? sourceDate
            : new Date(sourceDate || Date.now());
    const baseMs = Number.isNaN(base.getTime()) ? Date.now() : base.getTime();
    return new Date(baseMs + Math.max(1000, Number(fallbackTtlMs) || 0));
}
