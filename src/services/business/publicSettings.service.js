import { findBusinessById } from '@/services/business/businessService';

const PUBLIC_SETTINGS_CACHE_TTL_MS = 60 * 1000;

function getPublicSettingsCacheStore() {
    if (!globalThis.__servizephyrPublicSettingsCache) {
        globalThis.__servizephyrPublicSettingsCache = new Map();
    }
    return globalThis.__servizephyrPublicSettingsCache;
}

function readPublicSettingsCache(key) {
    if (!key) return null;
    const store = getPublicSettingsCacheStore();
    const entry = store.get(key);
    if (!entry) return null;
    if (!entry.expiresAt || entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
    }
    return entry.value || null;
}

function writePublicSettingsCache(key, value) {
    if (!key || !value) return;
    getPublicSettingsCacheStore().set(key, {
        value,
        expiresAt: Date.now() + PUBLIC_SETTINGS_CACHE_TTL_MS,
    });
}

function normalizeGstCalculationMode(businessData = {}) {
    if (businessData?.gstCalculationMode) {
        const mode = String(businessData.gstCalculationMode).trim().toLowerCase();
        if (mode === 'excluded') return 'excluded';
        if (mode === 'included') return 'included';
    }
    if (businessData?.gstIncludedInPrice === false) return 'excluded';
    return 'included';
}

/**
 * Build publicSettings directly from already-fetched businessData (zero Firestore reads).
 * Reuse whenever businessData is already in scope to avoid redundant lookups.
 */
export function buildPublicSettingsFromData(data = {}, deliveryConfig = {}) {
    const fallback = (key, defaultVal) => deliveryConfig[key] ?? data[key] ?? defaultVal;
    const gstCalcMode = normalizeGstCalculationMode(data);

    return {
        deliveryEnabled: fallback('deliveryEnabled', true),
        pickupEnabled: fallback('pickupEnabled', true),
        dineInEnabled: fallback('dineInEnabled', true),

        deliveryCodEnabled: fallback('deliveryCodEnabled', true),
        deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
        pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
        pickupPodEnabled: fallback('pickupPodEnabled', true),
        dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
        dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),

        deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
        deliveryFreeThreshold: fallback('deliveryFreeThreshold', null),

        gstEnabled: data.gstEnabled || false,
        gstRate: data.gstPercentage || data.gstRate || 0,
        gstPercentage: data.gstPercentage || data.gstRate || 0,
        gstMinAmount: data.gstMinAmount || 0,
        gstCalculationMode: gstCalcMode,
        gstIncludedInPrice: gstCalcMode === 'included',

        convenienceFeeEnabled: data.convenienceFeeEnabled || false,
        convenienceFeeRate: data.convenienceFeeRate || 2.5,
        convenienceFeePaidBy: data.convenienceFeePaidBy || 'customer',
        convenienceFeeLabel: data.convenienceFeeLabel || 'Payment Processing Fee',

        packagingChargeEnabled: data.packagingChargeEnabled || false,
        packagingChargeAmount: data.packagingChargeAmount || 0,

        serviceFeeEnabled: data.serviceFeeEnabled || false,
        serviceFeeLabel: data.serviceFeeLabel || 'Additional Charge',
        serviceFeeType: data.serviceFeeType || 'fixed',
        serviceFeeValue: Number(data.serviceFeeValue) || 0,
        serviceFeeApplyOn: data.serviceFeeApplyOn || 'all',
    };
}

export async function getPublicSettings(firestore, restaurantId) {
    const safeRestaurantId = String(restaurantId || '').trim();
    if (!safeRestaurantId) {
        throw new Error('Restaurant ID is required');
    }

    const cached = readPublicSettingsCache(safeRestaurantId);
    if (cached) return cached;

    const business = await findBusinessById(firestore, safeRestaurantId, {
        includeDeliverySettings: false,
    });

    if (!business?.ref) {
        const safeDefaults = {
            deliveryEnabled: true,
            pickupEnabled: true,
            dineInEnabled: true,
            deliveryCodEnabled: true,
            deliveryOnlinePaymentEnabled: true,
            pickupOnlinePaymentEnabled: true,
            pickupPodEnabled: true,
            dineInOnlinePaymentEnabled: true,
            dineInPayAtCounterEnabled: true,
        };
        writePublicSettingsCache(safeRestaurantId, safeDefaults);
        return safeDefaults;
    }

    // Use already-loaded business data; avoid re-fetching the main document
    const data = business.data || {};

    let deliveryConfig = {};
    try {
        const deliveryConfigSnap = await business.ref.collection('delivery_settings').doc('config').get();
        if (deliveryConfigSnap.exists) {
            deliveryConfig = deliveryConfigSnap.data() || {};
        }
    } catch (err) {
        console.warn('[public-settings-service] Failed to fetch delivery_settings config:', err?.message || err);
    }

    const publicSettings = buildPublicSettingsFromData(data, deliveryConfig);
    writePublicSettingsCache(safeRestaurantId, publicSettings);
    return publicSettings;
}

