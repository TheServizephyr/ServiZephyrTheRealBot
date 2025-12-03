
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const { phone, token, restaurantId } = await req.json();

        if (!phone || !token || !restaurantId) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // 1. Verify Session Token
        const tokenDoc = await firestore.collection('auth_tokens').doc(token).get();
        if (!tokenDoc.exists) {
            return NextResponse.json({ message: 'Invalid session token' }, { status: 401 });
        }

        const tokenData = tokenDoc.data();
        if (tokenData.phone !== phone) {
            return NextResponse.json({ message: 'Token mismatch' }, { status: 403 });
        }
        if (tokenData.expiresAt.toDate() < new Date()) {
            return NextResponse.json({ message: 'Session expired' }, { status: 401 });
        }

        // 2. Query for Active Order
        // Statuses considered "active": pending, accepted, preparing, ready, ready_for_pickup
        // Statuses considered "closed": delivered, picked_up, rejected, cancelled

        const ordersRef = firestore.collection('orders');
        const activeOrderQuery = await ordersRef
            .where('restaurantId', '==', restaurantId)
            .where('customer.phone', '==', phone)
            .where('status', 'in', ['pending', 'accepted', 'preparing', 'ready', 'ready_for_pickup'])
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (activeOrderQuery.empty) {
            return NextResponse.json({ activeOrder: null }, { status: 200 });
        }

        const orderDoc = activeOrderQuery.docs[0];
        const orderData = orderDoc.data();

        return NextResponse.json({
            activeOrder: {
                orderId: orderDoc.id,
                status: orderData.status,
                trackingToken: orderData.trackingToken || token, // Use existing or current token
                restaurantId: orderData.restaurantId
            }
        }, { status: 200 });

    } catch (error) {
        console.error("API Error /api/order/active:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
