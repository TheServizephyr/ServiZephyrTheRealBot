import { calculateDeliveryCharge, calculateHaversineDistance } from '@/lib/distance';
import { getDeliveryZoneOptimizationCircle, isPointInsideOptimizationCircle } from '@/lib/deliveryZoneOptimization';

const DEFAULT_ZONE_TIMEZONE = 'Asia/Kolkata';
const DAY_TO_INDEX = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
};

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

function normalizeScheduleDays(days) {
    if (!Array.isArray(days)) return [0, 1, 2, 3, 4, 5, 6];
    const normalized = days
        .map((day) => {
            if (Number.isFinite(Number(day))) {
                const num = Number(day);
                return num >= 0 && num <= 6 ? num : null;
            }
            const key = String(day || '').trim().toLowerCase().slice(0, 3);
            return Object.prototype.hasOwnProperty.call(DAY_TO_INDEX, key) ? DAY_TO_INDEX[key] : null;
        })
        .filter((day) => day !== null);
    return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
}

function normalizeZoneSchedule(zone = {}) {
    const schedule = zone.schedule && typeof zone.schedule === 'object' ? zone.schedule : {};
    const modeRaw = String(
        zone.scheduleMode ??
        schedule.mode ??
        schedule.type ??
        'always'
    ).trim().toLowerCase();
    const mode = modeRaw === 'scheduled' ? 'scheduled' : 'always';

    return {
        mode,
        startTime: String(zone.scheduleStartTime ?? schedule.startTime ?? '09:00').trim() || '09:00',
        endTime: String(zone.scheduleEndTime ?? schedule.endTime ?? '21:00').trim() || '21:00',
        days: normalizeScheduleDays(zone.scheduleDays ?? schedule.days),
        timezone: String(zone.scheduleTimezone ?? schedule.timezone ?? DEFAULT_ZONE_TIMEZONE).trim() || DEFAULT_ZONE_TIMEZONE,
    };
}

function parseTimeStringToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function getNowPartsInTimezone(timezone, now = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || DEFAULT_ZONE_TIMEZONE,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const weekday = String(parts.find((part) => part.type === 'weekday')?.value || '').trim().toLowerCase().slice(0, 3);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);

    if (!Object.prototype.hasOwnProperty.call(DAY_TO_INDEX, weekday)) return null;
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    return {
        day: DAY_TO_INDEX[weekday],
        previousDay: (DAY_TO_INDEX[weekday] + 6) % 7,
        minutes: (hour * 60) + minute,
    };
}

function isZoneScheduleOpen(schedule, now = new Date()) {
    if (!schedule || schedule.mode !== 'scheduled') return true;

    const startMinutes = parseTimeStringToMinutes(schedule.startTime);
    const endMinutes = parseTimeStringToMinutes(schedule.endTime);
    const nowParts = getNowPartsInTimezone(schedule.timezone, now);
    const allowedDays = Array.isArray(schedule.days) ? schedule.days : [];

    if (startMinutes === null || endMinutes === null || !nowParts || allowedDays.length === 0) return false;
    if (startMinutes === endMinutes) return allowedDays.includes(nowParts.day);

    if (startMinutes < endMinutes) {
        return allowedDays.includes(nowParts.day)
            && nowParts.minutes >= startMinutes
            && nowParts.minutes < endMinutes;
    }

    return (
        (allowedDays.includes(nowParts.day) && nowParts.minutes >= startMinutes) ||
        (allowedDays.includes(nowParts.previousDay) && nowParts.minutes < endMinutes)
    );
}

function getZoneBlockReason(zone, now = new Date()) {
    if (!zone?.isActive) return 'inactive';
    if (zone.isBlocked) return 'manual-blocked';
    if (!isZoneScheduleOpen(zone.schedule, now)) return 'outside-schedule';
    return null;
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
                isActive: zone.isActive !== false && zone.is_active !== false,
                isBlocked: zone.is_blocked === true || zone.isBlocked === true || String(zone.status || '').toLowerCase() === 'blocked',
                priority: toFiniteNumber(zone.priority, index) ?? index,
                baseFee: toNullableFiniteNumber(zone.baseFee, null),
                pricingTiers,
                polygons,
                schedule: normalizeZoneSchedule(zone),
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
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

function doesZoneMatchPoint(zone, point) {
    return Array.isArray(zone?.polygons) && zone.polygons.some((ring) => isPointInRing(point, ring));
}

export function findMatchingBlockedDeliveryZone(zones = [], point = null, now = new Date()) {
    if (!point) return null;

    for (const zone of zones) {
        const blockReason = getZoneBlockReason(zone, now);
        if (!blockReason || blockReason === 'inactive') continue;
        if (doesZoneMatchPoint(zone, point)) return { ...zone, blockReason };
    }

    return null;
}

export function findMatchingDeliveryZone(zones = [], point = null, now = new Date()) {
    if (!point) return null;

    for (const zone of zones) {
        if (getZoneBlockReason(zone, now)) continue;
        if (doesZoneMatchPoint(zone, point)) return zone;
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
    const isScheduledBlock = zone?.blockReason === 'outside-schedule';
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
        message: isScheduledBlock
            ? `${zone.name} is not available for delivery at this time.`
            : `${zone.name} is temporarily unavailable for delivery.`,
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
    const now = new Date();
    const optimizationCircle = getDeliveryZoneOptimizationCircle(normalizedZones);
    const isOutsideOptimizationCircle = optimizationCircle
        ? !isPointInsideOptimizationCircle(customerPoint, optimizationCircle)
        : false;

    if (isOutsideOptimizationCircle) {
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

    const blockedZone = findMatchingBlockedDeliveryZone(normalizedZones, customerPoint, now);
    if (blockedZone) {
        return {
            ...buildBlockedZoneResponse({ zone: blockedZone, aerialDistance, roadDistance, roadFactor }),
            engineMode: 'hybrid-zones',
        };
    }

    const matchedZone = findMatchingDeliveryZone(normalizedZones, customerPoint, now);
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

