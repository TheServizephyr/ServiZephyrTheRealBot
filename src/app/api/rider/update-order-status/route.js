import { NextResponse } from 'next/server';
import { getFirestore, getDatabase, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';
import { sendOrderStatusUpdateToCustomer } from '@/lib/notifications';
import { kv } from '@vercel/kv';

export async function PATCH(req) {
    console.log("[API update-order-status] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderId, newStatus } = await req.json();
        if (!orderId || !newStatus) {
            return NextResponse.json({ message: 'Order ID and new status are required.' }, { status: 400 });
        }

        const validStatuses = ['ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived', 'delivered', 'failed_delivery'];
        if (!validStatuses.includes(newStatus)) {
            return NextResponse.json({ message: 'Invalid status provided for rider update.' }, { status: 400 });
        }

        console.log(`[API update-order-status] Rider ${uid} is updating order ${orderId} to ${newStatus}`);

        const orderRef = firestore.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
        }

        const orderData = orderDoc.data();
        const restaurantId = orderData.restaurantId;
        const businessType = orderData.businessType || 'restaurant';
        const collectionName = businessType === 'shop' ? 'shops' : 'restaurants';

        // Security Check: Ensure the order is actually assigned to this rider
        if (orderData.deliveryBoyId !== uid) {
            console.warn(`[API update-order-status] SECURITY ALERT: Rider ${uid} attempted to update order ${orderId} which is assigned to ${orderData.deliveryBoyId}.`);
            return NextResponse.json({ message: 'You are not authorized to update this order.' }, { status: 403 });
        }

        const batch = firestore.batch();

        // 1. Update the order status
        batch.update(orderRef, {
            status: newStatus,
            statusHistory: FieldValue.arrayUnion({
                status: newStatus,
                timestamp: new Date()
            })
        });

        const driverRef = firestore.collection('drivers').doc(uid);
        const businessRiderRef = firestore.collection(collectionName).doc(restaurantId).collection('deliveryBoys').doc(uid);

        // --- START: NEW STATS UPDATE LOGIC ---
        if (newStatus === 'delivered') {
            const tipAmount = orderData.tipAmount || 0;
            // Delivery fee logic might be separate, but sticking to previous simple logic:
            const earningsFromOrder = tipAmount;

            // Prepare update data for driver
            const driverUpdateData = {
                totalEarnings: FieldValue.increment(earningsFromOrder),
                walletBalance: FieldValue.increment(earningsFromOrder),
                totalDeliveries: FieldValue.increment(1)
            };

            // ✅ AVG TIME CALCULATION
            // Find when the order was picked up to calculate duration
            const pickedUpEntry = (orderData.statusHistory || []).find(h => h.status === 'picked_up') ||
                (orderData.statusHistory || []).find(h => h.status === 'dispatched') ||
                (orderData.statusHistory || []).find(h => h.status === 'reached_restaurant'); // Robust fallback

            if (pickedUpEntry && pickedUpEntry.timestamp) {
                const startTime = pickedUpEntry.timestamp.toDate ? pickedUpEntry.timestamp.toDate().getTime() : new Date(pickedUpEntry.timestamp).getTime();
                const endTime = Date.now();
                const durationMinutes = Math.round((endTime - startTime) / (1000 * 60));

                if (durationMinutes > 0 && durationMinutes < 600) { // Sanity check: 0 to 10 hours
                    // Need to fetch current driver stats to calculate new average
                    const driverDoc = await driverRef.get();
                    const currentTotal = driverDoc.exists ? (driverDoc.data()?.totalDeliveries || 0) : 0;
                    const currentAvg = driverDoc.exists ? (driverDoc.data()?.avgDeliveryTime || 0) : 0;

                    // Formula: New Avg = ((Old Avg * Old Count) + New Duration) / New Count
                    // Note: totalDeliveries is being incremented in this same batch, so we use currentTotal + 1 as divisor
                    const newAvg = Math.round(((currentAvg * currentTotal) + durationMinutes) / (currentTotal + 1));
                    driverUpdateData.avgDeliveryTime = newAvg;
                    console.log(`[API Stats] Updating Avg Time for Rider ${uid}: Old(${currentAvg}m) -> New(${newAvg}m) [Duration: ${durationMinutes}m]`);
                }
            }

            // Apply updates to main driver profile
            batch.update(driverRef, driverUpdateData);

            // Increment stats in the business's subcollection for that rider
            batch.update(businessRiderRef, {
                totalDeliveries: FieldValue.increment(1),
            });
        }
        // --- END: NEW STATS UPDATE LOGIC ---


        // 2. Check if the rider has any other 'on_the_way' orders
        const otherOrdersQuery = firestore.collection('orders')
            .where('deliveryBoyId', '==', uid)
            .where('status', 'in', ['ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived', 'reached_restaurant', 'picked_up', 'delivery_attempted']);

        const otherOrdersSnapshot = await otherOrdersQuery.get();

        // Filter out the current order being updated from the snapshot
        const otherActiveOrders = otherOrdersSnapshot.docs.filter(doc => doc.id !== orderId);

        // 3. If this was the last active order, set rider's status back to 'online'
        if (otherActiveOrders.length === 0) {
            console.log(`[API update-order-status] This was the last delivery for rider ${uid}. Updating status to 'online'.`);

            // ✅ Update ONLY in the main 'drivers' collection (Single Source of Truth)
            batch.update(driverRef, { status: 'online' });

            // ✅ REMOVED: Subcollection status update
            // Rider status is now exclusively managed in drivers/{uid}.status
            console.log(`[API update-order-status] Rider ${uid} is now available for new orders.`);
        } else {
            console.log(`[API update-order-status] Rider ${uid} still has ${otherActiveOrders.length} active deliveries.`);
        }

        await batch.commit();

        // ✅ RTDB Write for Real-time Tracking (Dual Write)
        try {
            const database = await getDatabase();
            const trackingRef = database.ref(`delivery_tracking/${orderId}`);

            if (newStatus === 'delivered' || newStatus === 'rejected') {
                // CLEANUP: If finalized, remove from RTDB to save space
                await trackingRef.remove();
                console.log(`[API update-order-status] 🗑️ Cleaned up RTDB for finalized order ${orderId}`);
            } else {
                // UPDATE: Sync status
                await trackingRef.set({
                    status: newStatus,
                    updatedAt: Date.now(),
                    riderId: uid,
                    token: orderData.sessionToken || 'temp_token'
                });
                console.log(`[API update-order-status] ✅ RTDB updated for order ${orderId}`);
            }
        } catch (rtdbError) {
            // Non-fatal - Firestore is source of truth
            console.warn('[API update-order-status] RTDB write/cleanup failed (non-fatal):', rtdbError);
        }

        // 🔥 CRITICAL: Invalidate Redis cache so tracking page gets fresh status immediately!
        const isKvAvailable = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
        if (isKvAvailable) {
            try {
                const cacheKey = `order_status:${orderId}`;
                await kv.del(cacheKey);
                console.log(`[API update-order-status] ✅ Cache invalidated for ${cacheKey}`);
            } catch (cacheError) {
                console.warn('[API update-order-status] Cache invalidation failed:', cacheError);
                // Non-fatal - order update still succeeded
            }
        }

        // 🔔 Send WhatsApp Notification to Customer
        try {
            const restaurantDoc = await firestore.collection(collectionName).doc(restaurantId).get();
            const restaurantData = restaurantDoc.data();
            const driverDoc = await driverRef.get();
            const driverData = driverDoc.data();

            if (restaurantData?.botPhoneNumberId && orderData.customerPhone) {
                await sendOrderStatusUpdateToCustomer({
                    customerPhone: orderData.customerPhone,
                    botPhoneNumberId: restaurantData.botPhoneNumberId,
                    customerName: orderData.customerName,
                    orderId: orderId,
                    customerOrderId: orderData.customerOrderId, // ✅ Pass Customer-facing ID
                    restaurantName: restaurantData.name || 'Restaurant',
                    status: newStatus,
                    deliveryBoy: {
                        name: driverData?.displayName || driverData?.name || 'Driver',
                        phone: driverData?.phone
                    },
                    businessType: businessType,
                    deliveryType: orderData.deliveryType, // ✅ Pass deliveryType for suppression logic
                    trackingToken: orderData.trackingToken // ✅ Pass token for secure URL
                });
                console.log(`[API update-order-status] WhatsApp notification sent for status: ${newStatus}`);
            }
        } catch (notifError) {
            console.error('[API update-order-status] WhatsApp notification failed:', notifError);
            // Don't fail the whole request if notification fails
        }

        console.log(`[API update-order-status] Order ${orderId} successfully updated to ${newStatus}.`);
        return NextResponse.json({ message: 'Order status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[API update-order-status] Error:", error);
        return NextResponse.json({ message: 'Internal server error.', error: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    return PATCH(req);
}
