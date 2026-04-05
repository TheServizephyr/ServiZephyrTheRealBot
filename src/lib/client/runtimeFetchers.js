import {
    getCachedClientResource,
    invalidateCachedClientResource,
    primeCachedClientResource,
    toCacheKeyPart,
} from '@/lib/client/runtimeCache';

const CUSTOMER_LOOKUP_CACHE_PREFIX = 'customer_lookup:v1:';
const RESTAURANT_BOOTSTRAP_CACHE_PREFIX = 'restaurant_bootstrap:v1:';
const ORDER_STATUS_CACHE_PREFIX = 'order_status:v1:';
const ACTIVE_ORDER_CACHE_PREFIX = 'order_active:v1:';
const CUSTOMER_ADDRESSES_SNAPSHOT_KEY = 'servizephyr:customer-addresses-snapshot:v1';

const CUSTOMER_LOOKUP_TTL_MS = 60 * 1000;
const RESTAURANT_BOOTSTRAP_TTL_MS = 60 * 1000;
const ORDER_STATUS_TTL_MS = 8 * 1000;
const ACTIVE_ORDER_TTL_MS = 15 * 1000;
const USE_PUBLIC_BOOTSTRAP = process.env.NEXT_PUBLIC_USE_PUBLIC_BOOTSTRAP === 'true';

const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);
const getTokenSignature = (value) => String(value || '').slice(-24);

async function fetchJsonOrThrow(url, init = {}) {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(payload?.message || `Request failed with status ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function buildLookupHeaders(user) {
    const headers = { 'Content-Type': 'application/json' };
    if (user?.getIdToken) {
        try {
            const idToken = await user.getIdToken();
            if (idToken) {
                headers.Authorization = `Bearer ${idToken}`;
            }
        } catch (error) {
            console.warn('[Client Lookup Cache] Failed to get ID token:', error?.message || error);
        }
    }
    return headers;
}

function buildCustomerLookupCacheKey({ phone = '', ref = '', guestId = '', user = null }) {
    const normalizedPhone = normalizePhone(phone);
    return [
        CUSTOMER_LOOKUP_CACHE_PREFIX,
        toCacheKeyPart(user?.uid || 'anon'),
        toCacheKeyPart(ref),
        toCacheKeyPart(guestId),
        toCacheKeyPart(normalizedPhone),
    ].join('');
}

export async function fetchCachedCustomerLookup({
    phone = '',
    ref = '',
    guestId = '',
    user = null,
    ttlMs = CUSTOMER_LOOKUP_TTL_MS,
    force = false,
} = {}) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone && !ref && !guestId && !user) {
        return null;
    }

    const cacheKey = buildCustomerLookupCacheKey({ phone: normalizedPhone, ref, guestId, user });
    if (force) {
        invalidateCachedClientResource(cacheKey, { storage: 'session' });
    }

    return getCachedClientResource(cacheKey, async () => {
        const headers = await buildLookupHeaders(user);
        const payload = {};
        if (normalizedPhone) payload.phone = normalizedPhone;
        if (ref) payload.ref = ref;
        if (guestId) payload.guestId = guestId;

        return fetchJsonOrThrow('/api/customer/lookup', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
    }, {
        ttlMs,
        storage: 'session',
    });
}

export function primeCustomerLookupCache(params, data, ttlMs = CUSTOMER_LOOKUP_TTL_MS) {
    const cacheKey = buildCustomerLookupCacheKey(params || {});
    return primeCachedClientResource(cacheKey, data, {
        ttlMs,
        storage: 'session',
    });
}

export function invalidateCustomerLookupCache() {
    invalidateCachedClientResource(CUSTOMER_LOOKUP_CACHE_PREFIX, {
        prefixMatch: true,
        storage: 'session',
    });
}

function getBrowserStorage() {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
}

export function readCustomerAddressesSnapshot() {
    const storage = getBrowserStorage();
    if (!storage) return [];

    try {
        const raw = storage.getItem(CUSTOMER_ADDRESSES_SNAPSHOT_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function writeCustomerAddressesSnapshot(addresses = []) {
    const storage = getBrowserStorage();
    if (!storage) return [];

    const normalized = Array.isArray(addresses) ? addresses.filter(Boolean) : [];
    try {
        storage.setItem(CUSTOMER_ADDRESSES_SNAPSHOT_KEY, JSON.stringify(normalized));
    } catch {
        // Ignore storage errors.
    }
    return normalized;
}

export function upsertCustomerAddressSnapshot(address) {
    if (!address?.id) return readCustomerAddressesSnapshot();
    const existing = readCustomerAddressesSnapshot();
    const next = [
        address,
        ...existing.filter((item) => String(item?.id || '') !== String(address.id)),
    ];
    return writeCustomerAddressesSnapshot(next);
}

export function removeCustomerAddressSnapshot(addressId) {
    if (!addressId) return readCustomerAddressesSnapshot();
    const existing = readCustomerAddressesSnapshot();
    return writeCustomerAddressesSnapshot(
        existing.filter((item) => String(item?.id || '') !== String(addressId))
    );
}

export async function fetchCachedRestaurantBootstrap({
    restaurantId,
    phone = '',
    token = '',
    ref = '',
    src = 'runtime',
    ttlMs = RESTAURANT_BOOTSTRAP_TTL_MS,
} = {}) {
    if (!restaurantId) {
        throw new Error('Restaurant ID is required to load restaurant bootstrap data.');
    }

    const normalizedPhone = normalizePhone(phone);
    const tokenSignature = getTokenSignature(token);
    const cacheKey = [
        RESTAURANT_BOOTSTRAP_CACHE_PREFIX,
        toCacheKeyPart(restaurantId),
        toCacheKeyPart(src),
        toCacheKeyPart(normalizedPhone),
        toCacheKeyPart(ref),
        toCacheKeyPart(tokenSignature),
    ].join('');

    return getCachedClientResource(cacheKey, async () => {
        const query = new URLSearchParams({ src });
        if (normalizedPhone) query.set('phone', normalizedPhone);
        if (token) query.set('token', token);
        if (ref) query.set('ref', ref);

        const encodedRestaurantId = encodeURIComponent(String(restaurantId));
        if (USE_PUBLIC_BOOTSTRAP) {
            try {
                const bootstrapData = await fetchJsonOrThrow(`/api/public/bootstrap/${encodedRestaurantId}?${query.toString()}`);
                const menuData = bootstrapData?.legacy?.menuData || bootstrapData?.menu || {};
                const settingsData = bootstrapData?.legacy?.settingsData || bootstrapData?.delivery || {};

                if (bootstrapData?.customer && bootstrapData?.customer?.resolved !== false) {
                    primeCustomerLookupCache({
                        phone: normalizedPhone,
                        ref,
                        guestId: '',
                        user: null,
                    }, bootstrapData.customer, CUSTOMER_LOOKUP_TTL_MS);
                }

                if (bootstrapData?.activeOrder?.exists) {
                    primeCachedClientResource(
                        [
                            ACTIVE_ORDER_CACHE_PREFIX,
                            toCacheKeyPart(restaurantId),
                            toCacheKeyPart(''),
                            toCacheKeyPart(ref),
                            toCacheKeyPart(normalizedPhone),
                            toCacheKeyPart(tokenSignature),
                        ].join(''),
                        { activeOrders: [bootstrapData.activeOrder] },
                        { ttlMs: ACTIVE_ORDER_TTL_MS, storage: 'memory' }
                    );
                }

                return {
                    menuData,
                    settingsData: settingsData || {},
                    bootstrapData,
                };
            } catch (error) {
                if (error?.status !== 404 && error?.status !== 409) {
                    console.warn('[runtimeFetchers] Bootstrap route failed, falling back to legacy path:', error?.message || error);
                }
            }
        }

        const [menuData, settingsData] = await Promise.all([
            fetchJsonOrThrow(`/api/public/menu/${encodedRestaurantId}?${query.toString()}`),
            fetchJsonOrThrow(`/api/public/settings/${encodedRestaurantId}`).catch((error) => {
                if (error?.status === 404) {
                    return {};
                }
                throw error;
            }),
        ]);

        return {
            menuData,
            settingsData: settingsData || {},
        };
    }, {
        ttlMs,
        storage: 'memory',
    });
}

export async function fetchCachedOrderStatus({
    orderId,
    token = '',
    lite = false,
    ttlMs = ORDER_STATUS_TTL_MS,
} = {}) {
    if (!orderId) {
        throw new Error('Order ID is required to fetch order status.');
    }

    const tokenSignature = getTokenSignature(token);
    const cacheKey = [
        ORDER_STATUS_CACHE_PREFIX,
        toCacheKeyPart(orderId),
        toCacheKeyPart(tokenSignature),
        lite ? 'lite' : 'full',
    ].join('');

    return getCachedClientResource(cacheKey, async () => {
        const query = new URLSearchParams();
        if (token) query.set('token', token);
        if (lite) query.set('lite', '1');

        const suffix = query.toString();
        const url = `/api/order/status/${encodeURIComponent(String(orderId))}${suffix ? `?${suffix}` : ''}`;
        return fetchJsonOrThrow(url, { cache: 'no-store' });
    }, {
        ttlMs,
        storage: 'memory',
    });
}

export async function fetchCachedActiveOrders({
    restaurantId = '',
    phone = '',
    ref = '',
    token = '',
    tabId = '',
    ttlMs = ACTIVE_ORDER_TTL_MS,
} = {}) {
    const normalizedPhone = normalizePhone(phone);
    if (!tabId && !normalizedPhone && !ref) {
        return null;
    }

    const tokenSignature = getTokenSignature(token);
    const cacheKey = [
        ACTIVE_ORDER_CACHE_PREFIX,
        toCacheKeyPart(restaurantId),
        toCacheKeyPart(tabId),
        toCacheKeyPart(ref),
        toCacheKeyPart(normalizedPhone),
        toCacheKeyPart(tokenSignature),
    ].join('');

    return getCachedClientResource(cacheKey, async () => {
        const query = new URLSearchParams();
        if (tabId) query.set('tabId', tabId);
        if (normalizedPhone) query.set('phone', normalizedPhone);
        if (ref) query.set('ref', ref);
        if (token) query.set('token', token);
        if (restaurantId) query.set('restaurantId', restaurantId);

        return fetchJsonOrThrow(`/api/order/active?${query.toString()}`, {
            cache: 'no-store',
        });
    }, {
        ttlMs,
        storage: 'memory',
    });
}
