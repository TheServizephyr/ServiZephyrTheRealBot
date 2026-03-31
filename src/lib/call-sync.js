const CALL_SYNC_ROOT = 'call_sync';
const CALL_SYNC_EVENT_TTL_MS = 30 * 1000;
const RTDB_INVALID_KEY_CHARS = /[.#$/\[\]\u0000-\u001F\u007F]/g;

export const toSafeRtdbPathKey = (value) =>
    String(value || '')
        .trim()
        .replace(RTDB_INVALID_KEY_CHARS, (ch) => `_${ch.charCodeAt(0).toString(16).toUpperCase()}_`);

export const normalizeIndianPhoneLoose = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(-10);
    return digits.slice(-10);
};

export const isCallSyncEventFresh = (timestampMs, ttlMs = CALL_SYNC_EVENT_TTL_MS) => {
    const ts = Number(timestampMs || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (Date.now() - ts) <= ttlMs;
};

export const buildActiveCallSyncPath = ({ collectionName, businessId }) =>
    `${CALL_SYNC_ROOT}/${toSafeRtdbPathKey(collectionName)}/${toSafeRtdbPathKey(businessId)}/active`;

export { CALL_SYNC_ROOT, CALL_SYNC_EVENT_TTL_MS };
