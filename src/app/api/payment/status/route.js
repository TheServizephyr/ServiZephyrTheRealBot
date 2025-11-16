
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const splitId = searchParams.get('splitId');

    if (!splitId) {
        return NextResponse.json({ message: 'Split session ID is required.' }, { status: 400 });
    }

    try {
        const firestore = await getFirestore();
        const splitDocRef = firestore.collection('split_payments').doc(splitId);
        const docSnap = await docSnap.get();

        if (!docSnap.exists) {
            return NextResponse.json({ message: 'Split payment session not found.' }, { status: 404 });
        }

        const data = docSnap.data();

        // If the session is completed, we need to provide the tracking token for the base order
        if (data.status === 'completed') {
            const orderDocRef = firestore.collection('orders').doc(data.baseOrderId);
            const orderDoc = await orderDocRef.get();
            if (orderDoc.exists()) {
                data.trackingToken = orderDoc.data().trackingToken || null;
            }
        }

        return NextResponse.json(data, { status: 200 });

    } catch (error) {
        console.error(`[API /payment/status] Error fetching split session ${splitId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
