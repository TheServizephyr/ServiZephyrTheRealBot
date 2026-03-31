import { createHash } from 'crypto';
import { FieldValue } from '@/lib/firebase-admin';
import { applyInventoryMovementTransaction, isInventoryManagedBusinessType } from '@/lib/server/inventory';

const MANUAL_CANCELLED_STATUS = 'cancelled';
const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

const toAmount = (value, fallback = 0) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : fallback;
};

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const timestampToIso = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') {
        const parsed = value.toDate();
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export function buildCancellationSnapshot(entry = {}) {
    return {
        status: entry.status || null,
        totalAmount: toAmount(entry.totalAmount || entry.grandTotal, 0),
        paymentStatus: entry.paymentStatus || null,
        isSettled: !!entry.isSettled,
        settlementEligible: entry.settlementEligible ?? true,
        orderType: entry.orderType || entry.deliveryType || null,
        customerOrderId: entry.customerOrderId || null,
        customerName: entry.customerName || entry.name || null,
        customerPhone: normalizePhone(entry.customerPhone || entry.phone || ''),
        inventoryState: entry.inventoryState || null,
    };
}

export function isManualBillCancelled(entry = {}) {
    return String(entry.status || '').toLowerCase() === MANUAL_CANCELLED_STATUS;
}

export function isOnlineOrderCancelled(entry = {}) {
    return String(entry.status || '').toLowerCase() === 'cancelled';
}

export function canOwnerCancelOnlineOrder(entry = {}) {
    const status = String(entry.status || '').toLowerCase();
    if (!status) return false;
    return !['cancelled', 'delivered', 'picked_up', 'rejected', 'failed_delivery', 'returned_to_restaurant'].includes(status);
}

export function canOwnerCancelManualBill(entry = {}) {
    return !isManualBillCancelled(entry);
}

export function buildOtpChallengeId({ businessId, orderId, source }) {
    return createHash('sha256')
        .update(`${businessId}|${source}|${orderId}|${Date.now()}`)
        .digest('hex')
        .slice(0, 20);
}

export function getOtpExpiryIso() {
    return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
}

export function buildCancellationLookupPayload({ source, docId, data, collectionName, businessId }) {
    const items = Array.isArray(data.items) ? data.items : [];
    const base = {
        source,
        docId,
        businessId,
        collectionName,
        orderId: data.customerOrderId || data.historyId || docId,
        firestoreId: docId,
        customerOrderId: data.customerOrderId || null,
        status: data.status || (source === 'manual' ? 'manual_order' : null),
        orderType: data.orderType || data.deliveryType || 'delivery',
        customerName: data.customerName || data.name || 'Guest',
        customerPhone: normalizePhone(data.customerPhone || data.phone || ''),
        customerAddress: data.customerAddress || data.deliveryAddress || '',
        paymentMethod: data.paymentMethod || data.paymentMode || null,
        totalAmount: toAmount(data.totalAmount || data.grandTotal, 0),
        createdAt: timestampToIso(data.orderDate || data.printedAt || data.createdAt),
        items: items.map((item) => ({
            id: item.id || null,
            name: item.name || item.itemName || 'Item',
            quantity: Number(item.quantity || item.qty || 1) || 1,
            price: toAmount(item.totalPrice || item.serverVerifiedTotal || item.price, 0),
            variant: item.variant || item.selectedVariant || item.portionName || '',
        })),
        cancellationReason: data.cancellationReason || null,
        cancelledAt: timestampToIso(data.cancelledAt),
        cancellationSnapshot: buildCancellationSnapshot(data),
    };

    return {
        ...base,
        canCancel: source === 'manual' ? canOwnerCancelManualBill(data) : canOwnerCancelOnlineOrder(data),
        cancelBlockedReason: source === 'manual'
            ? (isManualBillCancelled(data) ? 'This manual order is already cancelled.' : '')
            : (canOwnerCancelOnlineOrder(data) ? '' : `This order cannot be cancelled from status "${data.status || 'unknown'}".`),
    };
}

export async function cancelManualBill({
    firestore,
    businessSnap,
    collectionName,
    businessId,
    manualDoc,
    actorUid,
    actorRole,
    reason,
    otpChallengeId,
}) {
    const data = manualDoc.data() || {};
    if (isManualBillCancelled(data)) {
        throw new Error('This manual order is already cancelled.');
    }

    const businessType = businessSnap?.data()?.businessType || (collectionName === 'shops' ? 'store' : 'restaurant');
    const shouldRestoreInventory =
        businessSnap &&
        isInventoryManagedBusinessType(businessType) &&
        data.inventoryState === 'deducted' &&
        !data.inventoryRestoredAt;

    if (shouldRestoreInventory) {
        await firestore.runTransaction(async (transaction) => {
            await applyInventoryMovementTransaction({
                transaction,
                businessRef: businessSnap.ref,
                items: data.items || [],
                mode: 'restore',
                actorId: actorUid,
                actorRole: actorRole || 'owner',
                referenceId: manualDoc.id,
                referenceType: 'manual_order_cancel',
                note: `Manual order cancelled with OTP verification`,
            });

            transaction.update(manualDoc.ref, {
                status: MANUAL_CANCELLED_STATUS,
                cancelledAt: FieldValue.serverTimestamp(),
                cancelledByUid: actorUid,
                cancelledByRole: actorRole || 'owner',
                cancellationReason: String(reason || '').trim() || 'Cancelled after customer request',
                cancellationOtpChallengeId: otpChallengeId || null,
                cancellationOtpVerifiedAt: FieldValue.serverTimestamp(),
                settlementEligible: false,
                isSettled: false,
                settledAt: null,
                settledByUid: null,
                settledByRole: null,
                settlementBatchId: null,
                inventoryState: 'restored',
                inventoryRestoredAt: FieldValue.serverTimestamp(),
                cancellationSnapshot: buildCancellationSnapshot(data),
            });
        });
    } else {
        await manualDoc.ref.update({
            status: MANUAL_CANCELLED_STATUS,
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledByUid: actorUid,
            cancelledByRole: actorRole || 'owner',
            cancellationReason: String(reason || '').trim() || 'Cancelled after customer request',
            cancellationOtpChallengeId: otpChallengeId || null,
            cancellationOtpVerifiedAt: FieldValue.serverTimestamp(),
            settlementEligible: false,
            isSettled: false,
            settledAt: null,
            settledByUid: null,
            settledByRole: null,
            settlementBatchId: null,
            cancellationSnapshot: buildCancellationSnapshot(data),
        });
    }
}

export async function createOtpChallenge({
    firestore,
    challengeId,
    hashedOtp,
    businessId,
    collectionName,
    ownerUid,
    ownerPhone,
    source,
    orderDocId,
    displayOrderId,
    reason,
}) {
    const challengeRef = firestore
        .collection('admins')
        .doc('servizephyr')
        .collection('order_cancellation_otps')
        .doc(challengeId);

    await challengeRef.set({
        challengeId,
        type: 'order_cancellation',
        businessId,
        collectionName,
        ownerUid,
        ownerPhone: normalizePhone(ownerPhone),
        source,
        orderDocId,
        displayOrderId,
        reason: String(reason || '').trim(),
        otpHash: hashedOtp,
        attemptsRemaining: MAX_OTP_ATTEMPTS,
        createdAt: FieldValue.serverTimestamp(),
        expiresAtIso: getOtpExpiryIso(),
        verifiedAt: null,
        usedAt: null,
        status: 'pending',
    });

    return challengeRef;
}

export const ORDER_CANCELLATION_OTP_TTL_MINUTES = OTP_TTL_MINUTES;
export const ORDER_CANCELLATION_OTP_MAX_ATTEMPTS = MAX_OTP_ATTEMPTS;
