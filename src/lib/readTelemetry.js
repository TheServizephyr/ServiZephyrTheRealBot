import { kv } from '@vercel/kv';

const TELEMETRY_ENABLED = process.env.ENABLE_READ_TELEMETRY === 'true';
const TELEMETRY_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

function getDayKeySuffix(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

/**
 * Best-effort endpoint telemetry for estimated Firestore read pressure.
 * Disabled by default; enable with ENABLE_READ_TELEMETRY=true.
 */
export async function trackEndpointRead(endpointName, estimatedReads = 0) {
    if (!TELEMETRY_ENABLED) return;
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
    if (!endpointName) return;

    const reads = Number.isFinite(Number(estimatedReads)) ? Math.max(0, Math.floor(Number(estimatedReads))) : 0;
    const dayKey = `telemetry:reads:${getDayKeySuffix()}`;
    const reqKey = `telemetry:requests:${getDayKeySuffix()}`;

    try {
        await Promise.all([
            kv.hincrby(dayKey, endpointName, reads),
            kv.hincrby(reqKey, endpointName, 1),
            kv.expire(dayKey, TELEMETRY_TTL_SECONDS),
            kv.expire(reqKey, TELEMETRY_TTL_SECONDS),
        ]);
    } catch {
        // Never fail request path because of telemetry.
    }
}

