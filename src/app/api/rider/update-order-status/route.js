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

        // Security Check: Ensure the order is actually assigned to this rider
        if (orderData.deliveryBoyId !== uid) {
            console.warn(`[API update-order-status] SECURITY ALERT: Rider ${uid} attempted to update order ${orderId} which is assigned to ${orderData.deliveryBoyId}.`);
            return NextResponse.json({ message: 'You are not authorized to update this order.' }, { status: 403 });
        }

        // Update the order status
        await orderRef.update({ 
            status: newStatus,
            statusHistory: FieldValue.arrayUnion({
                status: newStatus,
                timestamp: new Date()
            })
        });

        // After updating, check if the rider has any other 'on_the_way' orders
        const otherOrdersQuery = firestore.collection('orders')
            .where('deliveryBoyId', '==', uid)
            .where('status', '==', 'on_the_way');
            
        const otherOrdersSnapshot = await otherOrdersQuery.get();

        // If this was the last active order, set rider's status to 'online' (available)
        if (otherOrdersSnapshot.empty) {
            const driverRef = firestore.collection('drivers').doc(uid);
            await driverRef.update({ status: 'online' });
            console.log(`[API update-order-status] Rider ${uid} has no more active orders. Status set to 'online'.`);
        }

        console.log(`[API update-order-status] Order ${orderId} status updated to '${newStatus}' successfully.`);
        return NextResponse.json({ message: 'Order status updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("[API update-order-status] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
