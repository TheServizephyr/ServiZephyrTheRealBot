
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import crypto from 'crypto';
import { getHistoryReadRange } from '@/lib/historyDates.mjs';
import { enforceRateLimit } from '@/lib/public-auth';
import { buildLiveWaitlistQueries } from '@/lib/waitlistReads.mjs';

export const dynamic = 'force-dynamic';

const READY_TO_NOTIFY_STATUS = 'ready_to_notify';
const ACTIVE_STATUSES = new Set(['pending', READY_TO_NOTIFY_STATUS, 'notified', 'arrived', 'no_show']);
const HISTORY_STATUSES = new Set(['seated', 'cancelled', 'no_show']);
const DEFAULT_NO_SHOW_TIMEOUT_MINUTES = 10;
const NO_SHOW_LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
const LATE_BOOKING_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_WAITLIST_MANUAL_CAPACITY = 40;
const DEFAULT_WAITLIST_TOKEN_BASE = 0;
const WAITLIST_COUNTER_TIMEZONE = 'Asia/Kolkata';
const WAITLIST_MENU_WISHLIST_FINALIZE_LIMIT = 240;
const WAITLIST_MENU_WISHLIST_LAPSED_CLEANUP_LIMIT = 20;
const WAITLIST_VIEW_PERMISSIONS = [
    PERMISSIONS.VIEW_BOOKINGS,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.VIEW_DINE_IN_ORDERS,
    PERMISSIONS.MANAGE_DINE_IN,
];
const WAITLIST_MANAGE_PERMISSIONS = [
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.MANAGE_DINE_IN,
];

function assertRestaurantBusiness(context) {
    if (context.collectionName !== 'restaurants') {
        throw {
            message: 'Waitlist is only available for restaurant businesses.',
            status: 403,
        };
    }
}

function normalizeWaitlistSeatingMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'manual_seat') return 'manual_seat';
    return 'table_assign';
}

function toDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000);
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value) {
    const date = toDate(value);
    return date ? date.toISOString() : null;
}

function toMillis(value) {
    const date = toDate(value);
    return date ? date.getTime() : null;
}

function formatWaitlistToken(numberValue) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(2);
    const suffix = `${alphabet[bytes[0] % alphabet.length]}${alphabet[bytes[1] % alphabet.length]}`;
    return `#${String(Math.max(0, Number(numberValue) || 0)).padStart(2, '0')}${suffix}`;
}

function generateArrivalCode() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function getDateKeyInTimeZone(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: WAITLIST_COUNTER_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '0000';
    const month = parts.find((part) => part.type === 'month')?.value || '00';
    const day = parts.find((part) => part.type === 'day')?.value || '00';
    return `${year}-${month}-${day}`;
}

function normalizeQueuePriority(value, fallback = 2) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return fallback;
}

function normalizeNoShowTimeoutMinutes(value, fallback = DEFAULT_NO_SHOW_TIMEOUT_MINUTES) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(120, Math.max(1, parsed));
}

function getHistoryMillis(entry = {}) {
    const status = String(entry.status || '').toLowerCase();
    if (status === 'no_show') {
        return getNoShowLapsedMillis(entry);
    }
    return toMillis(entry.noShowAt)
        || toMillis(entry.seatedAt)
        || toMillis(entry.cancelledAt)
        || toMillis(entry.updatedAt)
        || toMillis(entry.createdAt)
        || 0;
}

function getNoShowLapsedMillis(entry = {}) {
    const noShowAtMs = toMillis(entry.noShowAt);
    const deadlineMs = toMillis(entry.noShowDeadlineAt);
    if (noShowAtMs && deadlineMs) return Math.min(noShowAtMs, deadlineMs);
    return noShowAtMs
        || deadlineMs
        || toMillis(entry.updatedAt)
        || toMillis(entry.createdAt)
        || 0;
}

function isLiveActiveWaitlistRecord(entry = {}, nowMs = Date.now()) {
    const status = String(entry?.status || '').toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) return false;
    if (status !== 'no_show') return true;

    const noShowLapsedMs = getNoShowLapsedMillis(entry);
    return noShowLapsedMs > 0 && (nowMs - noShowLapsedMs) < NO_SHOW_LIVE_WINDOW_MS;
}

function getHistoryDateRange(url) {
    return getHistoryReadRange(url.searchParams);
}

async function fetchWaitlistHistoryDocsForRange({ businessRef, historyDateRange }) {
    const historyFields = ['noShowAt', 'noShowDeadlineAt', 'seatedAt', 'cancelledAt', 'updatedAt', 'createdAt'];
    const historySnaps = await Promise.all(historyFields.map((fieldName) => (
        businessRef.collection('waitlist')
            .where(fieldName, '>=', historyDateRange.start)
            .where(fieldName, '<', historyDateRange.end)
            .orderBy(fieldName, 'desc')
            .get()
    )));

    const seenDocIds = new Set();
    return historySnaps.flatMap((snap) => snap.docs).filter((doc) => {
        if (seenDocIds.has(doc.id)) return false;
        seenDocIds.add(doc.id);
        const data = doc.data() || {};
        const historyMs = getHistoryMillis(data);
        return (
            HISTORY_STATUSES.has(String(data.status || '').toLowerCase()) &&
            historyMs >= historyDateRange.start.getTime() &&
            historyMs < historyDateRange.end.getTime()
        );
    });
}

function toNoShowTimeoutMs(value) {
    return normalizeNoShowTimeoutMinutes(value) * 60 * 1000;
}

async function maybeBridgeLateBookings({ firestore, businessRef, businessId, businessName }) {
    const now = Date.now();
    const todayCounterDateKey = getDateKeyInTimeZone(new Date(now));

    // Hard date-guard: only bridge bookings whose bookingDateTime is within
    // the past 48 hours. Old/stale/injected fake bookings from previous days
    // will never cascade into the live waitlist again.
    // NOTE: We filter in JS (not Firestore) to avoid needing a composite index.
    const BRIDGE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
    const earliestBookingMs = now - BRIDGE_LOOKBACK_MS;

    const bookingSnap = await businessRef.collection('bookings')
        .where('status', 'in', ['pending', 'confirmed'])
        .limit(120)
        .get();

    let bridgedCount = 0;

    for (const bookingDoc of bookingSnap.docs) {
        const bookingData = bookingDoc.data() || {};
        const bookingAtMs = toMillis(bookingData.bookingDateTime);
        // Skip if booking is older than 48h (date guard — no Firestore index needed)
        if (!bookingAtMs || bookingAtMs < earliestBookingMs) continue;
        if (bookingAtMs + LATE_BOOKING_GRACE_MS > now) continue;

        const bookingPhone = String(bookingData.customerPhone || '').replace(/\D/g, '').slice(-10);

        const didBridge = await firestore.runTransaction(async (transaction) => {
            const freshBookingSnap = await transaction.get(bookingDoc.ref);
            const freshBookingData = freshBookingSnap.data() || {};
            const freshStatus = String(freshBookingData.status || '').toLowerCase();
            const freshBookingAtMs = toMillis(freshBookingData.bookingDateTime);
            if (!freshBookingSnap.exists || !['pending', 'confirmed'].includes(freshStatus)) return false;
            if (!freshBookingAtMs || freshBookingAtMs + LATE_BOOKING_GRACE_MS > Date.now()) return false;

            const bridgeRef = businessRef.collection('waitlist_booking_bridge').doc(bookingDoc.id);
            const bridgeSnap = await transaction.get(bridgeRef);
            if (bridgeSnap.exists) return false;

            let linkedEntryId = '';
            const lockRef = bookingPhone ? businessRef.collection('waitlist_active_phone').doc(bookingPhone) : null;
            if (lockRef) {
                const lockSnap = await transaction.get(lockRef);
                const lockedEntryId = String(lockSnap.data()?.entryId || '').trim();
                if (lockSnap.exists && lockedEntryId) {
                    const lockedEntryRef = businessRef.collection('waitlist').doc(lockedEntryId);
                    const lockedEntrySnap = await transaction.get(lockedEntryRef);
                    if (lockedEntrySnap.exists && isLiveActiveWaitlistRecord(lockedEntrySnap.data())) {
                        linkedEntryId = lockedEntryId;
                    }
                }
            }

            if (!linkedEntryId) {
                const businessSnap = await transaction.get(businessRef);
                const businessData = businessSnap.data() || {};
                const storedCounterDateKey = String(businessData.waitlistTokenCounterDate || '').trim();
                const shouldResetCounter = storedCounterDateKey !== todayCounterDateKey;
                const currentCounter = shouldResetCounter
                    ? DEFAULT_WAITLIST_TOKEN_BASE
                    : Math.max(DEFAULT_WAITLIST_TOKEN_BASE, Number(businessData.waitlistTokenCounter || DEFAULT_WAITLIST_TOKEN_BASE));
                const nextCounter = currentCounter + 1;
                const tokenNumber = currentCounter;
                const waitlistRef = businessRef.collection('waitlist').doc();
                linkedEntryId = waitlistRef.id;

                transaction.set(waitlistRef, {
                    id: waitlistRef.id,
                    name: String(freshBookingData.customerName || 'Guest').trim(),
                    phone: bookingPhone,
                    paxCount: Math.max(1, Number(freshBookingData.partySize || 1)),
                    status: 'pending',
                    queueType: 'late_booking',
                    queuePriority: 1,
                    source: 'booking_late',
                    sourceBookingId: bookingDoc.id,
                    bookingDateTime: freshBookingData.bookingDateTime || null,
                    waitlistTokenNumber: tokenNumber,
                    waitlistToken: formatWaitlistToken(tokenNumber),
                    arrivalCode: generateArrivalCode(),
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    restaurantId: businessId,
                    restaurantName: businessName || 'Restaurant',
                });

                transaction.set(businessRef, {
                    waitlistTokenCounter: nextCounter,
                    waitlistTokenCounterDate: todayCounterDateKey,
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });

                if (lockRef) {
                    transaction.set(lockRef, {
                        phone: bookingPhone,
                        entryId: waitlistRef.id,
                        status: 'active',
                        updatedAt: FieldValue.serverTimestamp(),
                    }, { merge: true });
                }
            }

            transaction.set(bridgeRef, {
                bookingId: bookingDoc.id,
                waitlistEntryId: linkedEntryId,
                createdAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            transaction.update(bookingDoc.ref, {
                status: 'late_waitlist',
                lateWaitlistEntryId: linkedEntryId,
                movedToWaitlistAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            return true;
        });

        if (didBridge) bridgedCount += 1;
    }

    return bridgedCount;
}

async function expireNoShows({ firestore, businessRef, noShowTimeoutMs }) {
    const notifiedQuery = businessRef.collection('waitlist')
        .where('status', '==', 'notified')
        .limit(120);

    const now = Date.now();
    const isExpired = (data) => {
        const deadlineMs = toMillis(data.noShowDeadlineAt) || 0;
        if (deadlineMs > 0) return now >= deadlineMs;
        const notifiedAtMs = toMillis(data.notifiedAt) || toMillis(data.updatedAt) || 0;
        return notifiedAtMs > 0 && (now - notifiedAtMs) >= noShowTimeoutMs;
    };
    const notifiedSnap = await notifiedQuery.get();
    const expiredEntries = notifiedSnap.docs.filter(doc => isExpired(doc.data() || {}));
    if (expiredEntries.length === 0) return 0;

    // A concurrent seat or cancel must win over an old maintenance query.
    return firestore.runTransaction(async (transaction) => {
        const currentEntries = await transaction.getAll(...expiredEntries.map(doc => doc.ref));
        let expiredCount = 0;
        for (const entryDoc of currentEntries) {
            const entryData = entryDoc.data() || {};
            if (entryData.status !== 'notified' || !isExpired(entryData)) continue;

            const deadlineMs = toMillis(entryData.noShowDeadlineAt) || 0;
            const notifiedAtMs = toMillis(entryData.notifiedAt) || toMillis(entryData.updatedAt) || 0;
            const lapsedAtMs = deadlineMs || notifiedAtMs + noShowTimeoutMs;
            const updatePayload = {
                status: 'no_show',
                menuWishlistCleanupAfter: entryData.menuWishlistClearedAt ? null : new Date(lapsedAtMs + NO_SHOW_LIVE_WINDOW_MS),
                noShowAt: new Date(lapsedAtMs),
                updatedAt: FieldValue.serverTimestamp(),
            };
            if (!deadlineMs) updatePayload.noShowDeadlineAt = new Date(lapsedAtMs);
            transaction.update(entryDoc.ref, updatePayload);
            expiredCount += 1;

            const normalizedPhone = String(entryData.phone || '').trim();
            if (!normalizedPhone) continue;
            const lockRef = businessRef.collection('waitlist_active_phone').doc(normalizedPhone);
            transaction.set(lockRef, {
                phone: normalizedPhone,
                entryId: entryDoc.id,
                status: 'active',
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        return expiredCount;
    });
}

function getSavedWishlistDocsForAggregation(wishlistDocs = []) {
    return wishlistDocs.filter((doc) => {
        const data = doc.data() || {};
        return data.saved === true && data.counted !== true;
    });
}

function applyWaitlistMenuWishlistFinalization({
    transaction,
    businessRef,
    entryRef,
    entryData = {},
    wishlistSnap,
    status,
    updatePayload,
}) {
    const alreadyCleared = Boolean(entryData.menuWishlistClearedAt);
    const shouldCloseWishlist = status === 'seated' || status === 'cancelled';
    if (!shouldCloseWishlist || alreadyCleared) return { aggregatedCount: 0, clearedCount: 0 };

    const wishlistDocs = wishlistSnap?.docs || [];
    const savedDocsToAggregate = status === 'seated' && !entryData.menuWishlistAggregatedAt
        ? getSavedWishlistDocsForAggregation(wishlistDocs)
        : [];

    savedDocsToAggregate.forEach((doc) => {
        const itemId = String((doc.data() || {}).itemId || doc.id || '').trim();
        if (!itemId) return;
        transaction.set(businessRef.collection('waitlist_menu_wishlist_stats').doc(itemId), {
            itemId,
            count: FieldValue.increment(1),
            countMode: 'seated_all_time',
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });

    wishlistDocs.forEach((doc) => {
        transaction.delete(doc.ref);
    });

    updatePayload.menuWishlistClearedAt = FieldValue.serverTimestamp();
    updatePayload.menuWishlistCleanupAfter = null;
    updatePayload.menuWishlistClearedReason = status;
    updatePayload.menuWishlistClearedCount = wishlistDocs.length;
    updatePayload.menuWishlistCleanupTruncated = wishlistDocs.length >= WAITLIST_MENU_WISHLIST_FINALIZE_LIMIT;

    if (status === 'seated' && !entryData.menuWishlistAggregatedAt) {
        updatePayload.menuWishlistAggregatedAt = FieldValue.serverTimestamp();
        updatePayload.menuWishlistAggregatedCount = savedDocsToAggregate.length;
    }

    return {
        aggregatedCount: savedDocsToAggregate.length,
        clearedCount: wishlistDocs.length,
    };
}

async function clearWaitlistMenuWishlistMarkers({ firestore, entryDoc, reason }) {
    const entryData = entryDoc.data() || {};
    if (entryData.menuWishlistClearedAt) return 0;

    const wishlistSnap = await entryDoc.ref
        .collection('menu_wishlist')
        .limit(WAITLIST_MENU_WISHLIST_FINALIZE_LIMIT)
        .get();

    const batch = firestore.batch();
    wishlistSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.set(entryDoc.ref, {
        menuWishlistClearedAt: FieldValue.serverTimestamp(),
        menuWishlistCleanupAfter: null,
        menuWishlistClearedReason: reason,
        menuWishlistClearedCount: wishlistSnap.size,
        menuWishlistCleanupTruncated: wishlistSnap.size >= WAITLIST_MENU_WISHLIST_FINALIZE_LIMIT,
    }, { merge: true });
    await batch.commit();
    return wishlistSnap.size;
}

async function cleanupLapsedNoShowMenuWishlists({ firestore, waitlistDocs }) {
    const lapsedNoShowDocs = waitlistDocs
        .filter((doc) => {
            const data = doc.data() || {};
            return String(data.status || '').toLowerCase() === 'no_show'
                && !data.menuWishlistClearedAt
                && !isLiveActiveWaitlistRecord(data);
        })
        .slice(0, WAITLIST_MENU_WISHLIST_LAPSED_CLEANUP_LIMIT);

    let clearedEntries = 0;
    let clearedMarkers = 0;

    for (const entryDoc of lapsedNoShowDocs) {
        try {
            const deletedCount = await clearWaitlistMenuWishlistMarkers({
                firestore,
                entryDoc,
                reason: 'no_show_lapsed',
            });
            clearedEntries += 1;
            clearedMarkers += deletedCount;
        } catch (error) {
            console.warn('[owner/waitlist] Failed to clear lapsed no-show wishlist markers:', error?.message || error);
        }
    }

    return { clearedEntries, clearedMarkers };
}

async function autoPromoteNextPending({ firestore, businessRef }) {
    const waitlistRef = businessRef.collection('waitlist');
    return firestore.runTransaction(async (transaction) => {
        const activeNotifiedSnap = await transaction.get(waitlistRef
            .where('status', 'in', ['notified', READY_TO_NOTIFY_STATUS]).limit(1));
        if (!activeNotifiedSnap.empty) return null;

        const pendingSnap = await transaction.get(waitlistRef.where('status', '==', 'pending').limit(200));
        const [nextEntry] = pendingSnap.docs
            .map(doc => ({ id: doc.id, data: doc.data(), ref: doc.ref }))
            .sort((a, b) => {
                const priorityA = normalizeQueuePriority(a.data.queuePriority, 2);
                const priorityB = normalizeQueuePriority(b.data.queuePriority, 2);
                return priorityA - priorityB || (toMillis(a.data.createdAt) || 0) - (toMillis(b.data.createdAt) || 0);
            });
        if (!nextEntry) return null;

        transaction.update(nextEntry.ref, {
            status: READY_TO_NOTIFY_STATUS,
            notifiedAt: null,
            noShowDeadlineAt: null,
            autoPromotedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        return nextEntry.id;
    });
}

function getManualCapacityMetrics({ manualCapacity }) {
    const capacityLimit = Math.max(1, Number(manualCapacity || DEFAULT_WAITLIST_MANUAL_CAPACITY));

    return {
        activeSeatedPax: 0,
        capacityLimit,
        occupancyPercent: 0,
        softAlert: false,
        trackingEnabled: false,
        message: null,
    };
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'view_waitlist',
            {},
            false,
            WAITLIST_VIEW_PERMISSIONS
        );
        assertRestaurantBusiness(context);
        const { businessId, businessSnap } = context;
        const firestore = await getFirestore();
        const url = new URL(req.url);
        const isHistory = url.searchParams.get('history') === 'true';
        const includeAll = url.searchParams.get('all') === 'true';
        if (includeAll && context.callerRole !== 'owner') {
            throw { message: 'Owner access required for all-time waitlist customer data.', status: 403 };
        }
        const historyDateRange = isHistory ? getHistoryDateRange(url) : null;
        const rate = await enforceRateLimit(firestore, { bucket: 'owner_waitlist_reads', key: `${context.callerUid || context.uid}:${isHistory ? 'history' : includeAll ? 'customers' : 'live'}`, limit: isHistory || includeAll ? 30 : 120, windowSec: 60, req });
        if (!rate.allowed) return NextResponse.json({ message: 'Too many waitlist requests. Please try again shortly.' }, { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } });
        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data() || {};
        const waitlistSeatingMode = normalizeWaitlistSeatingMode(businessData.waitlistSeatingMode);
        const waitlistManualCapacity = Math.max(1, Number(businessData.waitlistManualCapacity || DEFAULT_WAITLIST_MANUAL_CAPACITY));
        const noShowTimeoutMinutes = normalizeNoShowTimeoutMinutes(businessData.waitlistNoShowTimeoutMinutes);
        const noShowTimeoutMs = toNoShowTimeoutMs(noShowTimeoutMinutes);

        let bridgedBookingsCount = 0;
        let autoExpiredCount = 0;
        let promotedEntryId = null;
        let wishlistCleanup = { clearedEntries: 0, clearedMarkers: 0 };

        if (!isHistory && !includeAll) {
            bridgedBookingsCount = await maybeBridgeLateBookings({
                firestore,
                businessRef,
                businessId,
                businessName: businessData.name,
            });
            autoExpiredCount = await expireNoShows({ firestore, businessRef, noShowTimeoutMs });
        }

        let waitlistDocs = [];
        let cleanupDocs = [];

        if (includeAll) {
            const waitlistSnap = await businessRef.collection('waitlist').get();
            waitlistDocs = waitlistSnap.docs;
        } else if (isHistory && historyDateRange) {
            waitlistDocs = await fetchWaitlistHistoryDocsForRange({ businessRef, historyDateRange });
        } else {
            const [activeSnap, recentNoShowSnap, pendingCleanupSnap] = await Promise.all([
                ...buildLiveWaitlistQueries(businessRef.collection('waitlist')).map(query => query.get()),
                businessRef.collection('waitlist').where('menuWishlistCleanupAfter', '<=', new Date()).limit(WAITLIST_MENU_WISHLIST_LAPSED_CLEANUP_LIMIT).get(),
            ]);
            const liveDocs = [...activeSnap.docs, ...recentNoShowSnap.docs.filter(doc => doc.data().status === 'no_show')];
            waitlistDocs = [...new Map(liveDocs.map(doc => [doc.id, doc])).values()];
            cleanupDocs = pendingCleanupSnap.docs;
        }

        if (!isHistory && !includeAll) {
            wishlistCleanup = await cleanupLapsedNoShowMenuWishlists({ firestore, waitlistDocs: [...new Map([...waitlistDocs, ...cleanupDocs].map(doc => [doc.id, doc])).values()] });
        }

        let entries = waitlistDocs.map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                ...data,
                createdAt: toIso(data.createdAt) || data.createdAt || null,
                updatedAt: toIso(data.updatedAt) || data.updatedAt || null,
                notifiedAt: toIso(data.notifiedAt) || null,
                noShowAt: toIso(data.noShowAt) || null,
                noShowDeadlineAt: toIso(data.noShowDeadlineAt) || null,
                seatedAt: toIso(data.seatedAt) || null,
                cancelledAt: toIso(data.cancelledAt) || null,
                arrivedAt: toIso(data.arrivedAt) || null,
            };
        });

        if (!isHistory && !includeAll) {
            entries = entries.filter((entry) => isLiveActiveWaitlistRecord(entry));
        }

        if (isHistory || includeAll) {
            entries.sort((a, b) => getHistoryMillis(b) - getHistoryMillis(a));
        } else {
            entries.sort((a, b) => {
                const pA = normalizeQueuePriority(a.queuePriority, 2);
                const pB = normalizeQueuePriority(b.queuePriority, 2);
                if (pA !== pB) return pA - pB;
                const dateA = new Date(a.createdAt || 0);
                const dateB = new Date(b.createdAt || 0);
                return dateA - dateB;
            });
        }

        const capacity = getManualCapacityMetrics({
            manualCapacity: waitlistManualCapacity,
        });

        return NextResponse.json({
            entries,
            meta: {
                waitlistSeatingMode,
                waitlistManualCapacity,
                noShowTimeoutMinutes,
                bridgedBookingsCount,
                autoExpiredCount,
                waitlistMenuWishlistCleanup: wishlistCleanup,
                promotedEntryId,
                capacity,
            }
        }, { status: 200 });

    } catch (error) {
        console.error("GET OWNER WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'create_waitlist_entry',
            {},
            false,
            WAITLIST_MANAGE_PERMISSIONS
        );
        assertRestaurantBusiness(context);

        const { businessId, businessSnap, uid } = context;
        const firestore = await getFirestore();
        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data() || {};
        const { name, phone, paxCount } = await req.json();

        const normalizedName = String(name || '').trim();
        if (!normalizedName) {
            return NextResponse.json({ message: 'Guest name is required.' }, { status: 400 });
        }

        const normalizedPaxCount = Number.parseInt(String(paxCount), 10);
        if (!Number.isInteger(normalizedPaxCount) || normalizedPaxCount < 1 || normalizedPaxCount > 20) {
            return NextResponse.json({ message: 'Guests must be between 1 and 20.' }, { status: 400 });
        }

        const normalizedPhone = String(phone || '').replace(/\D/g, '');
        if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
            return NextResponse.json({ message: 'Invalid phone number format.' }, { status: 400 });
        }

        const createdAt = new Date();
        const todayCounterDateKey = getDateKeyInTimeZone(createdAt);
        const lockRef = normalizedPhone
            ? businessRef.collection('waitlist_active_phone').doc(normalizedPhone)
            : null;

        const entryPayload = await firestore.runTransaction(async (transaction) => {
            const [businessSnapTx, lockSnap] = await transaction.getAll(...(lockRef ? [businessRef, lockRef] : [businessRef]));
            const businessDataTx = businessSnapTx.data() || {};

            if (lockSnap?.exists) {
                const existingEntryId = String(lockSnap.data()?.entryId || '').trim();
                if (existingEntryId) {
                    const existingEntryRef = businessRef.collection('waitlist').doc(existingEntryId);
                    const existingEntrySnap = await transaction.get(existingEntryRef);
                    if (existingEntrySnap.exists && isLiveActiveWaitlistRecord(existingEntrySnap.data())) {
                        throw { message: 'Active waitlist entry already exists for this phone.', status: 409 };
                    }
                } else {
                    throw { message: 'Active waitlist entry already exists for this phone.', status: 409 };
                }
            }

            const storedCounterDateKey = String(businessDataTx.waitlistTokenCounterDate || '').trim();
            const shouldResetCounter = storedCounterDateKey !== todayCounterDateKey;
            const currentCounter = shouldResetCounter
                ? DEFAULT_WAITLIST_TOKEN_BASE
                : Math.max(DEFAULT_WAITLIST_TOKEN_BASE, Number(businessDataTx.waitlistTokenCounter || DEFAULT_WAITLIST_TOKEN_BASE));
            const nextCounter = currentCounter + 1;
            const tokenNumber = currentCounter;
            const waitlistToken = formatWaitlistToken(tokenNumber);
            const arrivalCode = generateArrivalCode();
            const entryRef = businessRef.collection('waitlist').doc();

            const entryPayload = {
                id: entryRef.id,
                name: normalizedName,
                phone: normalizedPhone,
                paxCount: normalizedPaxCount,
                status: 'pending',
                queueType: 'walk_in',
                queuePriority: 2,
                source: 'manual_quick_add',
                createdBy: uid || null,
                waitlistTokenNumber: tokenNumber,
                waitlistToken,
                arrivalCode,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                restaurantId: businessId,
                restaurantName: businessData.name || 'Restaurant',
            };

            transaction.set(entryRef, entryPayload);
            transaction.set(businessRef, {
                waitlistTokenCounter: nextCounter,
                waitlistTokenCounterDate: todayCounterDateKey,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            if (lockRef) {
                transaction.set(lockRef, {
                    phone: normalizedPhone,
                    entryId: entryRef.id,
                    status: 'active',
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            return entryPayload;
        });

        return NextResponse.json({
            message: 'Waitlist entry created.',
            entry: {
                ...entryPayload,
                createdAt: createdAt.toISOString(),
                updatedAt: createdAt.toISOString(),
            },
        }, { status: 201 });
    } catch (error) {
        console.error("POST OWNER WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'update_waitlist_entry',
            {},
            false,
            WAITLIST_MANAGE_PERMISSIONS
        );
        assertRestaurantBusiness(context);
        const { businessSnap } = context;
        const firestore = await getFirestore();
        const { entryId, status } = await req.json();

        if (!entryId || !status) {
            return NextResponse.json({ message: 'Entry ID and status are required.' }, { status: 400 });
        }

        const allowedStatuses = ['pending', READY_TO_NOTIFY_STATUS, 'notified', 'arrived', 'seated', 'cancelled', 'no_show'];
        if (!allowedStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status.' }, { status: 400 });
        }

        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data() || {};
        const waitlistManualCapacity = Math.max(1, Number(businessData.waitlistManualCapacity || DEFAULT_WAITLIST_MANUAL_CAPACITY));
        const noShowTimeoutMinutes = normalizeNoShowTimeoutMinutes(businessData.waitlistNoShowTimeoutMinutes);
        const noShowTimeoutMs = toNoShowTimeoutMs(noShowTimeoutMinutes);

        const entryRef = businessRef.collection('waitlist').doc(entryId);
        const updated = await firestore.runTransaction(async (transaction) => {
            const freshEntrySnap = await transaction.get(entryRef);
            if (!freshEntrySnap.exists) {
                throw { message: 'Waitlist entry not found.', status: 404 };
            }
            const freshEntryData = freshEntrySnap.data() || {};
            const previousStatus = String(freshEntryData.status || '').toLowerCase();
            if (previousStatus === 'seated' || previousStatus === 'cancelled') {
                if (previousStatus !== status) {
                    throw { message: `This waitlist entry is already ${previousStatus}.`, status: 409 };
                }
                return {
                    wishlistFinalization: { aggregatedCount: 0, clearedCount: 0 },
                    shouldPromoteNext: false,
                };
            }

            const normalizedPhone = String(freshEntryData.phone || '').trim();
            const activePhoneLockRef = normalizedPhone
                ? businessRef.collection('waitlist_active_phone').doc(normalizedPhone)
                : null;
            const shouldFinalizeWishlist = (status === 'seated' || status === 'cancelled')
                && !freshEntryData.menuWishlistClearedAt;
            const [lockSnap, wishlistSnap] = await Promise.all([
                activePhoneLockRef ? transaction.get(activePhoneLockRef) : null,
                shouldFinalizeWishlist
                    ? transaction.get(entryRef.collection('menu_wishlist').limit(WAITLIST_MENU_WISHLIST_FINALIZE_LIMIT))
                    : null,
            ]);

            const updatePayload = {
                status,
                updatedAt: FieldValue.serverTimestamp()
            };
            if (status === 'notified') {
                updatePayload.notifiedAt = FieldValue.serverTimestamp();
                updatePayload.noShowDeadlineAt = new Date(Date.now() + noShowTimeoutMs);
            }
            if (status === 'seated') {
                updatePayload.seatedAt = FieldValue.serverTimestamp();
            }
            if (status === 'arrived') {
                updatePayload.arrivedAt = FieldValue.serverTimestamp();
                // Arrived means guest is physically present, so stop no-show countdown.
                updatePayload.noShowDeadlineAt = null;
            }
            if (status === 'cancelled') {
                updatePayload.cancelledAt = FieldValue.serverTimestamp();
            }
            if (status === 'no_show') {
                updatePayload.noShowAt = FieldValue.serverTimestamp();
                updatePayload.menuWishlistCleanupAfter = freshEntryData.menuWishlistClearedAt ? null : new Date(Date.now() + NO_SHOW_LIVE_WINDOW_MS);
            }

            const wishlistFinalization = applyWaitlistMenuWishlistFinalization({
                transaction,
                businessRef,
                entryRef,
                entryData: freshEntryData,
                wishlistSnap,
                status,
                updatePayload,
            });

            transaction.update(entryRef, updatePayload);

            if (activePhoneLockRef && ACTIVE_STATUSES.has(status)) {
                transaction.set(activePhoneLockRef, {
                    phone: normalizedPhone,
                    entryId,
                    status: 'active',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } else if (lockSnap?.exists && String(lockSnap.data()?.entryId || '').trim() === entryId) {
                transaction.delete(activePhoneLockRef);
            }
            return {
                wishlistFinalization,
                shouldPromoteNext: ['notified', READY_TO_NOTIFY_STATUS].includes(previousStatus) && ['seated', 'cancelled'].includes(status),
            };
        });

        let promotedEntryId = null;
        let warning = null;
        if (updated.shouldPromoteNext) {
            try {
                promotedEntryId = await autoPromoteNextPending({ firestore, businessRef });
            } catch (error) {
                console.warn('[owner/waitlist] Could not promote next guest:', error);
                warning = 'Automatic promotion failed. Check the live waitlist and notify the next guest manually if needed.';
            }
        }
        const capacity = getManualCapacityMetrics({
            manualCapacity: waitlistManualCapacity,
        });

        return NextResponse.json({
            message: `Status updated to ${status}`,
            promotedEntryId,
            wishlistFinalization: updated.wishlistFinalization,
            warning,
            capacity,
        }, { status: 200 });

    } catch (error) {
        console.error("PATCH OWNER WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
