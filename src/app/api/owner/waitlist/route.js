
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = new Set(['pending', 'notified', 'arrived']);
const HISTORY_STATUSES = new Set(['seated', 'cancelled', 'no_show']);
const DEFAULT_NO_SHOW_TIMEOUT_MINUTES = 10;
const LATE_BOOKING_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_WAITLIST_MANUAL_CAPACITY = 40;
const ACTIVE_SEATED_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_WAITLIST_TOKEN_BASE = 100;
const WAITLIST_COUNTER_TIMEZONE = 'Asia/Kolkata';

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
    return `#${numberValue}${suffix}`;
}

function generateArrivalCode() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function getDateKeyInTimeZone(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: WAITLIST_COUNTER_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
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

function toNoShowTimeoutMs(value) {
    return normalizeNoShowTimeoutMinutes(value) * 60 * 1000;
}

async function maybeBridgeLateBookings({ firestore, businessRef, businessId, businessName }) {
    const now = Date.now();
    const todayCounterDateKey = getDateKeyInTimeZone(new Date(now));
    const bookingSnap = await businessRef.collection('bookings')
        .where('status', 'in', ['pending', 'confirmed'])
        .limit(120)
        .get();

    let bridgedCount = 0;

    for (const bookingDoc of bookingSnap.docs) {
        const bookingData = bookingDoc.data() || {};
        const bookingAtMs = toMillis(bookingData.bookingDateTime);
        if (!bookingAtMs || bookingAtMs + LATE_BOOKING_GRACE_MS > now) continue;

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
                    const lockedStatus = String(lockedEntrySnap.data()?.status || '').toLowerCase();
                    if (lockedEntrySnap.exists && ACTIVE_STATUSES.has(lockedStatus)) {
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
                    waitlistTokenNumber: nextCounter,
                    waitlistToken: formatWaitlistToken(nextCounter),
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
    const notifiedSnap = await businessRef.collection('waitlist')
        .where('status', '==', 'notified')
        .limit(120)
        .get();

    const expiredEntries = notifiedSnap.docs.filter((doc) => {
        const data = doc.data() || {};
        const deadlineMs = toMillis(data.noShowDeadlineAt) || 0;
        if (deadlineMs > 0) return Date.now() >= deadlineMs;
        const notifiedAtMs = toMillis(data.notifiedAt) || toMillis(data.updatedAt) || 0;
        return notifiedAtMs > 0 && (Date.now() - notifiedAtMs) >= noShowTimeoutMs;
    });

    if (expiredEntries.length === 0) return 0;

    const batch = firestore.batch();

    for (const entryDoc of expiredEntries) {
        const entryData = entryDoc.data() || {};
        batch.set(entryDoc.ref, {
            status: 'no_show',
            noShowAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const normalizedPhone = String(entryData.phone || '').trim();
        if (!normalizedPhone) continue;

        const lockRef = businessRef.collection('waitlist_active_phone').doc(normalizedPhone);
        const lockSnap = await lockRef.get();
        const lockEntryId = String(lockSnap.data()?.entryId || '').trim();
        if (lockSnap.exists && lockEntryId === entryDoc.id) {
            batch.delete(lockRef);
        }
    }

    await batch.commit();
    return expiredEntries.length;
}

async function autoPromoteNextPending({ firestore, businessRef, noShowTimeoutMs }) {
    const activeNotifiedSnap = await businessRef.collection('waitlist')
        .where('status', '==', 'notified')
        .limit(1)
        .get();
    if (!activeNotifiedSnap.empty) return null;

    const pendingSnap = await businessRef.collection('waitlist')
        .where('status', '==', 'pending')
        .limit(200)
        .get();
    if (pendingSnap.empty) return null;

    const candidateDocs = pendingSnap.docs
        .map((doc) => ({ id: doc.id, data: doc.data() || {}, ref: doc.ref }))
        .sort((a, b) => {
            const pA = normalizeQueuePriority(a.data.queuePriority, 2);
            const pB = normalizeQueuePriority(b.data.queuePriority, 2);
            if (pA !== pB) return pA - pB;
            const cA = toMillis(a.data.createdAt) || 0;
            const cB = toMillis(b.data.createdAt) || 0;
            return cA - cB;
        });

    const nextEntry = candidateDocs[0];
    if (!nextEntry) return null;

    await nextEntry.ref.set({
        status: 'notified',
        notifiedAt: FieldValue.serverTimestamp(),
        noShowDeadlineAt: new Date(Date.now() + noShowTimeoutMs),
        autoNotified: true,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return nextEntry.id;
}

async function getManualCapacityMetrics({ businessRef, manualCapacity }) {
    const seatedSnap = await businessRef.collection('waitlist')
        .where('status', '==', 'seated')
        .limit(300)
        .get();

    const cutoffMs = Date.now() - ACTIVE_SEATED_WINDOW_MS;
    const activeSeatedPax = seatedSnap.docs.reduce((sum, doc) => {
        const data = doc.data() || {};
        const seatedAtMs = toMillis(data.seatedAt) || toMillis(data.updatedAt) || 0;
        if (!seatedAtMs || seatedAtMs < cutoffMs) return sum;
        return sum + Math.max(1, Number(data.paxCount || 1));
    }, 0);

    const capacityLimit = Math.max(1, Number(manualCapacity || DEFAULT_WAITLIST_MANUAL_CAPACITY));
    const occupancyPercent = Math.round((activeSeatedPax / capacityLimit) * 100);
    const softAlert = occupancyPercent >= 90;

    return {
        activeSeatedPax,
        capacityLimit,
        occupancyPercent,
        softAlert,
        message: softAlert
            ? `Manual seating load is high (${activeSeatedPax}/${capacityLimit}).`
            : null,
    };
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'view_waitlist',
            {},
            false,
            PERMISSIONS.VIEW_DINE_IN // Assuming same permission level as dine-in
        );
        const { businessId, businessSnap } = context;
        const firestore = await getFirestore();
        const url = new URL(req.url);
        const isHistory = url.searchParams.get('history') === 'true';
        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data() || {};
        const waitlistSeatingMode = normalizeWaitlistSeatingMode(businessData.waitlistSeatingMode);
        const waitlistManualCapacity = Math.max(1, Number(businessData.waitlistManualCapacity || DEFAULT_WAITLIST_MANUAL_CAPACITY));
        const noShowTimeoutMinutes = normalizeNoShowTimeoutMinutes(businessData.waitlistNoShowTimeoutMinutes);
        const noShowTimeoutMs = toNoShowTimeoutMs(noShowTimeoutMinutes);

        let bridgedBookingsCount = 0;
        let autoExpiredCount = 0;
        let promotedEntryId = null;

        if (!isHistory) {
            bridgedBookingsCount = await maybeBridgeLateBookings({
                firestore,
                businessRef,
                businessId,
                businessName: businessData.name,
            });
            autoExpiredCount = await expireNoShows({ firestore, businessRef, noShowTimeoutMs });
            if (autoExpiredCount > 0) {
                promotedEntryId = await autoPromoteNextPending({ firestore, businessRef, noShowTimeoutMs });
            }
        }

        let queryRef = businessRef.collection('waitlist');

        if (isHistory) {
            queryRef = queryRef.where('status', 'in', Array.from(HISTORY_STATUSES));
        } else {
            queryRef = queryRef.where('status', 'in', Array.from(ACTIVE_STATUSES));
        }

        const waitlistSnap = await queryRef.get();

        const entries = waitlistSnap.docs.map((doc) => {
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
            };
        });

        entries.sort((a, b) => {
            const pA = normalizeQueuePriority(a.queuePriority, 2);
            const pB = normalizeQueuePriority(b.queuePriority, 2);
            if (pA !== pB) return pA - pB;
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateA - dateB;
        });

        const capacity = await getManualCapacityMetrics({
            businessRef,
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
                promotedEntryId,
                capacity,
            }
        }, { status: 200 });

    } catch (error) {
        console.error("GET OWNER WAITLIST ERROR:", error);
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
            PERMISSIONS.MANAGE_DINE_IN
        );
        const { businessId, businessSnap } = context;
        const firestore = await getFirestore();
        const { entryId, status } = await req.json();

        if (!entryId || !status) {
            return NextResponse.json({ message: 'Entry ID and status are required.' }, { status: 400 });
        }

        const allowedStatuses = ['pending', 'notified', 'arrived', 'seated', 'cancelled', 'no_show'];
        if (!allowedStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status.' }, { status: 400 });
        }

        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data() || {};
        const waitlistSeatingMode = normalizeWaitlistSeatingMode(businessData.waitlistSeatingMode);
        const waitlistManualCapacity = Math.max(1, Number(businessData.waitlistManualCapacity || DEFAULT_WAITLIST_MANUAL_CAPACITY));
        const noShowTimeoutMinutes = normalizeNoShowTimeoutMinutes(businessData.waitlistNoShowTimeoutMinutes);
        const noShowTimeoutMs = toNoShowTimeoutMs(noShowTimeoutMinutes);

        const entryRef = businessRef.collection('waitlist').doc(entryId);
        const entrySnap = await entryRef.get();

        if (!entrySnap.exists) {
            return NextResponse.json({ message: 'Waitlist entry not found.' }, { status: 404 });
        }

        const entryData = entrySnap.data() || {};
        const normalizedPhone = String(entryData.phone || '').trim();
        const activePhoneLockRef = normalizedPhone
            ? businessRef.collection('waitlist_active_phone').doc(normalizedPhone)
            : null;

        const previousStatus = String(entryData.status || '').toLowerCase();

        await firestore.runTransaction(async (transaction) => {
            const lockSnap = activePhoneLockRef
                ? await transaction.get(activePhoneLockRef)
                : null;

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
            }
            if (status === 'cancelled') {
                updatePayload.cancelledAt = FieldValue.serverTimestamp();
            }
            if (status === 'no_show') {
                updatePayload.noShowAt = FieldValue.serverTimestamp();
            }

            transaction.update(entryRef, {
                ...updatePayload
            });

            if (!activePhoneLockRef) return;
            if (ACTIVE_STATUSES.has(status)) {
                transaction.set(activePhoneLockRef, {
                    phone: normalizedPhone,
                    entryId,
                    status: 'active',
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                return;
            }

            if (lockSnap.exists) {
                const lockEntryId = String(lockSnap.data()?.entryId || '').trim();
                if (lockEntryId === entryId) {
                    transaction.delete(activePhoneLockRef);
                }
            }
        });

        const shouldPromoteNext = previousStatus === 'notified' && ['seated', 'cancelled', 'no_show'].includes(status);
        const promotedEntryId = shouldPromoteNext
            ? await autoPromoteNextPending({ firestore, businessRef, noShowTimeoutMs })
            : null;
        const capacity = await getManualCapacityMetrics({
            businessRef,
            manualCapacity: waitlistManualCapacity,
        });
        const warning = (status === 'seated' && waitlistSeatingMode === 'manual_seat' && capacity.softAlert)
            ? capacity.message
            : null;

        return NextResponse.json({
            message: `Status updated to ${status}`,
            promotedEntryId,
            warning,
            capacity,
        }, { status: 200 });

    } catch (error) {
        console.error("PATCH OWNER WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
