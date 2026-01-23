import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle OPTIONS request for CORS preflight
export async function OPTIONS(req) {
    return NextResponse.json({}, { headers: corsHeaders });
}

// Cleanup endpoint - ADMIN ONLY
// Usage: POST /api/admin/cleanup-loadtest-orders
export async function POST(req) {
    try {
        const firestore = await getFirestore();

        console.log('[CLEANUP] Starting LoadTest order cleanup...');

        // Step 1: Find ashwani's-restaurant (flexible search)
        const collections = ['restaurants', 'shops', 'street_vendors'];
        let restaurantId = null;
        let collectionUsed = null;

        for (const col of collections) {
            console.log(`[CLEANUP] Searching in ${col}...`);

            // Try exact match first
            let snapshot = await firestore.collection(col)
                .where('restaurantName', '==', "ashwani's-restaurant")
                .limit(1)
                .get();

            // If not found, try with 'name' field
            if (snapshot.empty) {
                snapshot = await firestore.collection(col)
                    .where('name', '==', "ashwani's-restaurant")
                    .limit(1)
                    .get();
            }

            // If still not found, get all and search manually (case-insensitive)
            if (snapshot.empty) {
                const allDocs = await firestore.collection(col).get();
                const found = allDocs.docs.find(doc => {
                    const data = doc.data();
                    const name = (data.restaurantName || data.name || '').toLowerCase();
                    return name.includes('ashwani') || name.includes('ashwani');
                });

                if (found) {
                    restaurantId = found.id;
                    collectionUsed = col;
                    console.log(`[CLEANUP] Found restaurant via manual search: ${restaurantId} (${found.data().restaurantName || found.data().name})`);
                    break;
                }
            } else {
                restaurantId = snapshot.docs[0].id;
                collectionUsed = col;
                console.log(`[CLEANUP] Found restaurant: ${restaurantId} in ${col}`);
                break;
            }
        }

        if (!restaurantId) {
            return NextResponse.json({
                success: false,
                message: 'Restaurant not found'
            }, { status: 404, headers: corsHeaders });
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
            }, { headers: corsHeaders });
        }

        // Step 4: Batch cancel
        const batch = firestore.batch();

        loadTestOrders.forEach(order => {
            const orderRef = firestore.collection('orders').doc(order.id);
            batch.update(orderRef, {
                status: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp(),
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
        }, { headers: corsHeaders });

    } catch (error) {
        console.error('[CLEANUP] Error:', error);
        return NextResponse.json({
            success: false,
            message: error.message
        }, { status: 500, headers: corsHeaders });
    }
}
