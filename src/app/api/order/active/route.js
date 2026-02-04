
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GET: Fetch order data by tabId (for dine-in checkout)
export async function GET(req) {
    try {
        console.log("[API] GET /order/active called");
        const { searchParams } = new URL(req.url);
        const tabId = searchParams.get('tabId');
        const phone = searchParams.get('phone');

        if (!tabId && !phone) {
            return NextResponse.json({ message: 'TabId or Phone is required' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // SCENARIO 1: DELIVERY/TAKEAWAY (Query by Phone)
        if (phone) {
            console.log(`[API /order/active] Searching active orders for phone input: ${phone}`);

            // Normalize phone to raw 10-digit format (matches order schema: customerPhone)
            const cleanPhone = phone.replace(/\D/g, '').slice(-10); // Last 10 digits
            console.log(`[API /order/active] Normalized phone: ${cleanPhone}`);

            const ordersRef = firestore.collection('orders');
            const activeStatuses = ['pending', 'placed', 'accepted', 'preparing', 'ready', 'ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived', 'confirmed'];
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;
            const yesterday = new Date(Date.now() - ONE_DAY_MS);

            // OPTIMIZED: Single query using customerPhone field (top-level in orders)
            // Orders store phone as "9027872803" in customerPhone field
            let snapshot;
            try {
                snapshot = await ordersRef
                    .where('customerPhone', '==', cleanPhone)
                    .where('status', 'in', activeStatuses)
                    .where('createdAt', '>', yesterday)
                    .limit(20)
                    .get();

                console.log(`[API /order/active] Found ${snapshot.size} recent orders with date filter`);
            } catch (err) {
                if (err.code === 9) {
                    // Index missing - fallback without date filter
                    console.warn(`[Index Required] Missing index for customerPhone + status + createdAt query`);
                    console.warn(`[Fallback] Fetching without date filter...`);
                    snapshot = await ordersRef
                        .where('customerPhone', '==', cleanPhone)
                        .where('status', 'in', activeStatuses)
                        .limit(20)
                        .get();

                    console.log(`[API /order/active] Fallback query found ${snapshot.size} orders`);
                } else {
                    throw err;
                }
            }

            const snapshots = [snapshot];

            // Merge Results
            const mergedDocs = new Map();
            snapshots.forEach(snap => {
                snap.forEach(doc => {
                    // Filter Stale Orders (Older than 24 hours) here to keep map clean
                    const d = doc.data();
                    const createdAt = d.createdAt?.toMillis ? d.createdAt.toMillis() : 0;
                    if (createdAt > yesterday.getTime()) {
                        mergedDocs.set(doc.id, doc);
                    }
                });
            });

            if (mergedDocs.size === 0) {
                return NextResponse.json({ activeOrders: [] }, { status: 200 });
            }

            const snapshotDocs = Array.from(mergedDocs.values());

            // Better Approach: Sort the docs array first
            const sortedDocs = snapshotDocs.sort((a, b) => {
                const tA = a.data().createdAt?.toMillis() || 0;
                const tB = b.data().createdAt?.toMillis() || 0;
                return tB - tA; // Descending
            });

            const finalActiveOrders = sortedDocs.map(doc => {
                const d = doc.data();
                return {
                    orderId: doc.id,
                    status: d.status,
                    trackingToken: d.trackingToken || d.token,
                    restaurantId: d.restaurantId,
                    totalAmount: d.grandTotal || d.totalAmount,
                    items: d.items || [],
                    deliveryType: d.deliveryType // ✅ Added for filtering
                };
            });

            console.log(`[API /order/active] Found ${finalActiveOrders.length} active orders for phone ${phone}`);
            return NextResponse.json({ activeOrders: finalActiveOrders }, { status: 200 });
        }

        // SCENARIO 2: DINE-IN (Query by TabId)
        // (Existing logic follows...)

        // Fetch ALL orders for this dine-in tab using Dual-Strategy (Robust)
        // Query by ID only to avoid "Missing Index" errors with status filters
        const [snap1, snap2] = await Promise.all([
            firestore.collection('orders')
                .where('dineInTabId', '==', tabId)
                .get(),
            firestore.collection('orders')
                .where('tabId', '==', tabId)
                .get()
        ]);

        // Merge results using Map to handle duplicates
        const uniqueDocs = new Map();
        snap1.forEach(doc => uniqueDocs.set(doc.id, doc));
        snap2.forEach(doc => uniqueDocs.set(doc.id, doc));

        console.log(`[API /order/active] TabId: ${tabId}`);
        console.log(`[API /order/active] Snap1 (dineInTabId) found: ${snap1.size}`);
        console.log(`[API /order/active] Snap2 (tabId) found: ${snap2.size}`);

        let initialDocs = [];
        snap1.forEach(doc => initialDocs.push(doc));
        snap2.forEach(doc => initialDocs.push(doc));

        // --- ENHANCED AGGREGATION: Token based fallback ---
        // If orders found have a dineInToken, fetch ALL orders with that token.
        // This fixes the case where older orders might miss the tabId but share the token.
        let dineInToken = null;
        let restaurantId = null;

        if (initialDocs.length > 0) {
            const firstData = initialDocs[0].data();
            dineInToken = firstData.dineInToken;
            restaurantId = firstData.restaurantId;
        }

        if (dineInToken && restaurantId) {
            console.log(`[API /order/active] Found dineInToken: ${dineInToken}. Fetching related orders...`);
            const tokenQuery = await firestore.collection('orders')
                .where('restaurantId', '==', restaurantId)
                .where('dineInToken', '==', dineInToken)
                .get();

            console.log(`[API /order/active] Token query found: ${tokenQuery.size} docs.`);
            tokenQuery.forEach(doc => uniqueDocs.set(doc.id, doc));
        }
        // --------------------------------------------------

        snap1.forEach(doc => uniqueDocs.set(doc.id, doc));
        snap2.forEach(doc => uniqueDocs.set(doc.id, doc));

        console.log(`[API /order/active] Total unique docs after token merge: ${uniqueDocs.size}`);

        if (uniqueDocs.size === 0) {
            console.log('[API /order/active] No documents found. Returning 404.');
            return NextResponse.json({ message: 'No orders found for this tab' }, { status: 404 });
        }

        // Aggregate all items and calculate totals
        let allItems = [];
        let subtotal = 0;
        let tab_name = '';
        let customerName = '';

        // Sort by creation time to keep order consistent
        const sortedDocs = Array.from(uniqueDocs.values()).sort((a, b) => {
            return (a.data().createdAt?.toMillis() || 0) - (b.data().createdAt?.toMillis() || 0);
        });

        sortedDocs.forEach(doc => {
            const order = doc.data();
            console.log(`[API /order/active] Processing Order: ${doc.id} | Status: ${order.status} | Amount: ${order.totalAmount || 0}`);

            // Filter statuses in MEMORY (Robust)
            if (['cancelled', 'rejected', 'picked_up'].includes(order.status)) {
                console.log(`[API /order/active] Skipping order (status: ${order.status}): ${doc.id}`);
                return;
            }

            allItems = allItems.concat(order.items || []);
            // Use totalAmount if available, otherwise subtotal (legacy)
            // Ensure we don't double count if fields exist differently
            const orderTotal = order.totalAmount || order.grandTotal || order.subtotal || 0;
            subtotal += orderTotal;

            if (!tab_name) tab_name = order.tab_name || order.customerName || '';
            if (!customerName) customerName = order.customerName || '';
        });

        console.log(`[API /order/active] Final Aggregated Subtotal: ${subtotal}`);

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
            .where('status', 'in', ['pending', 'placed', 'accepted', 'preparing', 'ready', 'ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived']) // Added all active statuses
            .limit(20) // Safety Cap: Prevent fetching too many docs
            .get();

        if (activeOrderQuery.empty) {
            return NextResponse.json({ activeOrder: null }, { status: 200 });
        }

        // Sort in memory to avoid composite index requirement
        const docs = activeOrderQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        docs.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

        const orderData = docs[0];
        const orderDoc = { id: orderData.id }; // Construct pseudo-doc since we mapped it



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
