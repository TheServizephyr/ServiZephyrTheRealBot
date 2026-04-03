
import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';
import { kv, isKvConfigured } from '@/lib/kv';

export const dynamic = 'force-dynamic';

function toFiniteCoordinate(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeBoundaryPoint(point) {
    if (Array.isArray(point) && point.length >= 2) {
        const lat = toFiniteCoordinate(point[0]);
        const lng = toFiniteCoordinate(point[1]);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    }

    if (!point || typeof point !== 'object') return null;

    const lat = toFiniteCoordinate(point.lat ?? point.latitude);
    const lng = toFiniteCoordinate(point.lng ?? point.lon ?? point.longitude);
    if (lat === null || lng === null) return null;

    return { lat, lng };
}

function normalizeBoundary(boundary = []) {
    if (!Array.isArray(boundary)) return [];
    return boundary.map(normalizeBoundaryPoint).filter(Boolean);
}

function normalizeScheduleDays(days) {
    if (!Array.isArray(days)) return [0, 1, 2, 3, 4, 5, 6];
    const normalized = days
        .map((day) => Number(day))
        .filter((day) => Number.isFinite(day) && day >= 0 && day <= 6);
    return normalized.length > 0 ? Array.from(new Set(normalized)).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
}

async function verifyUserAndGetData(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');

    const adminUserDoc = await firestore.collection('users').doc(uid).get();
    if (!adminUserDoc.exists) throw { message: 'User profile not found.', status: 404 };
    const adminUserData = adminUserDoc.data();

    let finalUserId = uid;
    let resolvedUserDoc = adminUserDoc;
    let resolvedUserData = adminUserData;

    if (adminUserData.role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    } else if (employeeOfOwnerId) {
        const accessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, adminUserData);
        if (!accessResult.authorized) throw { message: 'Access Denied.', status: 403 };
        finalUserId = employeeOfOwnerId;
    }

    if (finalUserId !== uid) {
        resolvedUserDoc = await firestore.collection('users').doc(finalUserId).get();
        if (!resolvedUserDoc.exists) throw { message: "User profile not found.", status: 404 };
        resolvedUserData = resolvedUserDoc.data();
    }

    let businessRef = null;
    let businessId = null;

    // Resolve Business
    let collectionsToTry = [];
    const userBusinessType = resolvedUserData.businessType;
    if (userBusinessType === 'restaurant') collectionsToTry = ['restaurants'];
    else if (userBusinessType === 'shop' || userBusinessType === 'store') collectionsToTry = ['shops'];
    else if (userBusinessType === 'street-vendor') collectionsToTry = ['street_vendors'];
    else collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

    for (const collectionName of collectionsToTry) {
        const businessesQuery = await firestore.collection(collectionName).where('ownerId', '==', finalUserId).limit(1).get();
        if (!businessesQuery.empty) {
            const businessDoc = businessesQuery.docs[0];
            businessRef = businessDoc.ref;
            businessId = businessDoc.id;
            break;
        }
    }

    if (!businessRef) throw { message: "Business not found", status: 404 };

    return { businessRef, businessId };
}

export async function GET(req) {
    try {
        const { businessRef } = await verifyUserAndGetData(req);

        // Fetch from sub-collection
        const [configDoc, parentDoc] = await Promise.all([
            businessRef.collection('delivery_settings').doc('config').get(),
            businessRef.get(),
        ]);
        const parentData = parentDoc.data() || {};

        const defaults = {
            deliveryEnabled: true,
            deliveryRadius: 5,
            deliveryFeeType: 'fixed',
            deliveryFixedFee: 30,
            deliveryBaseDistance: 0,
            deliveryPerKmFee: 5,
            deliveryFreeThreshold: 500,
            deliveryOnlinePaymentEnabled: true,
            deliveryCodEnabled: true,
            roadDistanceFactor: 1.0,
            freeDeliveryRadius: 0,
            freeDeliveryMinOrder: 0,
            deliveryTiers: [],
            deliveryOrderSlabRules: [
                { maxOrder: 100, fee: 10 },
                { maxOrder: 200, fee: 20 }
            ],
            deliveryOrderSlabAboveFee: 0,
            deliveryOrderSlabBaseDistance: 1,
            deliveryOrderSlabPerKmFee: 15,
            deliveryEngineMode: 'legacy',
            deliveryUseZones: false,
            zoneFallbackToLegacy: true,
            deliveryZones: [],
        };

        const configData = configDoc.exists ? configDoc.data() || {} : {};
        const settings = {
            ...defaults,
            ...parentData,
            ...configData,
        };

        return NextResponse.json(settings);

    } catch (error) {
        console.error("GET DELIVERY SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const { businessRef, businessId } = await verifyUserAndGetData(req);
        const updates = await req.json();
        const toFiniteNumber = (value, fallback = 0) => {
            if (value === '' || value === undefined) return fallback;
            const n = Number(value);
            return Number.isFinite(n) ? n : fallback;
        };
        const toNullableFiniteNumber = (value, fallback = null) => {
            if (value === '' || value === null || value === undefined) return fallback;
            const n = Number(value);
            return Number.isFinite(n) ? n : fallback;
        };

        // Whitelist allowed fields to prevent pollution
        const allowedFields = [
            'deliveryEnabled', 'deliveryRadius', 'deliveryFeeType',
            'deliveryFixedFee', 'deliveryPerKmFee', 'deliveryBaseDistance', 'deliveryFreeThreshold',
            'deliveryOnlinePaymentEnabled', 'deliveryCodEnabled',
            // NEW: Road factor & free zone
            'roadDistanceFactor', 'freeDeliveryRadius', 'freeDeliveryMinOrder',
            // NEW: Tiered charges
            'deliveryTiers',
            // NEW: Order slab + distance mode
            'deliveryOrderSlabRules', 'deliveryOrderSlabAboveFee', 'deliveryOrderSlabBaseDistance', 'deliveryOrderSlabPerKmFee',
            // Hybrid zone engine
            'deliveryEngineMode', 'deliveryUseZones', 'zoneFallbackToLegacy', 'deliveryZones'
        ];

        const cleanUpdates = {};
        allowedFields.forEach(field => {
            if (updates[field] !== undefined) cleanUpdates[field] = updates[field];
        });

        // Normalize numeric delivery fields for consistent downstream calculation.
        if (cleanUpdates.deliveryRadius !== undefined) cleanUpdates.deliveryRadius = toFiniteNumber(cleanUpdates.deliveryRadius, 5);
        if (cleanUpdates.deliveryFixedFee !== undefined) cleanUpdates.deliveryFixedFee = toFiniteNumber(cleanUpdates.deliveryFixedFee, 0);
        if (cleanUpdates.deliveryBaseDistance !== undefined) cleanUpdates.deliveryBaseDistance = toFiniteNumber(cleanUpdates.deliveryBaseDistance, 0);
        if (cleanUpdates.deliveryPerKmFee !== undefined) cleanUpdates.deliveryPerKmFee = toFiniteNumber(cleanUpdates.deliveryPerKmFee, 0);
        if (cleanUpdates.deliveryFreeThreshold !== undefined) cleanUpdates.deliveryFreeThreshold = toFiniteNumber(cleanUpdates.deliveryFreeThreshold, 0);
        if (cleanUpdates.roadDistanceFactor !== undefined) cleanUpdates.roadDistanceFactor = Math.max(1.0, toFiniteNumber(cleanUpdates.roadDistanceFactor, 1.0));
        if (cleanUpdates.freeDeliveryRadius !== undefined) cleanUpdates.freeDeliveryRadius = toFiniteNumber(cleanUpdates.freeDeliveryRadius, 0);
        if (cleanUpdates.freeDeliveryMinOrder !== undefined) cleanUpdates.freeDeliveryMinOrder = toFiniteNumber(cleanUpdates.freeDeliveryMinOrder, 0);
        if (Array.isArray(cleanUpdates.deliveryTiers)) {
            cleanUpdates.deliveryTiers = cleanUpdates.deliveryTiers.map(t => ({
                minOrder: toFiniteNumber(t?.minOrder, 0),
                fee: toFiniteNumber(t?.fee, 0),
            }));
        }
        if (cleanUpdates.deliveryOrderSlabAboveFee !== undefined) cleanUpdates.deliveryOrderSlabAboveFee = toFiniteNumber(cleanUpdates.deliveryOrderSlabAboveFee, 0);
        if (cleanUpdates.deliveryOrderSlabBaseDistance !== undefined) cleanUpdates.deliveryOrderSlabBaseDistance = Math.max(0, toFiniteNumber(cleanUpdates.deliveryOrderSlabBaseDistance, 1));
        if (cleanUpdates.deliveryOrderSlabPerKmFee !== undefined) cleanUpdates.deliveryOrderSlabPerKmFee = Math.max(0, toFiniteNumber(cleanUpdates.deliveryOrderSlabPerKmFee, 15));
        if (Array.isArray(cleanUpdates.deliveryOrderSlabRules)) {
            cleanUpdates.deliveryOrderSlabRules = cleanUpdates.deliveryOrderSlabRules
                .map(rule => ({
                    maxOrder: toFiniteNumber(rule?.maxOrder, 0),
                    fee: toFiniteNumber(rule?.fee, 0),
                }))
                .filter(rule => rule.maxOrder > 0)
                .sort((a, b) => a.maxOrder - b.maxOrder);
        }
        if (cleanUpdates.deliveryEngineMode !== undefined) cleanUpdates.deliveryEngineMode = String(cleanUpdates.deliveryEngineMode || 'legacy').trim() || 'legacy';
        if (cleanUpdates.deliveryUseZones !== undefined) cleanUpdates.deliveryUseZones = cleanUpdates.deliveryUseZones === true;
        if (cleanUpdates.zoneFallbackToLegacy !== undefined) cleanUpdates.zoneFallbackToLegacy = cleanUpdates.zoneFallbackToLegacy !== false;
        if (Array.isArray(cleanUpdates.deliveryZones)) {
            cleanUpdates.deliveryZones = cleanUpdates.deliveryZones.map((zone, index) => ({
                zone_id: String(zone?.zone_id || zone?.zoneId || zone?.id || ('zone_' + (index + 1))).trim(),
                name: String(zone?.name || zone?.zoneName || ('Zone ' + (index + 1))).trim(),
                boundary: normalizeBoundary(zone?.boundary),
                // Firestore rejects nested arrays, so we persist the flattened boundary source of truth.
                geojson: null,
                is_active: true,
                is_blocked: zone?.is_blocked === true || zone?.isBlocked === true,
                priority: toFiniteNumber(zone?.priority, index),
                baseFee: toFiniteNumber(zone?.baseFee, 0),
                color: String(zone?.color || '').trim() || null,
                scheduleMode: String(zone?.scheduleMode || zone?.schedule?.mode || 'always').trim().toLowerCase() === 'scheduled' ? 'scheduled' : 'always',
                scheduleStartTime: String(zone?.scheduleStartTime || zone?.schedule?.startTime || '09:00').trim() || '09:00',
                scheduleEndTime: String(zone?.scheduleEndTime || zone?.schedule?.endTime || '21:00').trim() || '21:00',
                scheduleDays: normalizeScheduleDays(zone?.scheduleDays || zone?.schedule?.days),
                scheduleTimezone: String(zone?.scheduleTimezone || zone?.schedule?.timezone || 'Asia/Kolkata').trim() || 'Asia/Kolkata',
                pricingTiers: Array.isArray(zone?.pricingTiers)
                    ? zone.pricingTiers.map((tier) => ({
                        minOrder: toFiniteNumber(tier?.minOrder, 0),
                        maxOrder: tier?.maxOrder === -1 ? -1 : toFiniteNumber(tier?.maxOrder, -1),
                        deliveryFee: toNullableFiniteNumber(tier?.deliveryFee ?? tier?.fee ?? tier?.amount, null),
                        feeAdjustment: toNullableFiniteNumber(tier?.feeAdjustment ?? tier?.adjustment, null),
                        label: String(tier?.label || '').trim(),
                    }))
                    : [],
            }));
        }

        cleanUpdates.updatedAt = new Date();

        await businessRef.collection('delivery_settings').doc('config').set(cleanUpdates, { merge: true });

        await businessRef.update({
            menuVersion: FieldValue.increment(1),
            updatedAt: new Date()
        });

        // Invalidate menu cache (legacy key)
        try {
            if (isKvConfigured()) {
                await kv.del(`menu:${businessId}`);
                console.log(`[Delivery Settings] ðŸ§¹ Invalidated cache for ${businessId}`);
            }
        } catch (e) {
            console.warn("Cache invalidation failed", e);
        }

        return NextResponse.json({ success: true, message: "Delivery settings updated" });

    } catch (error) {
        console.error("PATCH DELIVERY SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
