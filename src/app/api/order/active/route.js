
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GET: Fetch order data by tabId (for dine-in checkout)
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const tabId = searchParams.get('tabId');

        if (!tabId) {
            return NextResponse.json({ message: 'TabId is required' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // Fetch ALL orders for this dine-in tab
        const ordersQuery = await firestore.collection('orders')
            .where('dineInTabId', '==', tabId)
            .where('status', 'not-in', ['rejected', 'picked_up'])
            .get();

        if (ordersQuery.empty) {
            return NextResponse.json({ message: 'No orders found for this tab' }, { status: 404 });
        }

        // Aggregate all items and calculate totals
        let allItems = [];
        let subtotal = 0;
        let tab_name = '';
        let customerName = '';

        ordersQuery.docs.forEach(doc => {
            const order = doc.data();
            allItems = allItems.concat(order.items || []);
            subtotal += order.subtotal || order.totalAmount || 0;
            if (!tab_name) tab_name = order.tab_name || order.customerName || '';
            if (!customerName) customerName = order.customerName || '';
        });

        return NextResponse.json({
            items: allItems,
            subtotal,
            totalAmount: subtotal,
            grandTotal: subtotal,
            tab_name,
            customerName
        }, { status: 200 });

    } catch (error) {
        console.error("GET /api/order/active error:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}


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
