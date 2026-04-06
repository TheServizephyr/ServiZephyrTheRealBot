/**
 * PHONEPE WEBHOOK HANDLER
 * 
 * Processes PhonePe webhook events with idempotency protection.
 * 
 * Phase 5 Stage 4.2
 */

import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { logger } from '@/lib/logger';
import { incrementMetric, METRICS } from '@/lib/metrics';
import { releaseCouponForOrder, reserveCouponForOrder } from '@/lib/server/orderLifecycle';

/**
 * Handle PhonePe webhook event
 * 
 * PhonePe typically sends:
 * - Success callback
 * - Failure callback
 */
export async function handlePhonePeWebhook(payload) {
    const { merchantTransactionId, transactionId, code, message } = payload;

    logger.info('PhonePe webhook received', {
        merchantTransactionId,
        transactionId,
        code,
        message
    });

    // Extract firestore order ID from merchantTransactionId
    // (In V1, this is typically the firestore order ID)
    const firestoreOrderId = merchantTransactionId;

    if (!firestoreOrderId) {
        logger.error('Missing merchantTransactionId in PhonePe webhook');
        throw new Error('Missing merchantTransactionId');
    }

    const isSuccess = code === 'PAYMENT_SUCCESS';

    if (isSuccess) {
        return await handlePhonePeSuccess(firestoreOrderId, payload);
    } else {
        return await handlePhonePeFailure(firestoreOrderId, payload);
    }
}

/**
 * Handle successful PhonePe payment
 */
async function handlePhonePeSuccess(firestoreOrderId, payload) {
    const firestore = await getFirestore();

    logger.info('PhonePe payment success', {
        firestoreOrderId,
        transactionId: payload.transactionId
    });

    const orderRef = firestore.collection('orders').doc(firestoreOrderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
        logger.error('Order not found', { firestoreOrderId });
        throw new Error(`Order ${firestoreOrderId} not found`);
    }

    const orderData = orderSnap.data();

    if (orderData.status !== 'awaiting_payment') {
        logger.warn('Order not awaiting payment', {
            firestoreOrderId,
            currentStatus: orderData.status
        });
        return { status: 'ignored', reason: 'Order already processed' };
    }

    // Update order
    await orderRef.update({
        status: 'pending',
        paymentDetails: FieldValue.arrayUnion({
            method: 'phonepe',
            phonepe_transaction_id: payload.transactionId,
            phonepe_merchant_transaction_id: payload.merchantTransactionId,
            status: 'success',
            amount: payload.amount / 100, // PhonePe amount in paise
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
        logger.error('Coupon reservation sync failed after PhonePe success', {
            firestoreOrderId,
            error: error?.message || error,
        });
    });

    logger.info('Order status updated to pending', { firestoreOrderId });

    // Metrics
    await incrementMetric(METRICS.PAYMENTS_SUCCESS);

    return { status: 'success', orderId: firestoreOrderId };
}

/**
 * Handle failed PhonePe payment
 */
async function handlePhonePeFailure(firestoreOrderId, payload) {
    const firestore = await getFirestore();

    logger.warn('PhonePe payment failed', {
        firestoreOrderId,
        code: payload.code,
        message: payload.message
    });

    const orderRef = firestore.collection('orders').doc(firestoreOrderId);
    const orderSnap = await orderRef.get();

    await orderRef.update({
        paymentDetails: FieldValue.arrayUnion({
            method: 'phonepe',
            phonepe_transaction_id: payload.transactionId,
            status: 'failed',
            error: payload.message,
            code: payload.code,
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
            logger.error('Coupon release sync failed after PhonePe failure', {
                firestoreOrderId,
                error: error?.message || error,
            });
        });
    }

    // Metrics
    await incrementMetric(METRICS.PAYMENTS_FAILED);

    return { status: 'recorded', orderId: firestoreOrderId };
}
