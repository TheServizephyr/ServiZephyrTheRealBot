

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { getAuth } from 'firebase/auth';

// This API is intended for the customer-facing tracking page.
// It uses client-side auth, but we can add a server-side check if needed.
// For now, we'll assume Firestore rules secure the data.

export async function GET(request, { params }) {
    try {
        const { orderId } = params;
        const firestore = getFirestore();

        if (!orderId) {
            return NextResponse.json({ message: 'Order ID is missing.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
        }
        
        const orderData = orderSnap.data();
        let deliveryBoyData = null;

        if (orderData.deliveryBoyId) {
            const deliveryBoyRef = firestore.collection('deliveryBoys').doc(orderData.deliveryBoyId);
            const deliveryBoySnap = await deliveryBoyRef.get();
            if (deliveryBoySnap.exists()) {
                deliveryBoyData = deliveryBoySnap.data();
            }
        }
        
        let restaurantDoc;
        let businessType = orderData.businessType || 'restaurant'; // Default to restaurant
        const collectionName = businessType === 'shop' ? 'shops' : 'restaurants';

        restaurantDoc = await firestore.collection(collectionName).doc(orderData.restaurantId).get();
        
        if(!restaurantDoc.exists){
             return NextResponse.json({ message: 'Restaurant associated with order not found.' }, { status: 404 });
        }
        const restaurantData = restaurantDoc.data();

        // Combine all data into one response
        const responsePayload = {
            order: {
                id: orderSnap.id,
                status: orderData.status,
                customerLocation: orderData.customerLocation // **THE FIX**: Get location from order doc
            },
            restaurant: {
                name: restaurantData.name,
                location: restaurantData.address?.location // Corrected path to location
            },
            deliveryBoy: deliveryBoyData ? {
                id: deliveryBoyData.id,
                name: deliveryBoyData.name,
                photoUrl: deliveryBoyData.photoUrl,
                rating: deliveryBoyData.rating,
                phone: deliveryBoyData.phone,
                location: deliveryBoyData.location // Assuming GeoPoint
            } : null
        };
        
        return NextResponse.json(responsePayload, { status: 200 });

    } catch (error) {
        console.error("GET /api/order/status/[orderId] ERROR:", error);
        console.log("Error details for status API:", error.message);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
