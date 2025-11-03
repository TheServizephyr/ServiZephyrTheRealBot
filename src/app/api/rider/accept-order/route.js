import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API accept-order] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider

        const { orderIds } = await req.json(); // Accept an array of order IDs
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ message: 'Order IDs array is required.' }, { status: 400 });
        }

        console.log(`[API accept-order] Rider ${uid} is accepting orders: ${orderIds.join(', ')}`);

        const batch = firestore.batch();
        const ordersCollectionRef = firestore.collection('orders');

        for (const orderId of orderIds) {
            const orderRef = ordersCollectionRef.doc(orderId);
            // In a real app, you might want to get the doc first to check status and assignment.
            // For simplicity here, we trust the client request.
            batch.update(orderRef, { 
                status: 'on_the_way',
                statusHistory: FieldValue.arrayUnion({
                    status: 'on_the_way',
                    timestamp: new Date()
                })
            });
        }
        
        // Update the rider's main status to 'on-delivery'
        const driverRef = firestore.collection('drivers').doc(uid);
        batch.update(driverRef, { status: 'on-delivery' });

        await batch.commit();

        console.log(`[API accept-order] Orders updated to 'on_the_way' successfully.`);
        return NextResponse.json({ message: 'Orders accepted! You are now on the way.' }, { status: 200 });

    } catch (error) {
        console.error("[API accept-order] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
