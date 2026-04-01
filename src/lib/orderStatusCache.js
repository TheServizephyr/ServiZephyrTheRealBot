function normalizeCacheId(value) {
    return String(value || '').trim();
}

export function buildOrderStatusCacheKey(value) {
    const safeValue = normalizeCacheId(value);
    return safeValue ? `order_status:${safeValue}` : null;
}

export function buildOrderStatusCacheVariantKey({
    liteMode = false,
    cacheVisibility = 'private',
    addressVisibility = 'address',
} = {}) {
    return `${liteMode ? 'lite' : 'full'}:${cacheVisibility}:${addressVisibility}`;
}

export function readOrderStatusCachedVariant(cacheRecord, variantKey) {
    if (!cacheRecord || typeof cacheRecord !== 'object' || !variantKey) return null;

    const variants = cacheRecord.variants;
    if (!variants || typeof variants !== 'object') return null;

    return variants[variantKey] || null;
}

export function mergeOrderStatusCachedVariant(cacheRecord, variantKey, payload) {
    const existingVariants =
        cacheRecord && typeof cacheRecord === 'object' && cacheRecord.variants && typeof cacheRecord.variants === 'object'
            ? cacheRecord.variants
            : {};

    return {
        variants: {
            ...existingVariants,
            [variantKey]: payload,
        },
    };
}

export function buildOrderStatusInvalidationKeys({
    orderId,
    dineInTabId = null,
    tabId = null,
} = {}) {
    const uniqueKeys = new Set();

    [orderId, dineInTabId, tabId].forEach((value) => {
        const cacheKey = buildOrderStatusCacheKey(value);
        if (cacheKey) {
            uniqueKeys.add(cacheKey);
        }
    });

    return Array.from(uniqueKeys);
}

export async function clearOrderStatusCache(kvClient, identifiers = {}) {
    const keys = buildOrderStatusInvalidationKeys(identifiers);
    if (!kvClient || typeof kvClient.del !== 'function' || keys.length === 0) {
        return [];
    }

    if (keys.length === 1) {
        await kvClient.del(keys[0]);
        return keys;
    }

    await kvClient.del(...keys);
    return keys;
}
