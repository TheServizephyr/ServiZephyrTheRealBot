import { NextResponse } from 'next/server';
import { kv, isKvConfigured } from '@/lib/kv';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { sendAdminSystemMessage, hashOtp, generateFourDigitOtp, getAdminSystemConfig } from '@/lib/admin-system';
import {
    ORDER_CANCELLATION_OTP_MAX_ATTEMPTS,
    ORDER_CANCELLATION_OTP_TTL_MINUTES,
    buildCancellationLookupPayload,
    buildCancellationSnapshot,
    buildOtpChallengeId,
    cancelManualBill,
    createOtpChallenge,
    canOwnerCancelOnlineOrder,
} from '@/lib/order-cancellation';
import { clearOrderStatusCache } from '@/lib/orderStatusCache';
import { applyInventoryMovementTransaction, isInventoryManagedBusinessType } from '@/lib/server/inventory';

export const dynamic = 'force-dynamic';

const sanitizeText = (value, fallback = '') => String(value || fallback).trim();

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};

async function findOnlineOrderDoc(firestore, businessId, lookupId) {
    const normalizedId = sanitizeText(lookupId);
    if (!normalizedId) return null;

    const directDoc = await firestore.collection('orders').doc(normalizedId).get();
    if (directDoc.exists && directDoc.data()?.restaurantId === businessId) {
        return directDoc;
    }

    const byCustomerOrderId = await firestore
        .collection('orders')
        .where('restaurantId', '==', businessId)
        .where('customerOrderId', '==', normalizedId)
        .limit(1)
        .get();

    if (!byCustomerOrderId.empty) return byCustomerOrderId.docs[0];
    return null;
}

async function findManualOrderDoc(businessRef, lookupId) {
    const normalizedId = sanitizeText(lookupId);
    if (!normalizedId) return null;

    const historyRef = businessRef.collection('custom_bill_history');
    const directDoc = await historyRef.doc(normalizedId).get();
    if (directDoc.exists) return directDoc;

    const byCustomerOrderId = await historyRef.where('customerOrderId', '==', normalizedId).limit(1).get();
    if (!byCustomerOrderId.empty) return byCustomerOrderId.docs[0];

    const byHistoryId = await historyRef.where('historyId', '==', normalizedId).limit(1).get();
    if (!byHistoryId.empty) return byHistoryId.docs[0];

    return null;
}

async function resolveOrderForCancellation({ firestore, businessSnap, collectionName, businessId, lookupId }) {
    const onlineDoc = await findOnlineOrderDoc(firestore, businessId, lookupId);
    if (onlineDoc) {
        return {
            source: 'online',
            doc: onlineDoc,
            payload: buildCancellationLookupPayload({
                source: 'online',
                docId: onlineDoc.id,
                data: onlineDoc.data() || {},
                collectionName,
                businessId,
            }),
        };
    }

    const manualDoc = await findManualOrderDoc(businessSnap.ref, lookupId);
    if (manualDoc) {
        return {
            source: 'manual',
            doc: manualDoc,
            payload: buildCancellationLookupPayload({
                source: 'manual',
                docId: manualDoc.id,
                data: manualDoc.data() || {},
                collectionName,
                businessId,
            }),
        };
    }

    return null;
}

async function cancelOnlineOrder({
    firestore,
    businessSnap,
    collectionName,
    orderDoc,
    actorUid,
    actorRole,
    reason,
    otpChallengeId,
}) {
    const data = orderDoc.data() || {};
    if (!canOwnerCancelOnlineOrder(data)) {
        throw new Error(`This order cannot be cancelled from status "${data.status || 'unknown'}".`);
    }

    const businessType = data.businessType || businessSnap?.data()?.businessType || (collectionName === 'shops' ? 'store' : 'restaurant');
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
                referenceId: orderDoc.id,
                referenceType: 'order_cancel',
                note: 'Order cancelled after OTP verification',
            });

            transaction.update(orderDoc.ref, {
                status: 'cancelled',
                paymentStatus: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp(),
                cancelledBy: 'owner',
                cancelledByUid: actorUid,
                cancellationReason: String(reason || '').trim() || 'Cancelled after customer request',
                cancellationOtpChallengeId: otpChallengeId || null,
                cancellationOtpVerifiedAt: FieldValue.serverTimestamp(),
                inventoryState: 'restored',
                inventoryRestoredAt: FieldValue.serverTimestamp(),
                cancellationSnapshot: buildCancellationSnapshot(data),
            });
        });
    } else {
        await orderDoc.ref.update({
            status: 'cancelled',
            paymentStatus: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: 'owner',
            cancelledByUid: actorUid,
            cancellationReason: String(reason || '').trim() || 'Cancelled after customer request',
            cancellationOtpChallengeId: otpChallengeId || null,
            cancellationOtpVerifiedAt: FieldValue.serverTimestamp(),
            cancellationSnapshot: buildCancellationSnapshot(data),
        });
    }

    if (data.deliveryType === 'dine-in' && data.dineInTabId && data.totalAmount) {
        const tabRef = businessSnap.ref.collection('dineInTabs').doc(data.dineInTabId);
        const tabSnap = await tabRef.get();
        if (tabSnap.exists) {
            await tabRef.set({
                totalBill: FieldValue.increment(-Number(data.totalAmount || 0)),
            }, { merge: true });
        }
    }

    if (isKvConfigured()) {
        try {
            await clearOrderStatusCache(kv, {
                orderId: orderDoc.id,
                dineInTabId: data.dineInTabId || null,
                tabId: data.tabId || null,
            });
        } catch (error) {
            console.warn('[Order Cancellation] Cache clear failed:', error?.message || error);
        }
    }
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'cancel_order',
            {},
            false,
            [PERMISSIONS.CANCEL_ORDER, PERMISSIONS.UPDATE_ORDER_STATUS, PERMISSIONS.VIEW_ORDERS, PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName, businessSnap, uid, callerRole } = context;
        const firestore = await getFirestore();
        const body = await req.json();
        const action = sanitizeText(body?.action, '').toLowerCase();
        const lookupId = sanitizeText(body?.orderId, '');
        const reason = sanitizeText(body?.reason, '');

        if (!lookupId) {
            return NextResponse.json({ message: 'Order ID is required.' }, { status: 400 });
        }

        const resolved = await resolveOrderForCancellation({
            firestore,
            businessSnap,
            collectionName,
            businessId,
            lookupId,
        });

        if (!resolved) {
            return NextResponse.json({ message: 'Order not found for this business.' }, { status: 404 });
        }

        const adminConfig = await getAdminSystemConfig(firestore);
        const botDisplayNumber = adminConfig.botDisplayNumber || '';

        if (action === 'lookup') {
            return NextResponse.json({ 
                order: resolved.payload,
                botDisplayNumber,
            }, { status: 200 });
        }

        if (action !== 'request_otp') {
            return NextResponse.json({ message: 'Unsupported action.' }, { status: 400 });
        }

        if (!resolved.payload.canCancel) {
            return NextResponse.json({ message: resolved.payload.cancelBlockedReason || 'This order cannot be cancelled.' }, { status: 400 });
        }

        if (!reason || reason.length < 5) {
            return NextResponse.json({ message: 'Cancellation reason is required.' }, { status: 400 });
        }

        const ownerWhatsapp = normalizePhone(
            businessSnap.data()?.ownerPersonalWhatsappNumber || ''
        );

        if (!ownerWhatsapp || ownerWhatsapp.length < 10) {
            return NextResponse.json({
                message: 'Owner personal WhatsApp number is not configured in this business record.',
            }, { status: 400 });
        }

        const otp = generateFourDigitOtp();
        const challengeId = buildOtpChallengeId({
            businessId,
            orderId: resolved.doc.id,
            source: resolved.source,
        });

        await createOtpChallenge({
            firestore,
            challengeId,
            hashedOtp: hashOtp(otp),
            businessId,
            collectionName,
            ownerUid: uid,
            ownerPhone: ownerWhatsapp,
            source: resolved.source,
            orderDocId: resolved.doc.id,
            displayOrderId: resolved.payload.orderId,
            reason,
        });

        await sendAdminSystemMessage({
            phoneNumber: ownerWhatsapp,
            customerName: businessSnap.data()?.restaurantName || businessSnap.data()?.name || 'Owner',
            preview: `Cancellation OTP for order ${resolved.payload.orderId}`,
            messageText:
                `Order cancellation OTP\n\n` +
                `Order ID: ${resolved.payload.orderId}\n` +
                `Reason: ${reason}\n` +
                `OTP: *${otp}*\n\n` +
                `This OTP will expire in ${ORDER_CANCELLATION_OTP_TTL_MINUTES} minutes. Do not share it with anyone.`,
            metadata: {
                type: 'order_cancellation_otp',
                orderId: resolved.payload.orderId,
                source: resolved.source,
                challengeId,
            },
        });

        return NextResponse.json({
            message: 'OTP sent successfully.',
            challengeId,
            maskedPhone: `******${ownerWhatsapp.slice(-4)}`,
            order: resolved.payload,
            botDisplayNumber,
        }, { status: 200 });
    } catch (error) {
        console.error('[Owner Order Cancellation][POST] Error:', error);
        return NextResponse.json({ message: error.message || 'Cancellation lookup failed.' }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'cancel_order',
            {},
            false,
            [PERMISSIONS.CANCEL_ORDER, PERMISSIONS.UPDATE_ORDER_STATUS, PERMISSIONS.VIEW_ORDERS, PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName, businessSnap, uid, callerRole } = context;
        const firestore = await getFirestore();
        const body = await req.json();

        const challengeId = sanitizeText(body?.challengeId, '');
        const otp = sanitizeText(body?.otp, '');

        if (!challengeId || !otp) {
            return NextResponse.json({ message: 'Challenge ID and OTP are required.' }, { status: 400 });
        }

        const challengeRef = firestore
            .collection('admins')
            .doc('servizephyr')
            .collection('order_cancellation_otps')
            .doc(challengeId);

        const challengeSnap = await challengeRef.get();
        if (!challengeSnap.exists) {
            return NextResponse.json({ message: 'Invalid cancellation OTP challenge.' }, { status: 404 });
        }

        const challenge = challengeSnap.data() || {};
        if (challenge.businessId !== businessId || challenge.collectionName !== collectionName) {
            return NextResponse.json({ message: 'This OTP challenge does not belong to the current business.' }, { status: 403 });
        }
        if (challenge.status === 'used') {
            return NextResponse.json({ message: 'This OTP has already been used.' }, { status: 400 });
        }
        if (new Date(challenge.expiresAtIso).getTime() < Date.now()) {
            await challengeRef.set({ status: 'expired' }, { merge: true });
            return NextResponse.json({ message: 'This OTP has expired. Please request a fresh OTP.' }, { status: 400 });
        }

        const otpHash = hashOtp(otp);
        if (otpHash !== challenge.otpHash) {
            const attemptsRemaining = Math.max(0, Number(challenge.attemptsRemaining || ORDER_CANCELLATION_OTP_MAX_ATTEMPTS) - 1);
            await challengeRef.set({
                attemptsRemaining,
                status: attemptsRemaining > 0 ? 'pending' : 'failed',
                lastFailedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            return NextResponse.json({
                message: attemptsRemaining > 0 ? `Invalid OTP. ${attemptsRemaining} attempts remaining.` : 'OTP verification failed. Please request a new OTP.',
            }, { status: 400 });
        }

        let doc = null;
        if (challenge.source === 'online') {
            doc = await firestore.collection('orders').doc(challenge.orderDocId).get();
        } else if (challenge.source === 'manual') {
            doc = await businessSnap.ref.collection('custom_bill_history').doc(challenge.orderDocId).get();
        }

        if (!doc?.exists) {
            return NextResponse.json({ message: 'Order could not be found anymore.' }, { status: 404 });
        }

        if (challenge.source === 'manual') {
            await cancelManualBill({
                firestore,
                businessSnap,
                collectionName,
                businessId,
                manualDoc: doc,
                actorUid: uid,
                actorRole: callerRole,
                reason: challenge.reason,
                otpChallengeId: challengeId,
            });
        } else {
            await cancelOnlineOrder({
                firestore,
                businessSnap,
                collectionName,
                orderDoc: doc,
                actorUid: uid,
                actorRole: callerRole,
                reason: challenge.reason,
                otpChallengeId: challengeId,
            });
        }

        await challengeRef.set({
            status: 'used',
            verifiedAt: FieldValue.serverTimestamp(),
            usedAt: FieldValue.serverTimestamp(),
            otpHash: null,
        }, { merge: true });

        return NextResponse.json({
            message: 'Order cancelled successfully.',
            orderId: challenge.displayOrderId,
            source: challenge.source,
        }, { status: 200 });
    } catch (error) {
        console.error('[Owner Order Cancellation][PATCH] Error:', error);
        return NextResponse.json({ message: error.message || 'OTP verification failed.' }, { status: error.status || 500 });
    }
}
