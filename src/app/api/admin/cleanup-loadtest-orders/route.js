import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

// Cleanup endpoint - ADMIN ONLY
// Usage: POST /api/admin/cleanup-loadtest-orders
export async function POST(req) {
    try {
        const firestore = await getFirestore();

        console.log('[CLEANUP] Starting LoadTest order cleanup...');

        // Step 1: Find ashwani's-restaurant
        const collections = ['restaurants', 'shops', 'street_vendors'];
        let restaurantId = null;

        for (const col of collections) {
            const snapshot = await firestore.collection(col)
                .where('restaurantName', '==', "ashwani's-restaurant")
                .limit(1)
                .get();

            if (!snapshot.empty) {
                restaurantId = snapshot.docs[0].id;
                console.log(`[CLEANUP] Found restaurant: ${restaurantId} in ${col}`);
                break;
            }
        }

        if (!restaurantId) {
            return NextResponse.json({
                success: false,
                message: 'Restaurant not found'
            }, { status: 404 });
        }

        // Step 2: Get all orders for this restaurant
        const ordersSnapshot = await firestore.collection('orders')
            .where('restaurantId', '==', restaurantId)
            .get();

        console.log(`[CLEANUP] Total orders: ${ordersSnapshot.size}`);

        // Step 3: Filter LoadTest orders
        const loadTestOrders = [];
        ordersSnapshot.forEach(doc => {
            const data = doc.data();
            const customerName = data.customerName || '';

            if (customerName.includes('LoadTest') ||
                customerName.includes('Test User') ||
                customerName.includes('test')) {
                if (data.status !== 'cancelled' &&
                    data.status !== 'delivered' &&
                    data.status !== 'completed') {
                    loadTestOrders.push({
                        id: doc.id,
                        customerName: customerName,
                        status: data.status
                    });
                }
            }
        });

        console.log(`[CLEANUP] LoadTest orders to cancel: ${loadTestOrders.length}`);

        if (loadTestOrders.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No LoadTest orders to cancel',
                cancelled: 0
            });
        }

        // Step 4: Batch cancel
        const batch = firestore.batch();

        loadTestOrders.forEach(order => {
            const orderRef = firestore.collection('orders').doc(order.id);
            batch.update(orderRef, {
                status: 'cancelled',
                cancelledAt: firestore.FieldValue.serverTimestamp(),
                cancelledBy: 'admin_cleanup',
                cancellationReason: 'LoadTest cleanup'
            });
        });

        await batch.commit();

        console.log(`[CLEANUP] Successfully cancelled ${loadTestOrders.length} orders`);

        return NextResponse.json({
            success: true,
            message: 'LoadTest orders cancelled successfully',
            cancelled: loadTestOrders.length,
            orders: loadTestOrders.map(o => ({ id: o.id, name: o.customerName }))
        });

    } catch (error) {
        console.error('[CLEANUP] Error:', error);
        return NextResponse.json({
            success: false,
            message: error.message
        }, { status: 500 });
    }
}
