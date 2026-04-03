import { calculateHybridDeliveryCharge } from '@/lib/deliveryZones';

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function buildClientDeliverySettings(source = {}) {
    const getSetting = (...keys) => {
        for (const key of keys) {
            if (source?.[key] !== undefined) return source[key];
        }
        return undefined;
    };

    return {
        deliveryEnabled: getSetting('deliveryEnabled') !== false,
        deliveryRadius: getSetting('deliveryRadius') ?? 10,
        deliveryChargeType: getSetting('deliveryFeeType', 'deliveryChargeType') ?? 'fixed',
        fixedCharge: getSetting('deliveryFixedFee', 'fixedCharge', 'deliveryCharge') ?? 0,
        perKmCharge: getSetting('deliveryPerKmFee', 'perKmCharge') ?? 0,
        baseDistance: getSetting('deliveryBaseDistance', 'baseDistance') ?? 0,
        freeDeliveryThreshold: getSetting('deliveryFreeThreshold', 'freeDeliveryThreshold') ?? 0,
        freeDeliveryRadius: getSetting('freeDeliveryRadius') ?? 0,
        freeDeliveryMinOrder: getSetting('freeDeliveryMinOrder') ?? 0,
        roadDistanceFactor: getSetting('roadDistanceFactor') ?? 1.0,
        deliveryTiers: Array.isArray(getSetting('deliveryTiers')) ? getSetting('deliveryTiers') : [],
        orderSlabRules: Array.isArray(getSetting('deliveryOrderSlabRules', 'orderSlabRules')) ? (getSetting('deliveryOrderSlabRules', 'orderSlabRules') || []) : [],
        orderSlabAboveFee: getSetting('deliveryOrderSlabAboveFee', 'orderSlabAboveFee') ?? 0,
        orderSlabBaseDistance: getSetting('deliveryOrderSlabBaseDistance', 'orderSlabBaseDistance') ?? 1,
        orderSlabPerKmFee: getSetting('deliveryOrderSlabPerKmFee', 'orderSlabPerKmFee') ?? 15,
        deliveryEngineMode: getSetting('deliveryEngineMode') ?? 'legacy',
        deliveryUseZones: getSetting('deliveryUseZones') === true,
        zoneFallbackToLegacy: getSetting('zoneFallbackToLegacy') !== false,
        deliveryZones: Array.isArray(getSetting('deliveryZones')) ? getSetting('deliveryZones') : [],
    };
}

export function calculateClientDeliveryValidation({
    businessData = {},
    address = {},
    subtotal = 0,
}) {
    const restaurantLat = toFiniteNumber(
        businessData?.coordinates?.lat ??
        businessData?.latitude ??
        businessData?.address?.latitude ??
        businessData?.businessAddress?.latitude
    );
    const restaurantLng = toFiniteNumber(
        businessData?.coordinates?.lng ??
        businessData?.longitude ??
        businessData?.address?.longitude ??
        businessData?.businessAddress?.longitude
    );
    const addressLat = toFiniteNumber(address?.lat ?? address?.latitude);
    const addressLng = toFiniteNumber(address?.lng ?? address?.longitude);

    if (restaurantLat === null || restaurantLng === null || addressLat === null || addressLng === null) {
        return null;
    }

    const settings = buildClientDeliverySettings(businessData);

    return calculateHybridDeliveryCharge({
        restaurantLat,
        restaurantLng,
        addressLat,
        addressLng,
        subtotal: Number(subtotal) || 0,
        settings,
    });
}
