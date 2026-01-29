import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function PATCH(req) {
    console.log("[API update-order-status] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderId, newStatus } = await req.json();
        if (!orderId || !newStatus) {
            return NextResponse.json({ message: 'Order ID and new status are required.' }, { status: 400 });
        }

        const validStatuses = ['delivered', 'delivery_failed'];
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
            const deliveryFee = orderData.deliveryCharge || 0; // Assuming owner passes this to rider
            const earningsFromOrder = tipAmount; // Can be tip + part of delivery fee

            // Increment stats in the main driver profile
            batch.update(driverRef, {
                totalDeliveries: FieldValue.increment(1),
                totalEarnings: FieldValue.increment(earningsFromOrder),
                walletBalance: FieldValue.increment(earningsFromOrder),
            });

            // Increment stats in the business's subcollection for that rider
            batch.update(businessRiderRef, {
                totalDeliveries: FieldValue.increment(1),
            });
        }
        // --- END: NEW STATS UPDATE LOGIC ---


        // 2. Check if the rider has any other 'on_the_way' orders
        const otherOrdersQuery = firestore.collection('orders')
            .where('deliveryBoyId', '==', uid)
            .where('status', 'in', ['on_the_way', 'dispatched']);

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

        console.log(`[API update-order-status] Order ${orderId} status updated to '${newStatus}' successfully.`);
        return NextResponse.json({ message: 'Order status updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("[API update-order-status] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
