import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API accept-order] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderId } = await req.json();
        if (!orderId) {
            return NextResponse.json({ message: 'Order ID is required.' }, { status: 400 });
        }

        console.log(`[API accept-order] Rider ${uid} is accepting order ${orderId}`);

        const orderRef = firestore.collection('orders').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
        }

        const orderData = orderDoc.data();

        // Security Check: Ensure the order is actually assigned to this rider
        if (orderData.deliveryBoyId !== uid) {
            console.warn(`[API accept-order] SECURITY ALERT: Rider ${uid} attempted to accept order ${orderId} which is assigned to ${orderData.deliveryBoyId}.`);
            return NextResponse.json({ message: 'You are not authorized to accept this order.' }, { status: 403 });
        }
        
        if (orderData.status !== 'dispatched') {
            return NextResponse.json({ message: `Cannot accept order. Current status is '${orderData.status}'.`}, { status: 400 });
        }

        // Update the order status
        await orderRef.update({ 
            status: 'on_the_way',
            statusHistory: FieldValue.arrayUnion({
                status: 'on_the_way',
                timestamp: new Date()
            })
        });

        // Optionally, update the rider's status in their own document
        const driverRef = firestore.collection('drivers').doc(uid);
        await driverRef.update({ status: 'on-delivery' });

        console.log(`[API accept-order] Order ${orderId} status updated to 'on_the_way' successfully.`);
        return NextResponse.json({ message: 'Order accepted successfully! You are now on the way.' }, { status: 200 });

    } catch (error) {
        console.error("[API accept-order] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
