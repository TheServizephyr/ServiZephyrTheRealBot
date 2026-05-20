/**
 * INITIATE PAYMENT API
 * 
 * Locks table for payment processing
 * Recalculates totals before payment
 * Prevents concurrent modifications
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { recalculateTabTotals, validateTabToken } from '@/lib/dinein-utils';
import { paymentService } from '@/services/payment/payment.service';

async function getBusinessRef(firestore, restaurantId) {
    if (!restaurantId) return null;

    let businessRef = firestore.collection('restaurants').doc(String(restaurantId));
    let businessSnap = await businessRef.get();
    if (businessSnap.exists) return businessRef;

    businessRef = firestore.collection('shops').doc(String(restaurantId));
    businessSnap = await businessRef.get();
    if (businessSnap.exists) return businessRef;

    return null;
}

async function validateOrderTrackingToken({ firestore, restaurantId, tabId, token }) {
    if (!token) return false;

    const tokenSnap = await firestore.collection('orders')
        .where('trackingToken', '==', String(token))
        .limit(20)
        .get();

    return tokenSnap.docs.some((doc) => {
        const order = doc.data() || {};
        const orderTabId = String(order.dineInTabId || order.tabId || '').trim();
        return String(order.restaurantId || '') === String(restaurantId || '')
            && String(order.deliveryType || '').toLowerCase() === 'dine-in'
            && orderTabId === String(tabId || '').trim();
    });
}

async function getTabOrders({ firestore, restaurantId, tabId }) {
    const ordersById = new Map();
    const addOrders = async (fieldName) => {
        const snap = await firestore.collection('orders')
            .where('restaurantId', '==', String(restaurantId))
            .where('deliveryType', '==', 'dine-in')
            .where(fieldName, '==', String(tabId))
            .get();
        snap.docs.forEach((doc) => ordersById.set(doc.id, doc));
    };

    await addOrders('dineInTabId');
    await addOrders('tabId');

    return Array.from(ordersById.values()).filter((doc) => {
        const order = doc.data() || {};
        const status = String(order.status || '').toLowerCase();
        return order.cleaned !== true && !['rejected', 'cancelled', 'picked_up'].includes(status);
    });
}

export async function POST(req) {
    try {
        const { tabId, token, restaurantId, paymentMethod } = await req.json();

        if (!tabId) {
            return NextResponse.json(
                { error: 'Missing required field: tabId' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();
        const businessRef = await getBusinessRef(firestore, restaurantId);

        if (businessRef) {
            const tabRef = businessRef.collection('dineInTabs').doc(String(tabId));
            const tabSnap = await tabRef.get();

            if (!tabSnap.exists) {
                return NextResponse.json({ error: 'Tab not found' }, { status: 404 });
            }

            const tokenAllowed = await validateOrderTrackingToken({
                firestore,
                restaurantId: businessRef.id,
                tabId,
                token
            });

            if (!tokenAllowed) {
                return NextResponse.json({ error: 'Invalid session token' }, { status: 401 });
            }

            const tabOrders = await getTabOrders({
                firestore,
                restaurantId: businessRef.id,
                tabId
            });

            const pendingAmount = tabOrders.reduce((sum, doc) => {
                const order = doc.data() || {};
                if (String(order.paymentStatus || '').toLowerCase() === 'paid') return sum;
                return sum + Number(order.totalAmount || order.grandTotal || 0);
            }, 0);

            if (pendingAmount <= 0.01) {
                return NextResponse.json({ error: 'No pending amount' }, { status: 400 });
            }

            const normalizedPaymentMethod = String(paymentMethod || '').trim().toLowerCase();
            const isOnlineSettlement = normalizedPaymentMethod === 'online' || normalizedPaymentMethod === 'razorpay';
            const isPhonePeSettlement = normalizedPaymentMethod === 'phonepe';
            const firstUnpaidOrder = tabOrders.find((doc) => {
                const order = doc.data() || {};
                return String(order.paymentStatus || '').toLowerCase() !== 'paid';
            });

            if (isPhonePeSettlement) {
                return NextResponse.json({
                    error: 'PhonePe settlement is not available for dine-in tab payments yet. Please use Razorpay or pay at counter.'
                }, { status: 400 });
            }

            await tabRef.set({
                paymentStatus: 'payment_pending',
                paymentInitiatedAt: FieldValue.serverTimestamp(),
                paymentMethod: paymentMethod || null,
                pendingAmount,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });

            if (isOnlineSettlement) {
                if (!firstUnpaidOrder) {
                    return NextResponse.json({ error: 'No unpaid order found for this tab' }, { status: 400 });
                }

                const gatewayOrder = await paymentService.createPaymentOrder({
                    gateway: 'razorpay',
                    amount: pendingAmount,
                    orderId: firstUnpaidOrder.id,
                    metadata: {
                        restaurant_id: businessRef.id,
                        dine_in_settlement: 'true',
                        dine_in_tab_id: String(tabId),
                        payment_scope: 'dine_in_tab'
                    },
                    servizephyrPayload: {
                        restaurantId: businessRef.id,
                        deliveryType: 'dine-in',
                        dineInTabId: String(tabId),
                        paymentScope: 'dine_in_tab',
                        settlementOrderIds: tabOrders.map((doc) => doc.id)
                    }
                });

                return NextResponse.json({
                    success: true,
                    amount: pendingAmount,
                    tabId,
                    paymentLocked: true,
                    method: 'razorpay',
                    razorpay_order_id: gatewayOrder.id
                });
            }

            return NextResponse.json({
                success: true,
                amount: pendingAmount,
                tabId,
                paymentLocked: true
            });
        }

        if (!token) {
            return NextResponse.json(
                { error: 'Missing required field: token' },
                { status: 400 }
            );
        }

        // Legacy global tab support.
        const isValid = await validateTabToken(tabId, token);
        if (!isValid) {
            return NextResponse.json(
                { error: 'Invalid token' },
                { status: 401 }
            );
        }

        const result = await firestore.runTransaction(async (transaction) => {
            const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
            const tabSnap = await transaction.get(tabRef);

            if (!tabSnap.exists) {
                throw new Error('Tab not found');
            }

            const tabData = tabSnap.data();

            // Check if already locked
            if (tabData.status === 'locked_for_payment') {
                throw new Error('Another payment is in progress');
            }

            // Lock table
            transaction.update(tabRef, {
                status: 'locked_for_payment',
                paymentInitiatedAt: FieldValue.serverTimestamp(),
                paymentMethod
            });

            return {
                pendingAmount: tabData.pendingAmount || 0
            };
        });

        // Recalculate after lock (outside transaction for performance)
        await recalculateTabTotals(tabId);

        // Get updated amount
        const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
        const updatedSnap = await tabRef.get();
        const updatedData = updatedSnap.data();

        if (updatedData.pendingAmount <= 0) {
            // Unlock if nothing to pay
            await tabRef.update({
                status: 'active',
                paymentInitiatedAt: null
            });

            return NextResponse.json(
                { error: 'No pending amount' },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            amount: updatedData.pendingAmount,
            tabId,
            paymentLocked: true
        });

    } catch (error) {
        console.error('[Initiate Payment Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to initiate payment' },
            { status: 500 }
        );
    }
}
