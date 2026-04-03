const CACHE_STORAGE_PREFIX = 'servizephyr:runtime-cache:';

function getMemoryStore() {
    if (!globalThis.__servizephyrRuntimeCacheStore) {
        globalThis.__servizephyrRuntimeCacheStore = new Map();
    }
    return globalThis.__servizephyrRuntimeCacheStore;
}

function getInFlightStore() {
    if (!globalThis.__servizephyrRuntimeCacheInFlight) {
        globalThis.__servizephyrRuntimeCacheInFlight = new Map();
    }
    return globalThis.__servizephyrRuntimeCacheInFlight;
}

function getStorage(storageMode = 'session') {
    if (typeof window === 'undefined') return null;
    if (storageMode === 'local') return window.localStorage;
    if (storageMode === 'session') return window.sessionStorage;
    return null;
}

function buildStorageKey(cacheKey) {
    return `${CACHE_STORAGE_PREFIX}${cacheKey}`;
}

function makeRecord(value, ttlMs) {
    const safeTtlMs = Math.max(1000, Number(ttlMs) || 0);
    return {
        value,
        expiresAt: Date.now() + safeTtlMs,
    };
}

function isValidRecord(record) {
    return !!record && Number.isFinite(record.expiresAt) && record.expiresAt > Date.now();
}

function readStoredRecord(cacheKey, storageMode) {
    const storage = getStorage(storageMode);
    if (!storage) return null;

    try {
        const raw = storage.getItem(buildStorageKey(cacheKey));
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!isValidRecord(parsed)) {
            storage.removeItem(buildStorageKey(cacheKey));
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function writeStoredRecord(cacheKey, record, storageMode) {
    const storage = getStorage(storageMode);
    if (!storage) return;

    try {
        storage.setItem(buildStorageKey(cacheKey), JSON.stringify(record));
    } catch {
        // Ignore storage quota / availability errors; memory cache still helps.
    }
}

function deleteStoredRecord(cacheKey, storageMode) {
    const storage = getStorage(storageMode);
    if (!storage) return;

    try {
        storage.removeItem(buildStorageKey(cacheKey));
    } catch {
        // Ignore storage errors.
    }
}

export async function getCachedClientResource(cacheKey, loader, options = {}) {
    const {
        ttlMs = 30000,
        storage = 'session',
    } = options;

    if (!cacheKey || typeof loader !== 'function') {
        return loader();
    }

    const memoryStore = getMemoryStore();
    const inFlightStore = getInFlightStore();

    const memoryRecord = memoryStore.get(cacheKey);
    if (isValidRecord(memoryRecord)) {
        return memoryRecord.value;
    }

    const cachedRecord = readStoredRecord(cacheKey, storage);
    if (isValidRecord(cachedRecord)) {
        memoryStore.set(cacheKey, cachedRecord);
        return cachedRecord.value;
    }

    if (inFlightStore.has(cacheKey)) {
        return inFlightStore.get(cacheKey);
    }

    const requestPromise = (async () => {
        const value = await loader();
        const record = makeRecord(value, ttlMs);
        memoryStore.set(cacheKey, record);
        if (storage !== 'memory') {
            writeStoredRecord(cacheKey, record, storage);
        }
        return value;
    })().finally(() => {
        inFlightStore.delete(cacheKey);
    });

    inFlightStore.set(cacheKey, requestPromise);
    return requestPromise;
}

export function primeCachedClientResource(cacheKey, value, options = {}) {
    const {
        ttlMs = 30000,
        storage = 'session',
    } = options;

    if (!cacheKey) return value;

    const record = makeRecord(value, ttlMs);
    getMemoryStore().set(cacheKey, record);
    if (storage !== 'memory') {
        writeStoredRecord(cacheKey, record, storage);
    }
    return value;
}

export function invalidateCachedClientResource(cacheKey, options = {}) {
    const {
        storage = 'session',
        prefixMatch = false,
    } = options;

    const memoryStore = getMemoryStore();
    const inFlightStore = getInFlightStore();

    if (prefixMatch) {
        for (const key of Array.from(memoryStore.keys())) {
            if (String(key).startsWith(cacheKey)) {
                memoryStore.delete(key);
            }
        }
        for (const key of Array.from(inFlightStore.keys())) {
            if (String(key).startsWith(cacheKey)) {
                inFlightStore.delete(key);
            }
        }

        const storageInstance = getStorage(storage);
        if (storageInstance) {
            const prefix = buildStorageKey(cacheKey);
            const keysToDelete = [];
            for (let index = 0; index < storageInstance.length; index += 1) {
                const storageKey = storageInstance.key(index);
                if (storageKey && storageKey.startsWith(prefix)) {
                    keysToDelete.push(storageKey);
                }
            }
            for (const storageKey of keysToDelete) {
                try {
                    storageInstance.removeItem(storageKey);
                } catch {
                    // Ignore storage errors.
                }
            }
        }
        return;
    }

    memoryStore.delete(cacheKey);
    inFlightStore.delete(cacheKey);
    if (storage !== 'memory') {
        deleteStoredRecord(cacheKey, storage);
    }
}

export function toCacheKeyPart(value, maxLength = 48) {
    const normalized = String(value || '').trim();
    if (!normalized) return 'na';
    return encodeURIComponent(normalized.slice(-maxLength));
}
