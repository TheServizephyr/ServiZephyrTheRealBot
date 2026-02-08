/**
 * Distance Calculation Utilities
 * Zero-cost distance calculation using Haversine formula
 */

/**
 * Calculate straight-line (aerial) distance between two coordinates
 * @param {number} lat1 - Starting latitude
 * @param {number} lon1 - Starting longitude
 * @param {number} lat2 - Destination latitude
 * @param {number} lon2 - Destination longitude
 * @returns {number} Distance in kilometers
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance; // km
}

/**
 * Calculate approximate road distance using aerial distance + road factor
 * @param {number} lat1 - Starting latitude
 * @param {number} lon1 - Starting longitude
 * @param {number} lat2 - Destination latitude
 * @param {number} lon2 - Destination longitude
 * @param {number} roadFactor - Multiplier for road distance (1.0 = no adjustment, 1.4 = normal city, 1.7 = dense area)
 * @returns {object} { aerialDistance, roadDistance, roadFactor }
 */
export function calculateRoadDistance(lat1, lon1, lat2, lon2, roadFactor = 1.0) {
    const aerialDistance = calculateHaversineDistance(lat1, lon1, lat2, lon2);

    // If roadFactor is 1.0 or disabled, use aerial distance as-is
    const adjustedFactor = roadFactor && roadFactor > 0 ? roadFactor : 1.0;
    const roadDistance = aerialDistance * adjustedFactor;

    return {
        aerialDistance: parseFloat(aerialDistance.toFixed(2)),
        roadDistance: parseFloat(roadDistance.toFixed(2)),
        roadFactor: adjustedFactor
    };
}

/**
 * Convert degrees to radians
 * @param {number} degrees
 * @returns {number} radians
 */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Calculate delivery charge based on distance and settings
 * @param {number} aerialDistance - Straight-line distance in km
 * @param {number} subtotal - Order subtotal
 * @param {object} settings - Restaurant delivery settings
 * @returns {object} { allowed, charge, aerialDistance, roadDistance, reason, message }
 */
export function calculateDeliveryCharge(aerialDistance, subtotal, settings) {
    // Apply road distance factor (optional)
    const roadFactor = settings.roadDistanceFactor || 1.0;
    const roadDistance = aerialDistance * roadFactor;

    // Check if within max delivery radius (using road distance)
    if (roadDistance > settings.deliveryRadius) {
        return {
            allowed: false,
            charge: 0,
            aerialDistance: parseFloat(aerialDistance.toFixed(1)),
            roadDistance: parseFloat(roadDistance.toFixed(1)),
            roadFactor,
            message: `Delivery not available. You are ${roadDistance.toFixed(1)}km away by road (max: ${settings.deliveryRadius}km)`
        };
    }

    let charge = 0;
    let reason = '';

    // ✅ UNIVERSAL FREE ZONE - Works with ALL charge types!
    // Check if customer is in free delivery zone AND meets minimum order
    if (
        settings.freeDeliveryRadius &&
        settings.freeDeliveryMinOrder &&
        roadDistance <= settings.freeDeliveryRadius &&
        subtotal >= settings.freeDeliveryMinOrder
    ) {
        charge = 0;
        reason = `Free delivery within ${settings.freeDeliveryRadius}km for orders ≥₹${settings.freeDeliveryMinOrder}`;
    }
    // Apply charge type if not in free zone
    else if (settings.deliveryChargeType === 'fixed') {
        charge = settings.fixedCharge || 0;
        reason = 'Fixed delivery charge';
    } else if (settings.deliveryChargeType === 'per-km') {
        charge = roadDistance * (settings.perKmCharge || 0);
        reason = `${roadDistance.toFixed(1)}km × ₹${settings.perKmCharge}/km`;
    } else if (settings.deliveryChargeType === 'free-over') {
        if (subtotal >= settings.freeDeliveryThreshold) {
            charge = 0;
            reason = `Free delivery for orders ≥₹${settings.freeDeliveryThreshold}`;
        } else {
            // Fallback to fixed charge if below threshold
            charge = settings.fixedCharge || 0;
            reason = 'Standard delivery charge';
        }
    }

    return {
        allowed: true,
        charge: Math.round(charge),
        aerialDistance: parseFloat(aerialDistance.toFixed(1)),
        roadDistance: parseFloat(roadDistance.toFixed(1)),
        roadFactor,
        reason
    };
}
