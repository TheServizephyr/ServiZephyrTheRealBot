
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { kv, isKvConfigured } from '@/lib/kv';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';
import { trackEndpointRead } from '@/lib/readTelemetry';
import { trackApiTelemetry } from '@/lib/opsTelemetry';
import { findBusinessById } from '@/services/business/businessService';
import { resolveGuestAccessRef } from '@/lib/public-auth';
import { buildLegacyMenuDataFromSnapshot, getFreshMenuSnapshot } from '@/lib/server/menuSnapshot';

// --- Analytics Badge Thresholds ---
// Strict thresholds to prevent badge inflation — only truly top-performing items qualify
const BADGE_LOOKBACK_DAYS = 7;           // Reduced from 30 to 7 to save 75% Firebase Reads
const BESTSELLER_MIN_UNITS = 15;         // Must have sold at least 15 units
const BESTSELLER_TOP_PERCENT = 0.05;     // Must be in top 5% of TOTAL menu items
const BESTSELLER_MAX_ITEMS = 5;          // Hard cap: max 5 bestsellers per restaurant

const HIGHLY_REORDERED_MIN_ORDERS = 8;   // Must appear in at least 8 separate orders
const HIGHLY_REORDERED_TOP_PERCENT = 0.10; // Must be in top 10% of TOTAL menu items
const HIGHLY_REORDERED_MAX_ITEMS = 10;   // Hard cap: max 10 highly reordered items

const LOST_ORDER_STATUSES_FOR_BADGE = new Set(['rejected', 'cancelled', 'failed_delivery', 'returned_to_restaurant']);

/**
 * Compute insightBadge for each menu item based on ALL sales channels:
 * - Online orders (delivery, pickup, dine-in, car-order, manual call) → `orders` collection
 * - Walk-in counter bills (offline billing) → `{businessCollection}/{businessId}/custom_bill_history`
 *
 * Returns a Map<itemName (lowercase), badge> for O(1) lookup.
 */
async function computeInsightBadges(firestore, restaurantId, businessRef, totalActiveMenuItems = 0) {
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - BADGE_LOOKBACK_DAYS);
        cutoff.setHours(0, 0, 0, 0);

        // Fetch both data sources in parallel for speed
        const [ordersSnap, counterBillsSnap] = await Promise.all([
            // SOURCE 1: All online & digital orders (delivery, pickup, dine-in, manual call, car-order)
            firestore
                .collection('orders')
                .where('restaurantId', '==', restaurantId)
                .where('orderDate', '>=', cutoff)
                .select('status', 'items')
                .get(),

            // SOURCE 2: Walk-in counter / offline bills (offline billing, dine-in counter)
            businessRef
                ? businessRef
                    .collection('custom_bill_history')
                    .where('printedAt', '>=', cutoff)
                    .select('items')
                    .get()
                : Promise.resolve(null),
        ]);

        let totalValidOrders = 0;
        // unitsSold: name_lower -> total quantity sold (across ALL channels)
        // orderCount: name_lower -> number of separate sale events this item appeared in
        const unitsSold = {};
        const orderCount = {};

        function processItems(items, txnKey) {
            const seenInThisTxn = new Set();
            items.forEach((item) => {
                const rawName = String(item?.name || '').split(' (')[0].trim();
                if (!rawName) return;
                const nameKey = rawName.toLowerCase();
                
                // Exclude staple items like breads and bottled water from dominating analytics badges
                if (/roti|naan|paratha|kulcha|chapati|bread|papad|water bottle|mineral water/i.test(nameKey)) return;
                const qty = Math.max(1, Number(item?.quantity) || 1);
                unitsSold[nameKey] = (unitsSold[nameKey] || 0) + qty;
                if (!seenInThisTxn.has(nameKey)) {
                    seenInThisTxn.add(nameKey);
                    orderCount[nameKey] = (orderCount[nameKey] || 0) + 1;
                }
            });
        }

        // Process regular orders (skip cancelled/rejected)
        ordersSnap.forEach((doc) => {
            const data = doc.data();
            if (LOST_ORDER_STATUSES_FOR_BADGE.has(String(data.status || '').toLowerCase())) return;
            totalValidOrders++;
            const items = Array.isArray(data.items) ? data.items : [];
            processItems(items, doc.id);
        });

        // Process counter bills (no status to skip — counter bills are always completed sales)
        if (counterBillsSnap) {
            counterBillsSnap.forEach((doc) => {
                totalValidOrders++;
                const data = doc.data();
                const items = Array.isArray(data.items) ? data.items : [];
                processItems(items, doc.id);
            });
        }
        
        // Dynamic volume thresholds based on 30-day activity (minimum floors maintained for small operations)
        // Adjusting multipliers down: In a diverse menu, even the top item rarely appears in >10% of ALL orders globally.
        // - Bestseller: Must have sold units equal to at least 5% of total orders
        // - Highly Reordered: Must appear in at least 4% of all separate orders
        const dynamicBestsellerMinUnits = Math.max(BESTSELLER_MIN_UNITS, Math.ceil(totalValidOrders * 0.05));
        const dynamicHighlyReorderedMinOrders = Math.max(HIGHLY_REORDERED_MIN_ORDERS, Math.ceil(totalValidOrders * 0.04));

        // Compute Bestseller threshold: strictly dynamically relative to total active menu items
        const allUnitValues = Object.values(unitsSold).filter(v => v >= dynamicBestsellerMinUnits);
        allUnitValues.sort((a, b) => b - a);

        let allowedBestsellers = Math.max(1, Math.ceil(totalActiveMenuItems * BESTSELLER_TOP_PERCENT));
        if (allowedBestsellers > BESTSELLER_MAX_ITEMS) allowedBestsellers = BESTSELLER_MAX_ITEMS;
        if (totalActiveMenuItems === 0) allowedBestsellers = Math.max(1, Math.ceil(allUnitValues.length * BESTSELLER_TOP_PERCENT));

        const bestsellerThreshold = allUnitValues.length > 0 ? (allUnitValues[allowedBestsellers - 1] || 0) : Infinity;

        const badgeMap = new Map();

        // Sort entries by units sold descending so top performers are assigned first
        const sortedUnitsSold = Object.entries(unitsSold).sort((a, b) => b[1] - a[1]);
        
        // Assign Bestseller first (higher priority)
        for (const [nameKey, units] of sortedUnitsSold) {
            if (units >= dynamicBestsellerMinUnits && units >= bestsellerThreshold) {
                if (badgeMap.size < allowedBestsellers) {
                    badgeMap.set(nameKey, 'Bestseller');
                }
            }
        }

        // Compute Highly Reordered threshold explicitly based on total menu items
        const allOrderValues = Object.values(orderCount).filter(v => v >= dynamicHighlyReorderedMinOrders);
        allOrderValues.sort((a, b) => b - a);
        
        let allowedHighlyReordered = Math.max(1, Math.ceil(totalActiveMenuItems * HIGHLY_REORDERED_TOP_PERCENT));
        if (allowedHighlyReordered > HIGHLY_REORDERED_MAX_ITEMS) allowedHighlyReordered = HIGHLY_REORDERED_MAX_ITEMS;
        if (totalActiveMenuItems === 0) allowedHighlyReordered = Math.max(1, Math.ceil(allOrderValues.length * 0.15));

        const highlyReorderedThreshold = allOrderValues.length > 0 ? (allOrderValues[allowedHighlyReordered - 1] || 0) : Infinity;

        let highlyReorderedAssigned = 0;
        const sortedOrderCount = Object.entries(orderCount).sort((a, b) => b[1] - a[1]);

        // Assign Highly Reordered to items not already marked as Bestseller
        for (const [nameKey, count] of sortedOrderCount) {
            if (count >= dynamicHighlyReorderedMinOrders && count >= highlyReorderedThreshold && !badgeMap.has(nameKey)) {
                if (highlyReorderedAssigned < allowedHighlyReordered) {
                    badgeMap.set(nameKey, 'Highly Reordered');
                    highlyReorderedAssigned++;
                }
            }
        }

        return badgeMap;
    } catch (err) {
        // Non-critical: if badge computation fails, just return empty (no badges shown)
        console.warn('[Menu API] Badge computation failed (non-critical):', err?.message || err);
        return new Map();
    }
}

export const dynamic = 'force-dynamic';
// Removed revalidate=0 to allow CDN caching aligned with Cache-Control headers below
const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';
const BUSINESS_COLLECTION_CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const MENU_MEMORY_CACHE_TTL_MS = 30 * 1000;
const MENU_MEMORY_CACHE_MAX_ENTRIES = 200;
const ENABLE_PUBLIC_MENU_INSIGHT_BADGES = process.env.ENABLE_PUBLIC_MENU_INSIGHT_BADGES === 'true';
const MENU_BADGE_CACHE_TTL_SECONDS = Math.max(5 * 60, Number(process.env.PUBLIC_MENU_INSIGHT_BADGES_TTL_SECONDS || (24 * 60 * 60)) || (24 * 60 * 60));
const MENU_BADGE_MEMORY_CACHE_TTL_MS = 15 * 60 * 1000;
const MENU_BADGE_MEMORY_CACHE_MAX_ENTRIES = 200;
const MENU_SUPPORT_CACHE_TTL_SECONDS = Math.max(60, Number(process.env.PUBLIC_MENU_SUPPORT_CACHE_TTL_SECONDS || (5 * 60)) || (5 * 60));
const MENU_SUPPORT_MEMORY_CACHE_TTL_MS = 60 * 1000;
const MENU_SUPPORT_MEMORY_CACHE_MAX_ENTRIES = 400;
const isMenuApiDebugEnabled = process.env.DEBUG_MENU_API === 'true';
const debugLog = (...args) => {
    if (isMenuApiDebugEnabled) {
        console.log(...args);
    }
};

function getMenuMemoryCacheStore() {
    if (!globalThis.__menuApiL1Cache) {
        globalThis.__menuApiL1Cache = new Map();
    }
    return globalThis.__menuApiL1Cache;
}

function readMenuFromMemoryCache(cacheKey) {
    const store = getMenuMemoryCacheStore();
    const entry = store.get(cacheKey);
    if (!entry) return null;
    if (!entry.expiresAt || entry.expiresAt < Date.now()) {
        store.delete(cacheKey);
        return null;
    }
    return entry.value || null;
}

function writeMenuToMemoryCache(cacheKey, value) {
    if (!cacheKey || !value) return;
    const store = getMenuMemoryCacheStore();
    if (store.size >= MENU_MEMORY_CACHE_MAX_ENTRIES) {
        const oldestKey = store.keys().next().value;
        if (oldestKey) store.delete(oldestKey);
    }
    store.set(cacheKey, {
        value,
        expiresAt: Date.now() + MENU_MEMORY_CACHE_TTL_MS,
    });
}

function getMenuBadgeMemoryCacheStore() {
    if (!globalThis.__menuApiBadgeL1Cache) {
        globalThis.__menuApiBadgeL1Cache = new Map();
    }
    return globalThis.__menuApiBadgeL1Cache;
}

function readMenuBadgeFromMemoryCache(cacheKey) {
    const store = getMenuBadgeMemoryCacheStore();
    const entry = store.get(cacheKey);
    if (!entry) return null;
    if (!entry.expiresAt || entry.expiresAt < Date.now()) {
        store.delete(cacheKey);
        return null;
    }
    return entry.value || null;
}

function writeMenuBadgeToMemoryCache(cacheKey, value) {
    if (!cacheKey || !value || typeof value !== 'object') return;
    const store = getMenuBadgeMemoryCacheStore();
    if (store.size >= MENU_BADGE_MEMORY_CACHE_MAX_ENTRIES) {
        const oldestKey = store.keys().next().value;
        if (oldestKey) store.delete(oldestKey);
    }
    store.set(cacheKey, {
        value,
        expiresAt: Date.now() + MENU_BADGE_MEMORY_CACHE_TTL_MS,
    });
}

function getMenuSupportMemoryCacheStore() {
    if (!globalThis.__menuApiSupportL1Cache) {
        globalThis.__menuApiSupportL1Cache = new Map();
    }
    return globalThis.__menuApiSupportL1Cache;
}

function readMenuSupportFromMemoryCache(cacheKey) {
    const store = getMenuSupportMemoryCacheStore();
    const entry = store.get(cacheKey);
    if (!entry) return null;
    if (!entry.expiresAt || entry.expiresAt < Date.now()) {
        store.delete(cacheKey);
        return null;
    }
    return entry.value;
}

function writeMenuSupportToMemoryCache(cacheKey, value) {
    if (!cacheKey) return;
    const store = getMenuSupportMemoryCacheStore();
    if (store.size >= MENU_SUPPORT_MEMORY_CACHE_MAX_ENTRIES) {
        const oldestKey = store.keys().next().value;
        if (oldestKey) store.delete(oldestKey);
    }
    store.set(cacheKey, {
        value,
        expiresAt: Date.now() + MENU_SUPPORT_MEMORY_CACHE_TTL_MS,
    });
}

function serializeInsightBadgeMap(map) {
    if (!(map instanceof Map) || map.size === 0) return {};
    return Object.fromEntries(map.entries());
}

function deserializeInsightBadgePayload(payload) {
    if (!payload || typeof payload !== 'object') return new Map();
    return new Map(
        Object.entries(payload).filter(([key, value]) => String(key || '').trim() && String(value || '').trim())
    );
}

function splitCachedMenuPayload(cachedData = {}) {
    const payload = cachedData && typeof cachedData === 'object' ? cachedData : {};
    const { __couponCatalog = [], ...publicPayload } = payload;
    return {
        publicPayload,
        couponCatalog: Array.isArray(__couponCatalog) ? __couponCatalog : [],
    };
}

async function getCachedInsightBadgeMap({
    firestore,
    restaurantId,
    businessRef,
    totalActiveMenuItems = 0,
    cacheKey,
    isKvAvailable = false,
}) {
    if (!ENABLE_PUBLIC_MENU_INSIGHT_BADGES) {
        return new Map();
    }

    const memoryPayload = readMenuBadgeFromMemoryCache(cacheKey);
    if (memoryPayload) {
        return deserializeInsightBadgePayload(memoryPayload);
    }

    if (isKvAvailable) {
        try {
            const cachedPayload = await kv.get(cacheKey);
            if (cachedPayload && typeof cachedPayload === 'object') {
                writeMenuBadgeToMemoryCache(cacheKey, cachedPayload);
                return deserializeInsightBadgePayload(cachedPayload);
            }
        } catch (cacheErr) {
            console.warn(`[Menu API] Badge cache read failed for ${restaurantId}:`, cacheErr?.message || cacheErr);
        }
    }

    const computedMap = await computeInsightBadges(firestore, restaurantId, businessRef, totalActiveMenuItems);
    const serializedPayload = serializeInsightBadgeMap(computedMap);
    writeMenuBadgeToMemoryCache(cacheKey, serializedPayload);
    if (isKvAvailable) {
        void kv.set(cacheKey, serializedPayload, { ex: MENU_BADGE_CACHE_TTL_SECONDS }).catch((cacheErr) => {
            console.warn(`[Menu API] Badge cache write failed for ${restaurantId}:`, cacheErr?.message || cacheErr);
        });
    }
    return computedMap;
}

async function getCachedMenuSupportData({
    cacheKey,
    isKvAvailable = false,
    load,
}) {
    const memoryPayload = readMenuSupportFromMemoryCache(cacheKey);
    if (memoryPayload !== null && memoryPayload !== undefined) {
        return { value: memoryPayload, source: 'memory', readCount: 0 };
    }

    if (isKvAvailable) {
        try {
            const cachedPayload = await kv.get(cacheKey);
            if (cachedPayload !== null && cachedPayload !== undefined) {
                writeMenuSupportToMemoryCache(cacheKey, cachedPayload);
                return { value: cachedPayload, source: 'kv', readCount: 0 };
            }
        } catch (cacheErr) {
            console.warn(`[Menu API] Support cache read failed for ${cacheKey}:`, cacheErr?.message || cacheErr);
        }
    }

    const loaded = await load();
    writeMenuSupportToMemoryCache(cacheKey, loaded.value);
    if (isKvAvailable) {
        void kv.set(cacheKey, loaded.value, { ex: MENU_SUPPORT_CACHE_TTL_SECONDS }).catch((cacheErr) => {
            console.warn(`[Menu API] Support cache write failed for ${cacheKey}:`, cacheErr?.message || cacheErr);
        });
    }
    return {
        value: loaded.value,
        source: 'firestore',
        readCount: Math.max(0, Number(loaded.readCount) || 0),
    };
}

function normalizeMenuSource(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function decodeUrlComponentRecursively(value, maxPasses = 3) {
    let normalized = String(value || '').trim();
    for (let i = 0; i < maxPasses; i += 1) {
        try {
            const decoded = decodeURIComponent(normalized);
            if (!decoded || decoded === normalized) break;
            normalized = decoded;
        } catch {
            break;
        }
    }
    return normalized;
}

function normalizePhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
}

async function resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams }) {
    const eligibleIds = new Set();
    const normalizedPhone = normalizePhone(searchParams.get('phone'));
    const ref = String(searchParams.get('ref') || '').trim();

    if (ref) {
        try {
            const refSession = await resolveGuestAccessRef(firestore, ref, { allowLegacy: true });
            if (refSession?.subjectId) {
                eligibleIds.add(String(refSession.subjectId));
            }
            const refPhone = normalizePhone(refSession?.phone);
            if (refPhone) {
                eligibleIds.add(`phone:${refPhone}`);
            }
        } catch (error) {
            console.warn('[Menu API] Could not resolve reward ref:', error?.message || error);
        }
    }

    if (normalizedPhone) {
        eligibleIds.add(`phone:${normalizedPhone}`);
    }

    if (!businessRef || eligibleIds.size === 0) {
        return eligibleIds;
    }

    const lookupPhones = [...eligibleIds]
        .filter((value) => value.startsWith('phone:'))
        .map((value) => value.slice('phone:'.length));

    for (const phone of lookupPhones) {
        try {
            const [phoneSnap, phoneNumberSnap, directDocSnap] = await Promise.all([
                businessRef.collection('customers').where('phone', '==', phone).limit(10).get(),
                businessRef.collection('customers').where('phoneNumber', '==', phone).limit(10).get(),
                businessRef.collection('customers').doc(phone).get(),
            ]);

            const matches = new Map();
            phoneSnap.forEach((doc) => matches.set(doc.id, doc));
            phoneNumberSnap.forEach((doc) => matches.set(doc.id, doc));
            if (directDocSnap.exists) {
                matches.set(directDocSnap.id, directDocSnap);
            }

            matches.forEach((doc) => {
                eligibleIds.add(String(doc.id));
                const customerData = doc.data() || {};
                if (customerData.customerId) eligibleIds.add(String(customerData.customerId));
                if (customerData.userId) eligibleIds.add(String(customerData.userId));
                if (customerData.uid) eligibleIds.add(String(customerData.uid));
            });
        } catch (error) {
            console.warn('[Menu API] Phone based reward lookup failed:', error?.message || error);
        }
    }

    return eligibleIds;
}

function filterCouponsForRequest(couponDocs = [], now = new Date(), eligibleCustomerIds = new Set()) {
    return couponDocs.filter((coupon) => {
        const startDate = coupon.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon.startDate);
        const expiryDate = coupon.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon.expiryDate);
        const assignedCustomerId = String(coupon.customerId || '').trim();
        const isPublic = !assignedCustomerId;
        const isAssignedToCurrentCustomer = assignedCustomerId && eligibleCustomerIds.has(assignedCustomerId);
        const isValid = startDate <= now && expiryDate >= now;

        debugLog('[Menu API] Coupon', coupon.code, '- valid:', isValid, 'public:', isPublic, 'assigned:', isAssignedToCurrentCustomer, 'start:', startDate, 'expiry:', expiryDate);

        return isValid && (isPublic || isAssignedToCurrentCustomer);
    });
}

function buildRestaurantIdCandidates(value) {
    const seed = String(value || '').trim();
    if (!seed) return [];

    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
        const normalized = String(candidate || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };

    add(seed);

    let decoded = seed;
    for (let i = 0; i < 2; i += 1) {
        try {
            const next = decodeURIComponent(decoded);
            if (!next || next === decoded) break;
            add(next);
            decoded = next;
        } catch {
            break;
        }
    }

    for (const candidate of [...candidates]) {
        try {
            const encoded = encodeURIComponent(candidate);
            if (encoded !== candidate) add(encoded);
        } catch {
            // Keep existing candidates
        }
    }

    return candidates;
}

async function resolveBusinessWithCollectionCache({ firestore, restaurantId, isKvAvailable }) {
    const collectionsToTry = ['restaurants', 'street_vendors', 'shops'];
    const cacheKey = `business_collection:${restaurantId}`;

    if (isKvAvailable) {
        try {
            const cachedCollection = await kv.get(cacheKey);
            if (cachedCollection && collectionsToTry.includes(cachedCollection)) {
                const cachedDocRef = firestore.collection(cachedCollection).doc(restaurantId);
                const cachedDocSnap = await cachedDocRef.get();
                if (cachedDocSnap.exists) {
                    return {
                        winner: {
                            collectionName: cachedCollection,
                            businessRef: cachedDocRef,
                            businessData: cachedDocSnap.data(),
                            version: cachedDocSnap.data().menuVersion || 1
                        },
                        foundDocs: [{
                            collectionName: cachedCollection,
                            businessRef: cachedDocRef,
                            businessData: cachedDocSnap.data(),
                            version: cachedDocSnap.data().menuVersion || 1
                        }],
                        usedCollectionCache: true
                    };
                }
            }
        } catch (cacheErr) {
            console.warn(`[Menu API] Collection cache read failed for ${restaurantId}:`, cacheErr?.message || cacheErr);
        }
    }

    const results = await Promise.all(
        collectionsToTry.map(async (name) => {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            return { name, docRef, docSnap };
        })
    );

    const foundDocs = results
        .filter(r => r.docSnap.exists)
        .map(r => ({
            collectionName: r.name,
            businessRef: r.docRef,
            businessData: r.docSnap.data(),
            version: r.docSnap.data().menuVersion || 1
        }));

    if (foundDocs.length === 0) {
        return { winner: null, foundDocs: [], usedCollectionCache: false };
    }

    foundDocs.sort((a, b) => b.version - a.version);
    const winner = foundDocs[0];

    if (isKvAvailable) {
        try {
            await kv.set(cacheKey, winner.collectionName, { ex: BUSINESS_COLLECTION_CACHE_TTL_SECONDS });
        } catch (cacheErr) {
            console.warn(`[Menu API] Collection cache write failed for ${restaurantId}:`, cacheErr?.message || cacheErr);
        }
    }

    return { winner, foundDocs, usedCollectionCache: false };
}

async function resolveBusinessAcrossCandidates({ firestore, restaurantIds, isKvAvailable }) {
    for (const candidateRestaurantId of restaurantIds) {
        const resolved = await resolveBusinessWithCollectionCache({
            firestore,
            restaurantId: candidateRestaurantId,
            isKvAvailable,
        });
        if (resolved?.winner) {
            return {
                ...resolved,
                resolvedRestaurantId: candidateRestaurantId,
            };
        }
    }

    return {
        winner: null,
        foundDocs: [],
        usedCollectionCache: false,
        resolvedRestaurantId: restaurantIds[0] || null,
    };
}

export async function GET(req, { params }) {
    const telemetryStartedAt = Date.now();
    let telemetryStatus = 200;
    let telemetryError = null;

    const requestedRestaurantId = String(params?.restaurantId || '').trim();
    const canonicalRestaurantId = decodeUrlComponentRecursively(requestedRestaurantId);
    const restaurantIdCandidates = buildRestaurantIdCandidates(canonicalRestaurantId);
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const ref = searchParams.get('ref');
    const token = searchParams.get('token');
    const menuSource = normalizeMenuSource(searchParams.get('src'));
    const telemetryEndpoint = menuSource ? `api.public.menu.${menuSource}` : 'api.public.menu';
    const firestore = await getFirestore();
    const personalizedRequest = Boolean(normalizePhone(phone) || String(ref || '').trim() || String(token || '').trim());
    const respond = (payload, status = 200, headers = undefined) => {
        telemetryStatus = status;
        return NextResponse.json(payload, {
            status,
            ...(headers ? { headers } : {}),
        });
    };

    if (!requestedRestaurantId) {
        return respond({ message: 'Restaurant ID is required.' }, 400);
    }

    debugLog(`[Menu API] 🚀 START - Request received for restaurantId: ${requestedRestaurantId} (canonical: ${canonicalRestaurantId}) at ${new Date().toISOString()}`);

    // Cache is available if either primary Vercel KV or secondary Upstash is configured.
    const hasKvConfigured = isKvConfigured();
    let isKvAvailable = hasKvConfigured;

    try {
        // STEP 1: Resolve business collection (cache-first, fallback to multi-collection lookup)
        const { winner, foundDocs, usedCollectionCache, resolvedRestaurantId } = await resolveBusinessAcrossCandidates({
            firestore,
            restaurantIds: restaurantIdCandidates,
            isKvAvailable
        });

        let cacheRestaurantId = resolvedRestaurantId || canonicalRestaurantId;
        let resolvedWinner = winner;
        let resolvedFoundDocs = foundDocs;
        let resolvedUsedCollectionCache = usedCollectionCache;

        if (!resolvedWinner) {
            const fallbackBusiness = await findBusinessById(firestore, canonicalRestaurantId, {
                includeDeliverySettings: false,
            });
            if (fallbackBusiness?.ref) {
                const fallbackSnapshot = await fallbackBusiness.ref.get();
                if (fallbackSnapshot.exists) {
                    const fallbackData = fallbackSnapshot.data();
                    const fallbackVersion = fallbackData?.menuVersion || 1;
                    cacheRestaurantId = fallbackSnapshot.id;
                    resolvedWinner = {
                        collectionName: fallbackBusiness.collection || fallbackBusiness.ref.parent.id,
                        businessRef: fallbackBusiness.ref,
                        businessData: fallbackData,
                        version: fallbackVersion,
                    };
                    resolvedFoundDocs = [resolvedWinner];
                    resolvedUsedCollectionCache = false;
                }
            }
        }

        if (!resolvedWinner) {
            debugLog(`[Menu API] ❌ Business not found for ${requestedRestaurantId} in any collection`);
            return respond({ message: 'Business not found.' }, 404);
        }

        let businessData = resolvedWinner.businessData;
        let businessRef = resolvedWinner.businessRef;
        let collectionName = resolvedWinner.collectionName;
        let menuVersion = resolvedWinner.version;

        if (!resolvedUsedCollectionCache && resolvedFoundDocs.length > 1) {
            console.warn(`[Menu API] ⚠️ DUPLICATE DATA DETECTED for ${cacheRestaurantId}`);
            resolvedFoundDocs.forEach(d => debugLog(`   - Found in ${d.collectionName} (v${d.version})`));
            debugLog(`   ✅ Selected winner: ${collectionName} (v${menuVersion})`);
        } else if (resolvedUsedCollectionCache) {
            debugLog(`[Menu API] ✅ Collection cache hit: ${collectionName} (v${menuVersion})`);
        } else {
            debugLog(`[Menu API] ✅ Found active business in ${collectionName} (v${menuVersion})`);
        }

        const effectiveIsOpen = getEffectiveBusinessOpenStatus(businessData);

        // STEP 2: Build version-based cache key
        // PATCH: Added _patch8 to force cache refresh for dynamic relative volume thresholds (Min orders scaled by traffic)
        const cacheKey = `menu:${cacheRestaurantId}:v${menuVersion}_patch8`;
        const insightBadgeCacheKey = `menu_badges:${cacheRestaurantId}:v${menuVersion}_patch1`;
        const couponCatalogCacheKey = `menu_coupon_catalog:${cacheRestaurantId}`;
        const deliveryConfigCacheKey = `menu_delivery_config:${cacheRestaurantId}`;
        const customCategoriesCacheKey = `menu_custom_categories:${cacheRestaurantId}`;
        const skipCache = searchParams.get('skip_cache') === 'true';

        // 🔍 PROOF: Show Redis cache usage and menuVersion
        debugLog(`%c[Menu API] 📊 CACHE DEBUG`, 'color: cyan; font-weight: bold');
        debugLog(`[Menu API]    ├─ Restaurant: ${cacheRestaurantId}`);
        debugLog(`[Menu API]    ├─ menuVersion from Firestore: ${menuVersion}`);
        debugLog(`[Menu API]    ├─ Generated cache key: ${cacheKey}`);
        debugLog(`[Menu API]    ├─ Redis KV available: ${isKvAvailable ? '✅ YES' : '❌ NO'}`);
        debugLog(`[Menu API]    ├─ Skip Cache Requested: ${skipCache ? '⚠️ YES' : 'NO'}`);
        debugLog(`[Menu API]    └─ Timestamp: ${new Date().toISOString()}`);

        if (!skipCache) {
            try {
                const snapshot = await getFreshMenuSnapshot({
                    firestore,
                    businessId: cacheRestaurantId,
                    collectionNameHint: collectionName,
                    allowInlineRebuild: true,
                });

                if (snapshot?.menu) {
                    const publicPayload = buildLegacyMenuDataFromSnapshot(snapshot);
                    const couponCatalog = Array.isArray(snapshot.couponCatalog) ? snapshot.couponCatalog : [];
                    let payload = {
                        ...publicPayload,
                        isOpen: effectiveIsOpen,
                        autoScheduleEnabled: businessData.autoScheduleEnabled === true,
                        openingTime: businessData.openingTime || '09:00',
                        closingTime: businessData.closingTime || '22:00',
                        timeZone: businessData.timeZone || businessData.timezone || 'Asia/Kolkata',
                    };

                    if (personalizedRequest) {
                        const hasAssignedCoupons = couponCatalog.some((coupon) => String(coupon?.customerId || '').trim());
                        if (couponCatalog.length > 0 && hasAssignedCoupons) {
                            const eligibleCustomerIds = await resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams });
                            payload = {
                                ...payload,
                                coupons: filterCouponsForRequest(couponCatalog, new Date(), eligibleCustomerIds),
                            };
                        }
                    }

                    const cacheableResponseData = {
                        ...publicPayload,
                        __couponCatalog: couponCatalog,
                    };
                    writeMenuToMemoryCache(cacheKey, cacheableResponseData);
                    if (isKvAvailable) {
                        void kv.set(cacheKey, cacheableResponseData, { ex: 43200 }).catch((cacheError) => {
                            console.warn('[Menu API] Snapshot cache storage failed:', cacheError?.message || cacheError);
                        });
                    }

                    await trackEndpointRead(telemetryEndpoint, 1);
                    return respond(payload, 200, {
                        'X-Cache': 'SNAPSHOT',
                        'X-Menu-Version': menuVersion.toString(),
                        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
                        'Vary': 'Accept-Encoding',
                    });
                }
            } catch (snapshotError) {
                console.warn('[Menu API] Snapshot path failed, continuing with raw menu flow:', snapshotError?.message || snapshotError);
            }
        }

        // STEP 3: Check Redis cache with version-specific key
        // Even personalized requests can reuse the cached base menu payload; we
        // only refresh the customer-specific coupon subset on top of that.
        if (!skipCache) {
            const l1CacheData = readMenuFromMemoryCache(cacheKey);
            if (l1CacheData) {
                debugLog(`%c[Menu API] ✅ L1 CACHE HIT`, 'color: #22c55e; font-weight: bold');
                const { publicPayload, couponCatalog } = splitCachedMenuPayload(l1CacheData);
                let payload = {
                    ...publicPayload,
                    isOpen: effectiveIsOpen,
                    autoScheduleEnabled: businessData.autoScheduleEnabled === true,
                    openingTime: businessData.openingTime || '09:00',
                    closingTime: businessData.closingTime || '22:00',
                    timeZone: businessData.timeZone || businessData.timezone || 'Asia/Kolkata',
                };
                if (personalizedRequest) {
                    const hasAssignedCoupons = couponCatalog.some((coupon) => String(coupon?.customerId || '').trim());
                    if (couponCatalog.length > 0 && !hasAssignedCoupons) {
                        payload = {
                            ...payload,
                            coupons: publicPayload.coupons || [],
                        };
                        await trackEndpointRead(telemetryEndpoint, 1);
                    } else if (couponCatalog.length > 0) {
                        const eligibleCustomerIds = await resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams });
                        payload = {
                            ...payload,
                            coupons: filterCouponsForRequest(couponCatalog, new Date(), eligibleCustomerIds),
                        };
                        await trackEndpointRead(telemetryEndpoint, 1);
                    } else {
                        const [couponsSnap, eligibleCustomerIds] = await Promise.all([
                            businessRef.collection('coupons').where('status', '==', 'active').get(),
                            resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams })
                        ]);
                        const couponDocs = couponsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        payload = {
                            ...payload,
                            coupons: filterCouponsForRequest(couponDocs, new Date(), eligibleCustomerIds),
                        };
                        await trackEndpointRead(telemetryEndpoint, 1 + couponsSnap.size);
                    }
                } else {
                    await trackEndpointRead(telemetryEndpoint, 1);
                }
                return respond(payload, 200, {
                    'X-Cache': 'L1-HIT',
                    'X-Menu-Version': menuVersion.toString(),
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
                    'Vary': 'Accept-Encoding'
                });
            }
        }

        if (isKvAvailable && !skipCache) {
            try {
                const cachedData = await kv.get(cacheKey);
                if (cachedData) {
                    debugLog(`%c[Menu API] ✅ CACHE HIT`, 'color: green; font-weight: bold');
                    debugLog(`[Menu API]    └─ Serving from Redis cache for key: ${cacheKey}`);
                    writeMenuToMemoryCache(cacheKey, cachedData);
                    const { publicPayload, couponCatalog } = splitCachedMenuPayload(cachedData);
                    let payload = {
                        ...publicPayload,
                        isOpen: effectiveIsOpen,
                        autoScheduleEnabled: businessData.autoScheduleEnabled === true,
                        openingTime: businessData.openingTime || '09:00',
                        closingTime: businessData.closingTime || '22:00',
                        timeZone: businessData.timeZone || businessData.timezone || 'Asia/Kolkata',
                    };
                    if (personalizedRequest) {
                        const hasAssignedCoupons = couponCatalog.some((coupon) => String(coupon?.customerId || '').trim());
                        if (couponCatalog.length > 0 && !hasAssignedCoupons) {
                            payload = {
                                ...payload,
                                coupons: publicPayload.coupons || [],
                            };
                            await trackEndpointRead(telemetryEndpoint, 1);
                        } else if (couponCatalog.length > 0) {
                            const eligibleCustomerIds = await resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams });
                            payload = {
                                ...payload,
                                coupons: filterCouponsForRequest(couponCatalog, new Date(), eligibleCustomerIds),
                            };
                            await trackEndpointRead(telemetryEndpoint, 1);
                        } else {
                            const [couponsSnap, eligibleCustomerIds] = await Promise.all([
                                businessRef.collection('coupons').where('status', '==', 'active').get(),
                                resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams })
                            ]);
                            const couponDocs = couponsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                            payload = {
                                ...payload,
                                coupons: filterCouponsForRequest(couponDocs, new Date(), eligibleCustomerIds),
                            };
                            await trackEndpointRead(telemetryEndpoint, 1 + couponsSnap.size);
                        }
                    } else {
                        await trackEndpointRead(telemetryEndpoint, 1);
                    }

                    return respond(payload, 200, {
                        'X-Cache': 'HIT',
                        'X-Menu-Version': menuVersion.toString(),
                        // CDN Cache: Fresh for 60s, serve stale for 10m
                        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
                        'Vary': 'Accept-Encoding'
                    });
                }
                debugLog(`%c[Menu API] ❌ CACHE MISS`, 'color: red; font-weight: bold');
                debugLog(`[Menu API]    └─ Fetching from Firestore for key: ${cacheKey}`);
            } catch (cacheReadErr) {
                isKvAvailable = false;
                console.warn(`[Menu API] KV read failed; falling back to Firestore for ${cacheRestaurantId}:`, cacheReadErr?.message || cacheReadErr);
            }
        } else {
            debugLog(`[Menu API] ⚠️ KV cache layer not configured - skipping cache for ${cacheRestaurantId}`);
        }

        // STEP 4: Cache miss - fetch from Firestore
        debugLog(`[Menu API] ✅ Found business: ${businessData.name}`);
        debugLog(`[Menu API] 📂 SOURCE COLLECTION: ${collectionName} (Critical Check)`);
        debugLog(`[Menu API] 🟢 isOpen status in DB: ${businessData.isOpen}`);
        debugLog(`[Menu API] 🔍 Querying coupons with status='active' from ${collectionName}/${cacheRestaurantId}/coupons`);

        // Fetch menu first, then hydrate supporting datasets from short-lived
        // support caches so a base menu miss does not always fan out into extra
        // Firestore reads for coupons/settings/categories.
        const [menuSnap, couponCatalogResult, deliveryConfigResult, customCategoriesResult] = await Promise.all([
            businessRef.collection('menu').get(),
            getCachedMenuSupportData({
                cacheKey: couponCatalogCacheKey,
                isKvAvailable,
                load: async () => {
                    const couponsSnap = await businessRef.collection('coupons').where('status', '==', 'active').get();
                    return {
                        value: couponsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
                        readCount: couponsSnap.size,
                    };
                },
            }),
            getCachedMenuSupportData({
                cacheKey: deliveryConfigCacheKey,
                isKvAvailable,
                load: async () => {
                    const deliveryConfigSnap = await businessRef.collection('delivery_settings').doc('config').get();
                    return {
                        value: {
                            exists: deliveryConfigSnap.exists,
                            data: deliveryConfigSnap.exists ? deliveryConfigSnap.data() : null,
                        },
                        readCount: 1,
                    };
                },
            }),
            getCachedMenuSupportData({
                cacheKey: customCategoriesCacheKey,
                isKvAvailable,
                load: async () => {
                    const customCatSnap = await businessRef.collection('custom_categories').orderBy('order', 'asc').get();
                    return {
                        value: customCatSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
                        readCount: customCatSnap.size,
                    };
                },
            }),
        ]);

        const couponDocs = Array.isArray(couponCatalogResult?.value) ? couponCatalogResult.value : [];
        debugLog(`[Menu API] 📊 Coupons available: ${couponDocs.length} (source: ${couponCatalogResult?.source || 'unknown'})`);

        // Check delivery settings
        const deliveryConfigState = deliveryConfigResult?.value || { exists: false, data: null };
        const deliveryConfig = deliveryConfigState.exists ? (deliveryConfigState.data || {}) : {};
        debugLog(`[Menu API] 🚚 Delivery Config found: ${deliveryConfigState.exists}`, deliveryConfigState.exists ? deliveryConfig : '(using legacy/defaults)');

        let menuData = {};
        const customCategories = Array.isArray(customCategoriesResult?.value) ? customCategoriesResult.value : [];
        const estimatedReads =
            1 + // business doc lookup
            (menuSnap?.size || 0) +
            (couponCatalogResult?.readCount || 0) +
            (customCategoriesResult?.readCount || 0) +
            (deliveryConfigResult?.readCount || 0);
        await trackEndpointRead(telemetryEndpoint, estimatedReads);

        const restaurantCategoryConfig = {
            "starters": { title: "Starters" }, "main-course": { title: "Main Course" }, "beverages": { title: "Beverages" },
            "desserts": { title: "Desserts" }, "soup": { title: "Soup" }, "tandoori-item": { title: "Tandoori Items" },
            "momos": { title: "Momos" }, "burgers": { title: "Burgers" }, "rolls": { title: "Rolls" },
            "tandoori-khajana": { title: "Tandoori Khajana" }, "rice": { title: "Rice" }, "noodles": { title: "Noodles" },
            "pasta": { title: "Pasta" }, "raita": { title: "Raita" },
            'snacks': { title: 'Snacks' }, 'chaat': { title: 'Chaat' }, 'sweets': { title: 'Sweets' },
        };
        const shopCategoryConfig = {
            "electronics": { title: "Electronics" }, "groceries": { title: "Groceries" }, "clothing": { title: "Clothing" },
            "books": { title: "Books" }, "home-appliances": { title: "Home Appliances" }, "toys-games": { title: "Toys & Games" },
            "beauty-personal-care": { title: "Beauty & Personal Care" }, "sports-outdoors": { title: "Sports & Outdoors" },
        };

        const businessTypeRaw = businessData.businessType || collectionName.slice(0, -1);
        const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;
        const allCategories = { ...(businessType === 'restaurant' || businessType === 'street-vendor' ? restaurantCategoryConfig : shopCategoryConfig) };
        customCategories.forEach(cat => {
            if (!allCategories[cat.id]) {
                allCategories[cat.id] = { title: cat.title };
            }
        });

        Object.keys(allCategories).forEach(key => {
            menuData[key] = [];
        });

        // Insight badge computation is cached separately so menu cache misses do
        // not repeatedly scan 30-day order history.
        const insightBadgeMap = await getCachedInsightBadgeMap({
            firestore,
            restaurantId: resolvedWinner.businessRef.id || cacheRestaurantId,
            businessRef,
            totalActiveMenuItems: menuSnap.size,
            cacheKey: insightBadgeCacheKey,
            isKvAvailable,
        });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (String(categoryKey).toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) {
                return;
            }
            // Attach auto-computed insight badge (overwrites manual analytics-type tags visually)
            const nameKey = String(item.name || '').trim().toLowerCase();
            let insightBadge = insightBadgeMap.get(nameKey) || null;
            
            // Explicitly prevent staples / breads from getting Analytics Badges 
            // even if they somehow bypassed the counting logic
            if (String(categoryKey).toLowerCase().includes('bread') || /roti|naan|paratha|kulcha|chapati|bread|papad|water/i.test(nameKey)) {
                insightBadge = null;
            }
            
            const itemWithBadge = { id: doc.id, ...item, insightBadge };
            if (menuData[categoryKey]) {
                menuData[categoryKey].push(itemWithBadge);
            } else {
                if (!menuData['general']) menuData['general'] = [];
                menuData['general'].push(itemWithBadge);
            }
        });

        // Sort items by order field
        Object.keys(menuData).forEach(key => {
            menuData[key].sort((a, b) => (a.order || 999) - (b.order || 999));
        });

        // Process coupons
        const now = new Date();
        debugLog('[Menu API] Fetched', couponDocs.length, 'coupons with status=active');
        debugLog('[Menu API] Current time:', now);

        const allCouponDocs = couponDocs.map(couponData => {
            debugLog('[Menu API] Coupon:', couponData.code, 'startDate:', couponData.startDate, 'expiryDate:', couponData.expiryDate);
            return couponData;
        });
        const hasAssignedCoupons = allCouponDocs.some((coupon) => String(coupon?.customerId || '').trim());
        const eligibleCustomerIds = personalizedRequest && hasAssignedCoupons
            ? await resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams })
            : new Set();
        const coupons = filterCouponsForRequest(allCouponDocs, now, eligibleCustomerIds);
        const publicCoupons = filterCouponsForRequest(allCouponDocs, now, new Set());

        debugLog('[Menu API] Final coupons count:', coupons.length);

        const responseData = {
            // Coordinates for distance calculation consumers
            latitude: businessData.coordinates?.lat ?? businessData.address?.latitude ?? businessData.businessAddress?.latitude ?? null,
            longitude: businessData.coordinates?.lng ?? businessData.address?.longitude ?? businessData.businessAddress?.longitude ?? null,
            restaurantName: businessData.name,
            approvalStatus: businessData.approvalStatus || 'approved',
            logoUrl: businessData.logoUrl,
            bannerUrls: businessData.bannerUrls,
            // MERGED DELIVERY SETTINGS (Sub-collection takes precedence => fallback to legacy)
            // Use deliveryFixedFee as source of truth for fixed charge
            deliveryCharge: deliveryConfigState.exists ? (deliveryConfig.deliveryFeeType === 'fixed' ? deliveryConfig.deliveryFixedFee : 0) : (businessData.deliveryCharge || 0),
            deliveryFixedFee: deliveryConfigState.exists ? deliveryConfig.deliveryFixedFee : (businessData.deliveryFixedFee || 30),
            deliveryBaseDistance: deliveryConfigState.exists ? deliveryConfig.deliveryBaseDistance : (businessData.deliveryBaseDistance || 0),
            deliveryFreeThreshold: deliveryConfigState.exists ? deliveryConfig.deliveryFreeThreshold : (businessData.deliveryFreeThreshold || 500),
            minOrderValue: deliveryConfigState.exists ? deliveryConfig.minOrderValue : (businessData.minOrderValue || 0),

            // Correctly expose Per-Km settings
            deliveryFeeType: deliveryConfigState.exists ? deliveryConfig.deliveryFeeType : (businessData.deliveryFeeType || 'fixed'),
            deliveryPerKmFee: deliveryConfigState.exists ? deliveryConfig.deliveryPerKmFee : (businessData.deliveryPerKmFee || 0),
            deliveryRadius: deliveryConfigState.exists ? deliveryConfig.deliveryRadius : (businessData.deliveryRadius || 5),
            roadDistanceFactor: deliveryConfigState.exists ? (deliveryConfig.roadDistanceFactor || 1.0) : (businessData.roadDistanceFactor || 1.0),
            freeDeliveryRadius: deliveryConfigState.exists ? (deliveryConfig.freeDeliveryRadius || 0) : (businessData.freeDeliveryRadius || 0),
            freeDeliveryMinOrder: deliveryConfigState.exists ? (deliveryConfig.freeDeliveryMinOrder || 0) : (businessData.freeDeliveryMinOrder || 0),
            deliveryTiers: deliveryConfigState.exists ? (deliveryConfig.deliveryTiers || []) : (businessData.deliveryTiers || []),
            deliveryOrderSlabRules: deliveryConfigState.exists ? (deliveryConfig.deliveryOrderSlabRules || []) : (businessData.deliveryOrderSlabRules || []),
            deliveryOrderSlabAboveFee: deliveryConfigState.exists ? (deliveryConfig.deliveryOrderSlabAboveFee || 0) : (businessData.deliveryOrderSlabAboveFee || 0),
            deliveryOrderSlabBaseDistance: deliveryConfigState.exists ? (deliveryConfig.deliveryOrderSlabBaseDistance || 1) : (businessData.deliveryOrderSlabBaseDistance || 1),
            deliveryOrderSlabPerKmFee: deliveryConfigState.exists ? (deliveryConfig.deliveryOrderSlabPerKmFee || 15) : (businessData.deliveryOrderSlabPerKmFee || 15),
            deliveryEngineMode: deliveryConfigState.exists ? (deliveryConfig.deliveryEngineMode || 'legacy') : (businessData.deliveryEngineMode || 'legacy'),
            deliveryUseZones: deliveryConfigState.exists ? (deliveryConfig.deliveryUseZones === true) : (businessData.deliveryUseZones === true),
            zoneFallbackToLegacy: deliveryConfigState.exists ? (deliveryConfig.zoneFallbackToLegacy !== false) : (businessData.zoneFallbackToLegacy !== false),
            deliveryZones: deliveryConfigState.exists ? (deliveryConfig.deliveryZones || []) : (businessData.deliveryZones || []),

            menu: menuData,
            customCategories: customCategories,
            coupons: coupons,
            loyaltyPoints: 0, // User-specific data removed for better caching
            // MERGED DELIVERY ENABLED STATUS
            deliveryEnabled: deliveryConfigState.exists ? deliveryConfig.deliveryEnabled : businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled,
            businessAddress: businessData.address,
            businessType: businessType,
            collectionName: collectionName,
            dineInModel: businessData.dineInModel,
            isOpen: effectiveIsOpen,
            autoScheduleEnabled: businessData.autoScheduleEnabled === true,
            openingTime: businessData.openingTime || '09:00',
            closingTime: businessData.closingTime || '22:00',
            timeZone: businessData.timeZone || businessData.timezone || 'Asia/Kolkata',
        };

        // STEP 5: Cache base menu payload for all requests. Personalized coupon
        // overlays are recomputed on top of this cache to avoid data leaks.
        const cacheableResponseData = {
            ...responseData,
            coupons: publicCoupons,
            __couponCatalog: allCouponDocs,
        };
        writeMenuToMemoryCache(cacheKey, cacheableResponseData);
        if (isKvAvailable) {
            kv.set(cacheKey, cacheableResponseData, { ex: 43200 }) // 12 hours = 43200 seconds
                .then(() => debugLog(`[Menu API] ✅ Cached as ${cacheKey} (TTL: 12 hours)`))
                .catch(cacheError => console.error('[Menu API] ❌ Cache storage failed:', cacheError));
        } else if (hasKvConfigured) {
            debugLog(`[Menu API] ⚠️ KV configured but unavailable for this request; skipped cache write for ${cacheRestaurantId}`);
        }

        // Return with no-cache headers to prevent browser caching
        return respond(responseData, 200, {
            'X-Cache': 'MISS',
            'X-Menu-Version': menuVersion.toString(),
            'X-Debug-Source-Collection': collectionName,
            'X-Debug-DB-IsOpen': String(businessData.isOpen),
            'X-Debug-Effective-IsOpen': String(effectiveIsOpen),
            // CDN Cache: Fresh for 60s, serve stale for 10m
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
            'Vary': 'Accept-Encoding'
        });

    } catch (error) {
        telemetryStatus = error?.status || 500;
        telemetryError = error?.message || 'Menu API failed';
        console.error(`[API ERROR] /api/public/menu/${requestedRestaurantId}:`, error);
        return respond({ message: 'Internal Server Error: ' + error.message }, telemetryStatus);
    } finally {
        void trackApiTelemetry({
            endpoint: telemetryEndpoint,
            durationMs: Date.now() - telemetryStartedAt,
            statusCode: telemetryStatus,
            errorMessage: telemetryError,
            context: { restaurantId: String(requestedRestaurantId || ''), src: menuSource || null },
        });
    }
}

