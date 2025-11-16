

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    console.log("[DEBUG] /api/payment/status: GET request received.");
    const { searchParams } = new URL(req.url);
    const splitId = searchParams.get('splitId');
    console.log(`[DEBUG] /api/payment/status: Attempting to fetch status for splitId: ${splitId}`);


    if (!splitId) {
        console.error("[DEBUG] /api/payment/status: Error - Split session ID is required.");
        return NextResponse.json({ message: 'Split session ID is required.' }, { status: 400 });
    }

    try {
        const firestore = await getFirestore();
        const splitDocRef = firestore.collection('split_payments').doc(splitId);
        console.log(`[DEBUG] /api/payment/status: Created document reference: ${splitDocRef.path}`);
        
        const docSnap = await splitDocRef.get();

        if (!docSnap.exists) {
            console.warn(`[DEBUG] /api/payment/status: Document with ID ${splitId} does not exist.`);
            return NextResponse.json({ message: 'Split payment session not found.' }, { status: 404 });
        }

        const data = docSnap.data();
        console.log("[DEBUG] /api/payment/status: Successfully fetched data from Firestore:", JSON.stringify(data, null, 2));


        // If the session is completed, we need to provide the tracking token for the base order
        if (data.status === 'completed') {
            console.log(`[DEBUG] /api/payment/status: Session is completed. Fetching base order ${data.baseOrderId} for tracking token.`);
            const orderDocRef = firestore.collection('orders').doc(data.baseOrderId);
            const orderDoc = await orderDocRef.get();
            if (orderDoc.exists()) {
                data.trackingToken = orderDoc.data().trackingToken || null;
                console.log(`[DEBUG] /api/payment/status: Found tracking token: ${data.trackingToken}`);
            } else {
                console.warn(`[DEBUG] /api/payment/status: Base order ${data.baseOrderId} not found.`);
            }
        }

        console.log("[DEBUG] /api/payment/status: Sending response to client.");
        return NextResponse.json(data, { status: 200 });

    } catch (error) {
        console.error(`[DEBUG] CRITICAL: Error fetching split session ${splitId}:`, error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
