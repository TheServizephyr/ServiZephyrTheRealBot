import { getIndiaDateKey } from '../historyDates.mjs';

const PREFIX = 'servizephyr:service-history:v1:';
const pending = new Map();
const revisions = new Map();
const MAX_ENTRIES = 40;

function browserStorage() {
    try { return globalThis.localStorage || null; } catch { return null; }
}

function scopePrefix(scope) { return `${PREFIX}${encodeURIComponent(scope)}:`; }

export function serviceHistoryScope(uid, businessId, ownerId = '') {
    if (!uid || (!businessId && !ownerId)) throw new Error('Sign in and select an outlet to view history.');
    return JSON.stringify([uid, businessId || `owner:${ownerId}`]);
}

export function invalidateServiceHistory(scope, storage = browserStorage(), dates = null) {
    const prefix = scopePrefix(scope);
    const matches = key => {
        if (!key?.startsWith(prefix)) return false;
        if (!dates) return true;
        const [start, end] = key.split(':').slice(-2);
        return dates.some(date => start <= date && date <= end);
    };
    const keys = new Set([...pending.keys()].filter(matches));
    try {
        for (let i = storage.length - 1; i >= 0; i--) {
            const key = storage.key(i);
            if (matches(key)) { keys.add(key); storage.removeItem(key); }
        }
    } catch { /* Storage can be disabled; live actions must still succeed. */ }
    for (const key of keys) {
        revisions.set(key, (revisions.get(key) || 0) + 1);
        pending.delete(key);
    }
}

export async function loadServiceHistory({ scope, channel, startDate, endDate, fetcher, force = false, storage = browserStorage(), now = Date.now() }) {
    if (!scope || !['bookings', 'waitlist'].includes(channel) || !startDate || !endDate) throw new Error('History scope and date range are required.');
    const prefix = scopePrefix(scope);
    const key = `${prefix}${channel}:${startDate}:${endDate}`;
    const today = getIndiaDateKey(new Date(now));
    const ttl = startDate <= today && today <= endDate ? 5 * 60000 : 24 * 60 * 60000;
    if (!force) {
        try {
            const cached = JSON.parse(storage.getItem(key));
            if (cached?.expiresAt > now && cached.savedAt <= now && cached.savedAt + ttl > now && cached.payload && Array.isArray(cached.payload[channel === 'bookings' ? 'bookings' : 'entries'])) {
                return { ...cached, cacheHit: true };
            }
        } catch { /* Miss, disabled storage or a corrupted/old entry. */ }
    }
    // Scope also isolates in-flight requests; React remounts/tab changes reuse them.
    if (pending.has(key)) return pending.get(key);
    const revision = revisions.get(key) || 0;
    const request = (async () => {
        const payload = await fetcher();
        if (!Array.isArray(payload?.[channel === 'bookings' ? 'bookings' : 'entries'])) throw new Error('Invalid history response.');
        const entry = { savedAt: now, expiresAt: now + ttl, payload };
        try {
            if ((revisions.get(key) || 0) === revision) {
                const entries = [];
                for (let i = 0; i < storage.length; i++) {
                    const oldKey = storage.key(i);
                    if (!oldKey?.startsWith(PREFIX)) continue;
                    let savedAt = 0;
                    try { savedAt = JSON.parse(storage.getItem(oldKey))?.savedAt || 0; } catch {}
                    entries.push({ key: oldKey, savedAt });
                }
                entries.sort((a, b) => a.savedAt - b.savedAt);
                while (entries.length >= MAX_ENTRIES) storage.removeItem(entries.shift().key);
                const serialized = JSON.stringify(entry);
                for (;;) {
                    try { storage.setItem(key, serialized); break; } catch (error) {
                        const oldest = entries.shift();
                        if (!oldest) throw error;
                        storage.removeItem(oldest.key);
                    }
                }
            }
        } catch { /* Cache quota failures must not hide fetched history. */ }
        return { ...entry, cacheHit: false };
    })();
    pending.set(key, request);
    try { return await request; } finally { if (pending.get(key) === request) pending.delete(key); }
}
