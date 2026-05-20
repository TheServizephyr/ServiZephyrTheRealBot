/**
 * RAZORPAY WEBHOOK HANDLER
 * 
 * Processes Razorpay webhook events with idempotency protection.
 * 
 * Phase 5 Stage 4.2
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { incrementMetric, METRICS } from '@/lib/metrics';
import { releaseCouponForOrder, reserveCouponForOrder } from '@/lib/server/orderLifecycle';

/**
 * Handle Razorpay webhook event
 * 
 * Common events:
 * - payment.captured
 * - payment.failed
 * - order.paid
 */
export async function handleRazorpayWebhook(payload) {
    const eventType = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;
    const orderEntity = payload.payload?.order?.entity;

    logger.info('Razorpay webhook received', {
        eventType,
        eventId: payload.event_id || payload.id,
        orderId: paymentEntity?.notes?.firestore_order_id || orderEntity?.notes?.firestore_order_id
    });

    switch (eventType) {
        case 'payment.captured':
            return await handlePaymentCaptured(paymentEntity);

        case 'payment.failed':
            return await handlePaymentFailed(paymentEntity);

        case 'order.paid':
            return await handleOrderPaid(orderEntity);

        default:
            logger.warn('Unknown Razorpay event type', { eventType });
            return { status: 'ignored', eventType };
    }
}

/**
 * Handle payment.captured event
 */
async function handlePaymentCaptured(paymentEntity) {
    const firestore = await getFirestore();

    // Extract order ID from notes
    const notes = paymentEntity.notes || {};
    const firestoreOrderId = notes.firestore_order_id;

    if (!firestoreOrderId) {
        logger.error('Missing firestore_order_id in payment notes', {
            razorpayPaymentId: paymentEntity.id
        });
        throw new Error('Missing firestore_order_id in webhook payload');
    }

    logger.info('Processing payment.captured', {
        firestoreOrderId,
        razorpayPaymentId: paymentEntity.id,
        amount: paymentEntity.amount / 100 // Convert paise to rupees
    });

    if (String(notes.dine_in_settlement || '').toLowerCase() === 'true') {
        return await handleDineInSettlementCaptured({
            firestore,
            paymentEntity,
            notes,
            anchorOrderId: firestoreOrderId
        });
    }

    // Update order
    const orderRef = firestore.collection('orders').doc(firestoreOrderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
        logger.error('Order not found', { firestoreOrderId });
        throw new Error(`Order ${firestoreOrderId} not found`);
    }

    const orderData = orderSnap.data();

    // Only update if currently awaiting_payment
    if (orderData.status !== 'awaiting_payment') {
        logger.warn('Order not in awaiting_payment status', {
            firestoreOrderId,
            currentStatus: orderData.status
        });
        return { status: 'ignored', reason: 'Order already processed' };
    }

    // Update order status
    await orderRef.update({
        status: 'pending',
        paymentDetails: FieldValue.arrayUnion({
            method: 'razorpay',
            razorpay_payment_id: paymentEntity.id,
            razorpay_order_id: paymentEntity.order_id,
            status: 'success',
            amount: paymentEntity.amount / 100,
            timestamp: new Date()
        }),
        updatedAt: FieldValue.serverTimestamp()
    });

    await reserveCouponForOrder({
        firestore,
        orderRef,
        orderData: {
            ...orderData,
            status: 'pending',
        },
    }).catch((error) => {
        logger.error('Coupon reservation sync failed after Razorpay capture', {
            firestoreOrderId,
            error: error?.message || error,
        });
    });

    logger.info('Order status updated to pending', { firestoreOrderId });

    // Increment metrics (best-effort, after success)
    await incrementMetric(METRICS.PAYMENTS_SUCCESS);

    return { status: 'success', orderId: firestoreOrderId };
}

async function getBusinessRefForSettlement(firestore, restaurantId) {
    let businessRef = firestore.collection('restaurants').doc(String(restaurantId));
    let businessSnap = await businessRef.get();
    if (businessSnap.exists) return businessRef;

    businessRef = firestore.collection('shops').doc(String(restaurantId));
    businessSnap = await businessRef.get();
    if (businessSnap.exists) return businessRef;

    return null;
}

async function handleDineInSettlementCaptured({ firestore, paymentEntity, notes, anchorOrderId }) {
    const restaurantId = String(notes.restaurant_id || '').trim();
    const dineInTabId = String(notes.dine_in_tab_id || '').trim();

    if (!restaurantId || !dineInTabId) {
        logger.error('Missing dine-in settlement metadata', {
            anchorOrderId,
            razorpayPaymentId: paymentEntity.id,
            restaurantId,
            dineInTabId
        });
        throw new Error('Missing dine-in settlement metadata');
    }

    const ordersById = new Map();
    const addOrders = async (fieldName) => {
        const snap = await firestore.collection('orders')
            .where('restaurantId', '==', restaurantId)
            .where('deliveryType', '==', 'dine-in')
            .where(fieldName, '==', dineInTabId)
            .get();
        snap.docs.forEach((doc) => ordersById.set(doc.id, doc));
    };

    await addOrders('dineInTabId');
    await addOrders('tabId');

    if (ordersById.size === 0) {
        logger.error('No orders found for dine-in settlement', {
            anchorOrderId,
            restaurantId,
            dineInTabId
        });
        throw new Error('No orders found for dine-in settlement');
    }

    const paymentDetail = {
        method: 'razorpay',
        razorpay_payment_id: paymentEntity.id,
        razorpay_order_id: paymentEntity.order_id,
        status: 'success',
        amount: paymentEntity.amount / 100,
        scope: 'dine_in_tab',
        timestamp: new Date()
    };

    const batch = firestore.batch();
    const tableIds = new Set();
    let updatedOrders = 0;

    ordersById.forEach((orderDoc) => {
        const orderData = orderDoc.data() || {};
        const status = String(orderData.status || '').toLowerCase();
        if (['rejected', 'cancelled', 'picked_up'].includes(status)) return;
        if (orderData.tableId) tableIds.add(String(orderData.tableId));
        batch.set(orderDoc.ref, {
            paymentStatus: 'paid',
            paymentMethod: 'razorpay',
            paidAt: FieldValue.serverTimestamp(),
            paymentDetails: FieldValue.arrayUnion(paymentDetail),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        updatedOrders++;
    });

    const businessRef = await getBusinessRefForSettlement(firestore, restaurantId);
    if (businessRef) {
        batch.set(businessRef.collection('dineInTabs').doc(dineInTabId), {
            paymentStatus: 'paid',
            paymentMethod: 'razorpay',
            paidAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });

        tableIds.forEach((tableId) => {
            batch.set(businessRef.collection('tables').doc(tableId), {
                state: 'needs_cleaning',
                paymentReceivedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        });
    }

    await batch.commit();
    await incrementMetric(METRICS.PAYMENTS_SUCCESS);

    logger.info('Dine-in tab settlement captured', {
        anchorOrderId,
        restaurantId,
        dineInTabId,
        updatedOrders
    });

    return {
        status: 'success',
        scope: 'dine_in_tab',
        tabId: dineInTabId,
        updatedOrders
    };
}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(paymentEntity) {
    const firestoreOrderId = paymentEntity.notes?.firestore_order_id;

    if (!firestoreOrderId) {
        return { status: 'ignored', reason: 'Missing firestore_order_id' };
    }

    logger.warn('Payment failed', {
        firestoreOrderId,
        razorpayPaymentId: paymentEntity.id,
        reason: paymentEntity.error_reason
    });

    const firestore = await getFirestore();
    const orderRef = firestore.collection('orders').doc(firestoreOrderId);
    const orderSnap = await orderRef.get();

    await orderRef.update({
        paymentDetails: FieldValue.arrayUnion({
            method: 'razorpay',
            razorpay_payment_id: paymentEntity.id,
            status: 'failed',
            error: paymentEntity.error_reason,
            timestamp: new Date()
        }),
        updatedAt: FieldValue.serverTimestamp()
    });

    if (orderSnap.exists) {
        await releaseCouponForOrder({
            firestore,
            orderRef,
            orderData: {
                ...(orderSnap.data() || {}),
                status: 'payment_failed',
            },
        }).catch((error) => {
            logger.error('Coupon release sync failed after Razorpay failure', {
                firestoreOrderId,
                error: error?.message || error,
            });
        });
    }

    // Increment metrics
    await incrementMetric(METRICS.PAYMENTS_FAILED);

    return { status: 'recorded', orderId: firestoreOrderId };
}

/**
 * Handle order.paid event
 */
async function handleOrderPaid(orderEntity) {
    const firestoreOrderId = orderEntity.notes?.firestore_order_id;

    if (!firestoreOrderId) {
        return { status: 'ignored', reason: 'Missing firestore_order_id' };
    }

    logger.info('Order paid event', {
        firestoreOrderId,
        razorpayOrderId: orderEntity.id
    });

    // This is typically redundant with payment.captured
    // But we can use it as a backup

    return { status: 'acknowledged', orderId: firestoreOrderId };
}
