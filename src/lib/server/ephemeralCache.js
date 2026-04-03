const CACHE_STATE = globalThis.__servizephyrEphemeralCacheState || {
  values: new Map(),
  inFlight: new Map(),
};

globalThis.__servizephyrEphemeralCacheState = CACHE_STATE;

function now() {
  return Date.now();
}

export function getEphemeralCache(key) {
  const entry = CACHE_STATE.values.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    CACHE_STATE.values.delete(key);
    return null;
  }
  return entry.value;
}

export function setEphemeralCache(key, value, ttlMs) {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return value;
  CACHE_STATE.values.set(key, {
    value,
    expiresAt: now() + ttl,
  });
  return value;
}

export function invalidateEphemeralCacheByPrefix(prefix) {
  for (const key of CACHE_STATE.values.keys()) {
    if (String(key).startsWith(prefix)) CACHE_STATE.values.delete(key);
  }
  for (const key of CACHE_STATE.inFlight.keys()) {
    if (String(key).startsWith(prefix)) CACHE_STATE.inFlight.delete(key);
  }
}

export async function getOrSetEphemeralCache(key, ttlMs, compute) {
  const cached = getEphemeralCache(key);
  if (cached !== null) return cached;

  if (CACHE_STATE.inFlight.has(key)) {
    return CACHE_STATE.inFlight.get(key);
  }

  const promise = (async () => {
    try {
      const value = await compute();
      setEphemeralCache(key, value, ttlMs);
      return value;
    } finally {
      CACHE_STATE.inFlight.delete(key);
    }
  })();

  CACHE_STATE.inFlight.set(key, promise);
  return promise;
}
