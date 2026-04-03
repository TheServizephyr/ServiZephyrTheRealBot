import { kv, isKvConfigured } from '@/lib/kv';

const RATE_LIMIT_MEMORY_BUCKETS = globalThis.__servizephyrSharedRateLimiterBuckets || new Map();
globalThis.__servizephyrSharedRateLimiterBuckets = RATE_LIMIT_MEMORY_BUCKETS;

function buildMinuteKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
}

function consumeMemoryRateLimit(scope, key, limitPerMinute) {
    const safeLimit = Math.max(1, Number(limitPerMinute) || 1);
    const minuteKey = buildMinuteKey();
    const bucketKey = `${scope}:${String(key || '').trim()}:${minuteKey}`;
    const now = Date.now();

    for (const [existingKey, entry] of RATE_LIMIT_MEMORY_BUCKETS.entries()) {
        if (!entry?.expiresAt || entry.expiresAt <= now) {
            RATE_LIMIT_MEMORY_BUCKETS.delete(existingKey);
        }
    }

    const existing = RATE_LIMIT_MEMORY_BUCKETS.get(bucketKey) || {
        count: 0,
        expiresAt: now + 65 * 1000,
    };

    if (existing.count >= safeLimit) {
        return { allowed: false, source: 'memory' };
    }

    existing.count += 1;
    existing.expiresAt = now + 65 * 1000;
    RATE_LIMIT_MEMORY_BUCKETS.set(bucketKey, existing);
    return { allowed: true, source: 'memory' };
}

async function consumeKvRateLimit(scope, key, limitPerMinute) {
    if (!isKvConfigured()) return null;

    const safeLimit = Math.max(1, Number(limitPerMinute) || 1);
    const minuteKey = buildMinuteKey();
    const bucketKey = `${scope}:${String(key || '').trim()}:${minuteKey}`;
    const count = Number(await kv.incr(bucketKey)) || 0;
    if (count === 1) {
        await kv.expire(bucketKey, 65);
    }

    return {
        allowed: count <= safeLimit,
        source: 'kv',
    };
}

async function consumeRateLimit(scope, key, limitPerMinute) {
    const safeKey = String(key || '').trim();
    if (!safeKey) return { allowed: false, source: 'invalid' };

    try {
        const kvResult = await consumeKvRateLimit(scope, safeKey, limitPerMinute);
        if (kvResult) return kvResult;
    } catch (error) {
        console.warn(`[Rate Limit] ${scope} degraded to memory fallback:`, error?.message || error);
    }

    return consumeMemoryRateLimit(scope, safeKey, limitPerMinute);
}

/**
 * Check if restaurant has exceeded rate limit.
 * Uses KV when available and degrades to local memory as a last resort.
 */
export async function checkRateLimit(restaurantId, limitPerMinute = 50) {
    return consumeRateLimit('restaurant_rate_limits', restaurantId, limitPerMinute);
}

/**
 * Check if IP has exceeded rate limit.
 * Uses KV when available and degrades to local memory as a last resort.
 */
export async function checkIpRateLimit(ip, limitPerMinute = 20) {
    const normalizedIp = String(ip || '').replace(/[:.]/g, '_').trim();
    return consumeRateLimit('ip_rate_limits', normalizedIp, limitPerMinute);
}
