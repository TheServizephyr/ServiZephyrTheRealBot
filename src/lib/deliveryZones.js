import { calculateDeliveryCharge, calculateHaversineDistance } from '@/lib/distance';

function toFiniteNumber(value, fallback = null) {
    if (value === '' || value === undefined) return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function toNullableFiniteNumber(value, fallback = null) {
    if (value === '' || value === null || value === undefined) return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function normalizeCoordinate(point) {
    if (Array.isArray(point) && point.length >= 2) {
        const lat = toFiniteNumber(point[0]);
        const lng = toFiniteNumber(point[1]);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    }

    if (!point || typeof point !== 'object') return null;

    const lat = toFiniteNumber(point.lat ?? point.latitude);
    const lng = toFiniteNumber(point.lng ?? point.lon ?? point.longitude);
    if (lat === null || lng === null) return null;

    return { lat, lng };
}

function normalizeRing(points = []) {
    if (!Array.isArray(points)) return [];
    const ring = points.map(normalizeCoordinate).filter(Boolean);
    return ring.length >= 3 ? ring : [];
}

function normalizeZonePolygons(zone = {}) {
    const rawBoundary = zone.boundary ?? zone.coordinates ?? zone.points ?? null;
    const geojson = zone.geojson ?? zone.geometry ?? null;
    const polygons = [];

    if (Array.isArray(rawBoundary) && rawBoundary.length > 0) {
        if (Array.isArray(rawBoundary[0]) && Array.isArray(rawBoundary[0][0])) {
            rawBoundary.forEach((ring) => {
                const normalizedRing = normalizeRing(ring);
                if (normalizedRing.length > 0) polygons.push(normalizedRing);
            });
        } else {
            const normalizedRing = normalizeRing(rawBoundary);
            if (normalizedRing.length > 0) polygons.push(normalizedRing);
        }
    }

    if (geojson?.type === 'Polygon' && Array.isArray(geojson.coordinates)) {
        const outerRing = geojson.coordinates[0];
        const normalizedRing = Array.isArray(outerRing)
            ? outerRing
                .map((pair) => Array.isArray(pair) ? normalizeCoordinate([pair[1], pair[0]]) : null)
                .filter(Boolean)
            : [];
        if (normalizedRing.length >= 3) polygons.push(normalizedRing);
    }

    if (geojson?.type === 'MultiPolygon' && Array.isArray(geojson.coordinates)) {
        geojson.coordinates.forEach((polygon) => {
            if (!Array.isArray(polygon)) return;
            const outerRing = polygon[0];
            const normalizedRing = Array.isArray(outerRing)
                ? outerRing
                    .map((pair) => Array.isArray(pair) ? normalizeCoordinate([pair[1], pair[0]]) : null)
                    .filter(Boolean)
                : [];
            if (normalizedRing.length >= 3) polygons.push(normalizedRing);
        });
    }

    return polygons;
}

function normalizePricingTier(tier = {}) {
    const minOrder = toFiniteNumber(tier.minOrder, 0) ?? 0;
    const maxOrderRaw = tier.maxOrder;
    const maxOrder = maxOrderRaw === -1 ? -1 : toFiniteNumber(maxOrderRaw, -1);
    const deliveryFee = toNullableFiniteNumber(
        tier.deliveryFee ?? tier.fee ?? tier.amount,
        null
    );
    const feeAdjustment = toNullableFiniteNumber(tier.feeAdjustment ?? tier.adjustment, null);

    return {
        minOrder,
        maxOrder,
        deliveryFee,
        feeAdjustment,
        label: String(tier.label || '').trim(),
    };
}

export function normalizeDeliveryZones(zones = []) {
    if (!Array.isArray(zones)) return [];

    return zones
        .map((zone, index) => {
            const polygons = normalizeZonePolygons(zone);
            if (polygons.length === 0) return null;

            const pricingTiers = Array.isArray(zone.pricingTiers)
                ? zone.pricingTiers.map(normalizePricingTier).sort((a, b) => a.minOrder - b.minOrder)
                : [];

            return {
                id: String(zone.zone_id || zone.zoneId || zone.id || `zone_${index + 1}`).trim(),
                name: String(zone.name || zone.zoneName || `Zone ${index + 1}`).trim(),
                isActive: zone.is_active !== undefined ? zone.is_active !== false : zone.isActive !== false,
                isBlocked: zone.is_blocked === true || zone.isBlocked === true || String(zone.status || '').toLowerCase() === 'blocked',
                priority: toFiniteNumber(zone.priority, index) ?? index,
                baseFee: toNullableFiniteNumber(zone.baseFee, null),
                maxServiceRadiusKm: toNullableFiniteNumber(zone.maxServiceRadiusKm, null),
                pricingTiers,
                polygons,
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.isBlocked !== b.isBlocked) return a.isBlocked ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

function isPointInRing(point, ring) {
    let inside = false;
    const x = point.lng;
    const y = point.lat;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].lng;
        const yi = ring[i].lat;
        const xj = ring[j].lng;
        const yj = ring[j].lat;

        const intersects = ((yi > y) !== (yj > y))
            && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);

        if (intersects) inside = !inside;
    }

    return inside;
}

export function findMatchingDeliveryZone(zones = [], point = null) {
    if (!point) return null;

    for (const zone of zones) {
        if (!zone?.isActive) continue;
        const matches = Array.isArray(zone.polygons) && zone.polygons.some((ring) => isPointInRing(point, ring));
        if (matches) return zone;
    }

    return null;
}

function resolveZoneTierFee(zone, subtotal) {
    const tiers = Array.isArray(zone?.pricingTiers) ? zone.pricingTiers : [];
    if (tiers.length === 0) return null;

    const subtotalNum = toFiniteNumber(subtotal, 0) ?? 0;
    const matchedTier = tiers.find((tier) => {
        if (subtotalNum < tier.minOrder) return false;
        if (tier.maxOrder === -1 || tier.maxOrder === null) return true;
        return subtotalNum <= tier.maxOrder;
    });

    if (!matchedTier) return null;

    if (matchedTier.deliveryFee !== null) {
        return {
            charge: matchedTier.deliveryFee,
            reason: matchedTier.deliveryFee === 0
                ? `Free delivery in ${zone.name}`
                : `Zone fee for ${zone.name}`,
        };
    }

    if (matchedTier.feeAdjustment !== null) {
        const baseFee = toFiniteNumber(zone.baseFee, 0) ?? 0;
        return {
            charge: baseFee + matchedTier.feeAdjustment,
            reason: `Zone-adjusted fee for ${zone.name}`,
        };
    }

    return null;
}

function buildBlockedZoneResponse({ zone, aerialDistance, roadDistance, roadFactor }) {
    return {
        allowed: false,
        charge: 0,
        aerialDistance: parseFloat(aerialDistance.toFixed(1)),
        roadDistance: parseFloat(roadDistance.toFixed(1)),
        roadFactor,
        type: 'hybrid-zone-blocked',
        pricingSource: 'zone-blocked',
        zone: {
            id: zone.id,
            name: zone.name,
        },
        message: `${zone.name} is temporarily unavailable for delivery.`,
    };
}

export function calculateHybridDeliveryCharge({
    restaurantLat,
    restaurantLng,
    addressLat,
    addressLng,
    subtotal,
    settings = {},
}) {
    const aerialDistance = calculateHaversineDistance(
        restaurantLat,
        restaurantLng,
        addressLat,
        addressLng
    );

    const legacyResult = calculateDeliveryCharge(aerialDistance, subtotal, settings);
    const roadFactor = legacyResult.roadFactor ?? Math.max(1.0, toFiniteNumber(settings.roadDistanceFactor, 1.0) ?? 1.0);
    const roadDistance = legacyResult.roadDistance ?? parseFloat((aerialDistance * roadFactor).toFixed(1));
    const normalizedZones = normalizeDeliveryZones(settings.deliveryZones);
    const hybridEnabled = settings.deliveryEngineMode === 'hybrid-zones' || settings.deliveryUseZones === true;

    if (!hybridEnabled || normalizedZones.length === 0) {
        return {
            ...legacyResult,
            pricingSource: 'legacy',
            engineMode: 'legacy',
        };
    }

    if (legacyResult.allowed === false) {
        return {
            ...legacyResult,
            pricingSource: 'global-radius',
            engineMode: 'hybrid-zones',
        };
    }

    const customerPoint = { lat: addressLat, lng: addressLng };
    const matchedZone = findMatchingDeliveryZone(normalizedZones, customerPoint);

    if (!matchedZone) {
        if (settings.zoneFallbackToLegacy === false) {
            return {
                allowed: false,
                charge: 0,
                aerialDistance: parseFloat(aerialDistance.toFixed(1)),
                roadDistance,
                roadFactor,
                type: 'hybrid-zone-miss',
                pricingSource: 'zone-miss',
                engineMode: 'hybrid-zones',
                message: 'This address is outside our mapped delivery zones.',
            };
        }

        return {
            ...legacyResult,
            pricingSource: 'legacy-fallback',
            engineMode: 'hybrid-zones',
        };
    }

    if (matchedZone.isBlocked) {
        return {
            ...buildBlockedZoneResponse({ zone: matchedZone, aerialDistance, roadDistance, roadFactor }),
            engineMode: 'hybrid-zones',
        };
    }

    if (
        matchedZone.maxServiceRadiusKm !== null &&
        matchedZone.maxServiceRadiusKm >= 0 &&
        roadDistance > matchedZone.maxServiceRadiusKm
    ) {
        return {
            allowed: false,
            charge: 0,
            aerialDistance: parseFloat(aerialDistance.toFixed(1)),
            roadDistance,
            roadFactor,
            type: 'hybrid-zone-radius',
            pricingSource: 'zone-radius',
            engineMode: 'hybrid-zones',
            zone: {
                id: matchedZone.id,
                name: matchedZone.name,
            },
            message: `${matchedZone.name} is currently serviced only up to ${matchedZone.maxServiceRadiusKm}km.`,
        };
    }

    const zoneTierResult = resolveZoneTierFee(matchedZone, subtotal);
    const zoneCharge = zoneTierResult
        ? zoneTierResult.charge
        : (matchedZone.baseFee !== null ? matchedZone.baseFee : legacyResult.charge);

    return {
        allowed: true,
        charge: Math.max(0, Math.round(zoneCharge)),
        aerialDistance: parseFloat(aerialDistance.toFixed(1)),
        roadDistance,
        roadFactor,
        reason: zoneTierResult?.reason || `Zone pricing applied for ${matchedZone.name}`,
        type: 'hybrid-zone',
        pricingSource: zoneTierResult ? 'zone-tier' : 'zone-base',
        engineMode: 'hybrid-zones',
        zone: {
            id: matchedZone.id,
            name: matchedZone.name,
        },
    };
}
