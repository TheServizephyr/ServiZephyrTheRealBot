

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(request, { params }) {
    console.log("[API][Order Status] Request received.");
    try {
        const { orderId } = params;
        const firestore = getFirestore();

        if (!orderId) {
            console.log("[API][Order Status] Error: Order ID is missing.");
            return NextResponse.json({ message: 'Order ID is missing.' }, { status: 400 });
        }

        console.log(`[API][Order Status] Fetching order: ${orderId}`);
        const orderRef = firestore.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            console.log(`[API][Order Status] Error: Order ${orderId} not found.`);
            return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
        }
        
        const orderData = orderSnap.data();
        let deliveryBoyData = null;
        console.log(`[API][Order Status] Order data found. Status: ${orderData.status}, Delivery Boy ID: ${orderData.deliveryBoyId}`);

        // --- START FIX: Correctly fetch delivery boy from business subcollection ---
        if (orderData.deliveryBoyId && orderData.restaurantId) {
            const businessType = orderData.businessType || 'restaurant';
            const collectionName = businessType === 'shop' ? 'shops' : 'restaurants';
            
            console.log(`[API][Order Status] Fetching delivery boy: ${orderData.deliveryBoyId} from ${collectionName}/${orderData.restaurantId}/deliveryBoys`);

            const deliveryBoyRef = firestore.collection(collectionName).doc(orderData.restaurantId).collection('deliveryBoys').doc(orderData.deliveryBoyId);
            const deliveryBoySnap = await deliveryBoyRef.get();

            if (deliveryBoySnap.exists) {
                deliveryBoyData = { id: deliveryBoySnap.id, ...deliveryBoySnap.data() };
                console.log("[API][Order Status] Delivery boy found in subcollection.");
            } else {
                 console.warn(`[API][Order Status] Delivery boy with ID ${orderData.deliveryBoyId} not found in subcollection.`);
            }
        }
        // --- END FIX ---
        
        const businessType = orderData.businessType || 'restaurant';
        const collectionName = businessType === 'shop' ? 'shops' : 'restaurants';

        console.log(`[API][Order Status] Fetching business: ${orderData.restaurantId} from collection: ${collectionName}`);
        const businessDoc = await firestore.collection(collectionName).doc(orderData.restaurantId).get();
        
        if(!businessDoc.exists){
             console.log(`[API][Order Status] Error: Business ${orderData.restaurantId} not found.`);
             return NextResponse.json({ message: 'Business associated with order not found.' }, { status: 404 });
        }
        const businessData = businessDoc.data();
        console.log("[API][Order Status] Business found.");

        const responsePayload = {
            order: {
                id: orderSnap.id,
                status: orderData.status,
                customerLocation: orderData.customerLocation // Pass the GeoPoint directly
            },
            restaurant: {
                name: businessData.name,
                location: businessData.address // Pass the whole address object which contains the location
            },
            deliveryBoy: deliveryBoyData ? {
                id: deliveryBoyData.id,
                name: deliveryBoyData.name,
                photoUrl: deliveryBoyData.photoUrl,
                rating: deliveryBoyData.rating,
                phone: deliveryBoyData.phone,
                location: deliveryBoyData.location // Pass the GeoPoint directly
            } : null
        };
        
        console.log("[API][Order Status] Successfully built response payload:", JSON.stringify(responsePayload));
        return NextResponse.json(responsePayload, { status: 200 });

    } catch (error) {
        console.error("[API][Order Status] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
