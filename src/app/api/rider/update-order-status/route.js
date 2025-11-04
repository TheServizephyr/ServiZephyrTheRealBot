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
            return NextResponse.json({ message: 'Invalid status provided for rider update.'}, { status: 400 });
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

        // 2. Check if the rider has any other 'on_the_way' orders
        const otherOrdersQuery = firestore.collection('orders')
            .where('deliveryBoyId', '==', uid)
            .where('status', 'in', ['on_the_way', 'dispatched']);
            
        const otherOrdersSnapshot = await otherOrdersQuery.get();

        // Filter out the current order being updated from the snapshot
        const otherActiveOrders = otherOrdersSnapshot.docs.filter(doc => doc.id !== orderId);

        // 3. If this was the last active order, set rider's status to 'online' in BOTH places
        if (otherActiveOrders.length === 0) {
            console.log(`[API update-order-status] This was the last delivery for rider ${uid}. Updating status to 'online'.`);
            
            // Update in the main 'drivers' collection
            const driverRef = firestore.collection('drivers').doc(uid);
            batch.update(driverRef, { status: 'online' });

            // Update in the restaurant's 'deliveryBoys' subcollection
            if (restaurantId) {
                const businessRiderRef = firestore.collection(collectionName).doc(restaurantId).collection('deliveryBoys').doc(uid);
                batch.update(businessRiderRef, { status: 'Available' });
                 console.log(`[API update-order-status] Updated status in ${collectionName}/${restaurantId}/deliveryBoys`);
            }
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
