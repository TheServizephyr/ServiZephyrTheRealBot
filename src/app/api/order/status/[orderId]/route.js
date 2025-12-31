

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(request, { params }) {
    console.log("[API][Order Status] GET request received.");
    try {
        const { orderId } = params;
        const firestore = await getFirestore();

        if (!orderId) {
            console.log("[API][Order Status] Error: Order ID is missing from params.");
            return NextResponse.json({ message: 'Order ID is missing.' }, { status: 400 });
        }

        console.log(`[API][Order Status] Fetching order document: ${orderId}`);

        let orderSnap;
        let orderRef;

        // If orderId is a Tab ID (starts with 'tab_'), find the most recent order for this tab
        if (orderId.startsWith('tab_')) {
            console.log(`[API][Order Status] ID is a Tab ID. Querying for latest order in tab: ${orderId}`);
            const tabOrdersQuery = await firestore.collection('orders')
                .where('dineInTabId', '==', orderId)
                .get();

            if (tabOrdersQuery.empty) {
                console.log(`[API][Order Status] Error: No orders found for tab ${orderId}.`);
                return NextResponse.json({ message: 'No orders found for this tab.' }, { status: 404 });
            }

            // Sort in memory to avoid composite index requirement
            const sortedDocs = tabOrdersQuery.docs.sort((a, b) => {
                const dateA = a.data().createdAt?.toMillis() || 0;
                const dateB = b.data().createdAt?.toMillis() || 0;
                return dateB - dateA; // Descending
            });

            orderSnap = sortedDocs[0];
            orderRef = orderSnap.ref;
            console.log(`[API][Order Status] Found latest order for tab: ${orderSnap.id}`);
        } else {
            // Normal Order ID lookup
            orderRef = firestore.collection('orders').doc(orderId);
            orderSnap = await orderRef.get();

            if (!orderSnap.exists) {
                console.log(`[API][Order Status] Error: Order document ${orderId} not found.`);
                return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
            }
        }

        const orderData = orderSnap.data();
        let deliveryBoyData = null;
        console.log(`[API][Order Status] Order data found. Status: ${orderData.status}, Delivery Boy ID: ${orderData.deliveryBoyId}`);

        if (orderData.deliveryBoyId) {
            console.log(`[API][Order Status] Fetching delivery boy: ${orderData.deliveryBoyId} from drivers collection.`);

            const driverDocRef = firestore.collection('drivers').doc(orderData.deliveryBoyId);
            const driverDoc = await driverDocRef.get();

            if (driverDoc.exists) {
                deliveryBoyData = { id: driverDoc.id, ...driverDoc.data() };
                console.log("[API][Order Status] Delivery boy found in 'drivers' collection.");
            } else {
                console.warn(`[API][Order Status] Delivery boy with ID ${orderData.deliveryBoyId} not found in the main 'drivers' collection.`);
            }
        }

        const businessType = orderData.businessType || 'restaurant';
        const collectionName = businessType === 'street-vendor' ? 'street_vendors' : (businessType === 'shop' ? 'shops' : 'restaurants');
        const businessDoc = await firestore.collection(collectionName).doc(orderData.restaurantId).get();

        if (!businessDoc || !businessDoc.exists) {
            console.log(`[API][Order Status] Error: Business ${orderData.restaurantId} not found in collection ${collectionName}.`);
            return NextResponse.json({ message: 'Business associated with order not found.' }, { status: 404 });
        }
        const businessData = businessDoc.data();
        console.log("[API][Order Status] Business found.");

        const restaurantLocationForMap = (businessData.address && typeof businessData.address.latitude === 'number' && typeof businessData.address.longitude === 'number')
            ? { lat: businessData.address.latitude, lng: businessData.address.longitude }
            : null;

        // For dine-in orders with dineInTabId, aggregate ALL orders in the same tab
        let aggregatedItems = orderData.items || [];
        let aggregatedSubtotal = orderData.subtotal || 0;
        let aggregatedCgst = orderData.cgst || 0;
        let aggregatedSgst = orderData.sgst || 0;
        let aggregatedTotal = orderData.totalAmount || 0;

        if (orderData.deliveryType === 'dine-in' && orderData.dineInTabId) {
            console.log(`[API][Order Status] Dine-in order detected. Aggregating all orders for tabId: ${orderData.dineInTabId}`);
            try {
                // Robust aggregation: Query by Table ID and filter, to handle legacy tabId/dineInTabId mismatch
                const currentTabId = orderData.dineInTabId || orderData.tabId;

                if (currentTabId) {
                    const tableOrdersSnapshot = await firestore
                        .collection('orders')
                        .where('restaurantId', '==', orderData.restaurantId)
                        .where('tableId', '==', orderData.tableId) // Broader query
                        .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'rejected', 'cancelled'])
                        .get();

                    if (!tableOrdersSnapshot.empty) {
                        aggregatedItems = [];
                        aggregatedSubtotal = 0;
                        aggregatedCgst = 0;
                        aggregatedSgst = 0;
                        aggregatedTotal = 0;
                        const batchesList = [];

                        tableOrdersSnapshot.forEach(doc => {
                            const tabOrder = doc.data();
                            // Robust ID check
                            const orderTabId = tabOrder.dineInTabId || tabOrder.tabId;

                            if (orderTabId === currentTabId) {
                                // Add to batches list
                                batchesList.push({
                                    id: doc.id,
                                    ...tabOrder
                                });

                                // Aggregate totals (excluding cancelled/rejected)
                                if (!['rejected', 'cancelled'].includes(tabOrder.status)) {
                                    if (tabOrder.items) {
                                        aggregatedItems = aggregatedItems.concat(tabOrder.items);
                                    }
                                    aggregatedSubtotal += tabOrder.subtotal || 0;
                                    aggregatedCgst += tabOrder.cgst || 0;
                                    aggregatedSgst += tabOrder.sgst || 0;
                                    aggregatedTotal += tabOrder.totalAmount || 0;
                                }
                            }
                        });

                        // Sort batches: Newest First? Or Oldest First? 
                        // Let's do Oldest First (Order 1, Order 2...)
                        batchesList.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

                        // Assign to a variable to use in response
                        orderData.batches = batchesList;

                        console.log(`[API][Order Status] Aggregated ${tabOrdersSnapshot.size} orders.`);
                    }
                } catch (err) {
                    console.error("[API][Order Status] Error aggregating tab orders:", err);
                }
            }

        const responsePayload = {
                order: {
                    id: orderSnap.id,
                    status: orderData.status,
                    customerLocation: orderData.customerLocation,
                    restaurantLocation: restaurantLocationForMap,
                    customerName: orderData.customerName,
                    customerAddress: orderData.customerAddress,
                    customerPhone: orderData.customerPhone,
                    items: aggregatedItems, // Aggregated items (Active)
                    batches: orderData.batches || [], // NEW FIELD
                    subtotal: aggregatedSubtotal, // Aggregated subtotal
                    cgst: aggregatedCgst, // Aggregated cgst
                    sgst: aggregatedSgst, // Aggregated sgst
                    totalAmount: aggregatedTotal, // Aggregated total
                    paymentDetails: orderData.paymentDetails,
                    deliveryType: orderData.deliveryType,
                    dineInToken: orderData.dineInToken,
                    tableId: orderData.tableId,
                    dineInTabId: orderData.dineInTabId,

                    trackingToken: orderData.trackingToken || null, // Make sure to send the token
                },
                restaurant: {
                    id: businessDoc.id,
                    name: businessData.name,
                    address: businessData.address
                },
                deliveryBoy: deliveryBoyData ? {
                    id: deliveryBoyData.id,
                    name: deliveryBoyData.name,
                    photoUrl: deliveryBoyData.profilePictureUrl,
                    rating: deliveryBoyData.avgRating || 4.5,
                    phone: deliveryBoyData.phone,
                    location: deliveryBoyData.currentLocation
                } : null
            };

            console.log("[API][Order Status] Successfully built response payload. Tracking token included:", !!responsePayload.order.trackingToken);
            return NextResponse.json(responsePayload, { status: 200 });

        } catch (error) {
            console.error("[API][Order Status] CRITICAL ERROR:", error);
            return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
        }
    }
