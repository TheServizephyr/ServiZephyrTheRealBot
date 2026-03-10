import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { verifyScopedAuthToken } from '@/lib/public-auth';

/**
 * PATCH /api/order/update
 * Customer-side endpoint to update order payment status
 */
export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const body = await req.json();

        const { orderId, dineInTabId, paymentStatus, paymentMethod, trackingToken } = body;
        const requestedPaymentStatus = String(paymentStatus || '').trim().toLowerCase();
        const requestedPaymentMethod = String(paymentMethod || '').trim().toLowerCase();

        if (!['pay_at_counter', 'paid'].includes(requestedPaymentStatus)) {
            return NextResponse.json({ message: 'Unsupported payment status update.' }, { status: 403 });
        }

        if (!orderId && !dineInTabId) {
            return NextResponse.json(
                { message: 'Either orderId or dineInTabId is required.' },
                { status: 400 }
            );
        }

        // 🔐 AUTH & OWNERSHIP CHECK
        let uid = null;
        try {
            uid = await verifyAndGetUid(req);
        } catch (e) {
            // Might be a guest user parsing a public tracking page using a trackingToken
        }


        console.log('[API][PATCH /order/update] Updating payment status:', {
            orderId,
            dineInTabId,
            paymentStatus,
            paymentMethod,
            hasToken: !!trackingToken
        });

        // Find orders to update
        let ordersToUpdate = [];

        let queryTabId = dineInTabId;

        // If orderId looks like a tab ID, treat it as such
        if (!queryTabId && orderId && orderId.startsWith('tab_')) {
            queryTabId = orderId;
        }

        if (queryTabId) {
            // Update all orders in the tab
            const ordersSnap = await firestore
                .collection('orders')
                .where('dineInTabId', '==', queryTabId)
                .where('status', '!=', 'rejected')
                .get();

            // Check authorization: User must own at least ONE order in the tab
            if (!ordersSnap.empty) {
                const isValidToken = Boolean(trackingToken) && await (async () => {
                    for (const doc of ordersSnap.docs) {
                        const data = doc.data() || {};
                        if (!['dine-in', 'car-order'].includes(String(data.deliveryType || '').toLowerCase())) continue;
                        if (trackingToken !== data.trackingToken) continue;
                        const tokenCheck = await verifyScopedAuthToken(firestore, trackingToken, {
                            allowedTypes: ['tracking'],
                            subjectId: data.userId || data.customerId || data.customerPhone || '',
                            orderId: doc.id,
                            req,
                            auditContext: 'order_update',
                        });
                        if (tokenCheck.valid) return true;
                    }
                    return false;
                })();
                const isValidOwner = uid && ordersSnap.docs.some(doc => {
                    const data = doc.data();
                    return uid === data.userId || uid === data.customerId || uid === data.restaurantId;
                });

                if (!isValidToken && !isValidOwner) {
                    return NextResponse.json({ message: 'Unauthorized. You do not own this order tab.' }, { status: 403 });
                }
            }

            ordersToUpdate = ordersSnap.docs;
        } else if (orderId) {
            // Update single order
            const orderDoc = await firestore.collection('orders').doc(orderId).get();
            if (orderDoc.exists) {
                const orderData = orderDoc.data();
                const isDineInLike = ['dine-in', 'car-order'].includes(String(orderData?.deliveryType || '').toLowerCase());
                // Ownership check
                const tokenCheck = (trackingToken && isDineInLike && orderData.trackingToken === trackingToken)
                    ? await verifyScopedAuthToken(firestore, trackingToken, {
                        allowedTypes: ['tracking'],
                        subjectId: orderData.userId || orderData.customerId || orderData.customerPhone || '',
                        orderId,
                        req,
                        auditContext: 'order_update',
                    })
                    : { valid: false };
                const isValidToken = tokenCheck.valid === true;
                const isValidOwner = uid && (uid === orderData.userId || uid === orderData.customerId || uid === orderData.restaurantId);

                if (!isValidToken && !isValidOwner) {
                    return NextResponse.json({ message: 'Unauthorized. You do not own this order.' }, { status: 403 });
                }
                ordersToUpdate = [orderDoc];
            }
        }

        if (ordersToUpdate.length === 0) {
            return NextResponse.json(
                { message: 'No orders found to update.' },
                { status: 404 }
            );
        }

        // Update payment status for all orders
        const batch = firestore.batch();
        const updateData = {};

        if (paymentStatus) {
            updateData.paymentStatus = requestedPaymentStatus;
        }
        if (paymentMethod) {
            updateData.paymentMethod = requestedPaymentMethod;
        }

        ordersToUpdate.forEach(doc => {
            batch.update(doc.ref, updateData);
        });

        await batch.commit();

        console.log(`[API][PATCH /order/update] Updated ${ordersToUpdate.length} orders`);

        return NextResponse.json({
            success: true,
            message: `Payment status updated for ${ordersToUpdate.length} order(s)`,
            updatedOrders: ordersToUpdate.length
        });

    } catch (error) {
        console.error('[API][PATCH /order/update] Error:', error);
        return NextResponse.json(
            { message: 'Failed to update order', error: error.message },
            { status: 500 }
        );
    }
}
