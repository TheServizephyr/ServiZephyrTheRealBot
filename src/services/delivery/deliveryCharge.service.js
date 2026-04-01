import { calculateHybridDeliveryCharge } from '@/lib/deliveryZones';
import { findBusinessById } from '@/services/business/businessService';

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function getBusinessLabel(businessType = 'restaurant') {
    if (businessType === 'store' || businessType === 'shop') return 'store';
    if (businessType === 'street-vendor') return 'stall';
    return 'restaurant';
}

export async function calculateDeliveryChargeForAddress(firestore, {
    restaurantId,
    addressLat,
    addressLng,
    subtotal,
}) {
    const subtotalNum = Number(subtotal) || 0;
    const addressLatNum = toFiniteNumber(addressLat);
    const addressLngNum = toFiniteNumber(addressLng);

    if (!restaurantId || addressLatNum === null || addressLngNum === null || subtotal === undefined) {
        return {
            ok: false,
            status: 400,
            payload: { error: 'Missing required fields: restaurantId, addressLat, addressLng, subtotal' },
        };
    }

    const business = await findBusinessById(firestore, restaurantId, {
        includeDeliverySettings: false,
    });

    if (!business) {
        return {
            ok: false,
            status: 404,
            payload: { error: 'Business not found' },
        };
    }

    const restaurantRef = business.ref;
    const restaurantData = business.data;
    const deliveryConfigSnap = await restaurantRef.collection('delivery_settings').doc('config').get();
    const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};

    let result;
    try {
        ({ result } = calculateDeliveryChargeForBusiness({
            businessData: restaurantData,
            businessType: business.type,
            deliveryConfig,
            addressLat: addressLatNum,
            addressLng: addressLngNum,
            subtotal: subtotalNum,
        }));
    } catch (error) {
        return {
            ok: false,
            status: 400,
            payload: { error: error.message || 'Delivery charge calculation failed' },
        };
    }

    return {
        ok: true,
        status: 200,
        payload: {
            success: true,
            ...result,
        },
    };
}

export function getBusinessDeliveryCoordinates(businessData = {}) {
    return {
        lat: toFiniteNumber(
            businessData.coordinates?.lat ??
            businessData.address?.latitude ??
            businessData.businessAddress?.latitude
        ),
        lng: toFiniteNumber(
            businessData.coordinates?.lng ??
            businessData.address?.longitude ??
            businessData.businessAddress?.longitude
        ),
    };
}

export function buildDeliverySettings(deliveryConfig = {}, businessData = {}) {
    const getSetting = (key, defaultVal) => deliveryConfig[key] ?? businessData[key] ?? defaultVal;

    return {
        deliveryEnabled: getSetting('deliveryEnabled', true),
        deliveryRadius: getSetting('deliveryRadius', 10),
        deliveryChargeType: getSetting('deliveryFeeType', getSetting('deliveryChargeType', 'fixed')),
        fixedCharge: getSetting('deliveryFixedFee', getSetting('fixedCharge', 0)),
        perKmCharge: getSetting('deliveryPerKmFee', getSetting('perKmCharge', 0)),
        baseDistance: getSetting('deliveryBaseDistance', getSetting('baseDistance', 0)),
        freeDeliveryThreshold: getSetting('deliveryFreeThreshold', getSetting('freeDeliveryThreshold', 0)),
        freeDeliveryRadius: getSetting('freeDeliveryRadius', 0),
        freeDeliveryMinOrder: getSetting('freeDeliveryMinOrder', 0),
        roadDistanceFactor: getSetting('roadDistanceFactor', 1.0),
        deliveryTiers: getSetting('deliveryTiers', []),
        orderSlabRules: getSetting('deliveryOrderSlabRules', getSetting('orderSlabRules', [])),
        orderSlabAboveFee: getSetting('deliveryOrderSlabAboveFee', getSetting('orderSlabAboveFee', 0)),
        orderSlabBaseDistance: getSetting('deliveryOrderSlabBaseDistance', getSetting('orderSlabBaseDistance', 1)),
        orderSlabPerKmFee: getSetting('deliveryOrderSlabPerKmFee', getSetting('orderSlabPerKmFee', 15)),
        deliveryEngineMode: getSetting('deliveryEngineMode', 'legacy'),
        deliveryUseZones: getSetting('deliveryUseZones', false),
        zoneFallbackToLegacy: getSetting('zoneFallbackToLegacy', true),
        deliveryZones: getSetting('deliveryZones', []),
    };
}

export function calculateDeliveryChargeForBusiness({
    businessData = {},
    businessType = 'restaurant',
    deliveryConfig = {},
    addressLat,
    addressLng,
    subtotal,
}) {
    const businessLabel = getBusinessLabel(businessType);
    const settings = buildDeliverySettings(deliveryConfig, businessData);
    const restaurantCoords = getBusinessDeliveryCoordinates(businessData);

    if (restaurantCoords.lat === null || restaurantCoords.lng === null) {
        throw new Error(`${businessLabel.charAt(0).toUpperCase() + businessLabel.slice(1)} coordinates not configured`);
    }

    if (settings.deliveryEnabled === false) {
        return {
            businessLabel,
            settings,
            result: {
                allowed: false,
                charge: 0,
                aerialDistance: 0,
                roadDistance: 0,
                roadFactor: settings.roadDistanceFactor,
                message: `Delivery is currently disabled for this ${businessLabel}.`,
                reason: 'delivery-disabled',
            },
        };
    }

    return {
        businessLabel,
        settings,
        result: calculateHybridDeliveryCharge({
            restaurantLat: restaurantCoords.lat,
            restaurantLng: restaurantCoords.lng,
            addressLat: Number(addressLat),
            addressLng: Number(addressLng),
            subtotal: Number(subtotal) || 0,
            settings,
        }),
    };
}
