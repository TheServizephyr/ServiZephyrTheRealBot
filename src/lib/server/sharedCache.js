import { kv, isKvConfigured } from '@/lib/kv';

const SHARED_CACHE_STATE = globalThis.__servizephyrSharedCacheState || {
  values: new Map(),
  inFlight: new Map(),
};

globalThis.__servizephyrSharedCacheState = SHARED_CACHE_STATE;

function now() {
  return Date.now();
}

function readL1(cacheKey) {
  const entry = SHARED_CACHE_STATE.values.get(cacheKey);
  if (!entry) return null;
  if (!entry.expiresAt || entry.expiresAt <= now()) {
    SHARED_CACHE_STATE.values.delete(cacheKey);
    return null;
  }
  return entry.value ?? null;
}

function writeL1(cacheKey, value, ttlMs) {
  const ttl = Math.max(1000, Number(ttlMs) || 0);
  if (!ttl || !cacheKey) return value;
  SHARED_CACHE_STATE.values.set(cacheKey, {
    value,
    expiresAt: now() + ttl,
  });
  return value;
}

export function invalidateSharedCache(cacheKey, { prefixMatch = false } = {}) {
  const safeKey = String(cacheKey || '').trim();
  if (!safeKey) return;

  if (prefixMatch) {
    for (const key of Array.from(SHARED_CACHE_STATE.values.keys())) {
      if (String(key).startsWith(safeKey)) SHARED_CACHE_STATE.values.delete(key);
    }
    for (const key of Array.from(SHARED_CACHE_STATE.inFlight.keys())) {
      if (String(key).startsWith(safeKey)) SHARED_CACHE_STATE.inFlight.delete(key);
    }
    return;
  }

  SHARED_CACHE_STATE.values.delete(safeKey);
  SHARED_CACHE_STATE.inFlight.delete(safeKey);
}

export async function deleteSharedCache(cacheKey) {
  invalidateSharedCache(cacheKey);
  if (!isKvConfigured()) return;
  try {
    await kv.del(cacheKey);
  } catch (error) {
    console.warn('[shared-cache] KV delete failed:', error?.message || error);
  }
}

export async function getOrSetSharedCache(cacheKey, {
  ttlMs = 30000,
  kvTtlSec = null,
  parse = (value) => value,
  serialize = (value) => value,
  compute,
} = {}) {
  if (!cacheKey || typeof compute !== 'function') {
    return compute();
  }

  const l1 = readL1(cacheKey);
  if (l1 !== null) return l1;

  if (SHARED_CACHE_STATE.inFlight.has(cacheKey)) {
    return SHARED_CACHE_STATE.inFlight.get(cacheKey);
  }

  const promise = (async () => {
    try {
      if (isKvConfigured()) {
        try {
          const kvValue = await kv.get(cacheKey);
          if (kvValue !== null && kvValue !== undefined) {
            const parsed = parse(kvValue);
            writeL1(cacheKey, parsed, ttlMs);
            return parsed;
          }
        } catch (error) {
          console.warn('[shared-cache] KV read failed:', error?.message || error);
        }
      }

      const computed = await compute();
      writeL1(cacheKey, computed, ttlMs);

      if (isKvConfigured()) {
        try {
          const ex = Number.isFinite(Number(kvTtlSec))
            ? Math.max(1, Math.floor(Number(kvTtlSec)))
            : Math.max(1, Math.ceil(Number(ttlMs || 0) / 1000));
          await kv.set(cacheKey, serialize(computed), { ex });
        } catch (error) {
          console.warn('[shared-cache] KV write failed:', error?.message || error);
        }
      }

      return computed;
    } finally {
      SHARED_CACHE_STATE.inFlight.delete(cacheKey);
    }
  })();

  SHARED_CACHE_STATE.inFlight.set(cacheKey, promise);
  return promise;
}
