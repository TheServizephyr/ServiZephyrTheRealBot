

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(request, { params }) {
    console.log("[API][Order Status] Request received.");
    try {
        const { orderId } = params;
        const firestore = await getFirestore();

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
                address: businessData.address
            },
            deliveryBoy: deliveryBoyData ? {
                id: deliveryBoyData.id,
                name: deliveryBoyData.name,
                photoUrl: deliveryBoyData.profilePictureUrl, // Corrected field name
                rating: deliveryBoyData.avgRating || 4.5, // Use avgRating from driver doc
                phone: deliveryBoyData.phone,
                location: deliveryBoyData.currentLocation // Use currentLocation from driver doc
            } : null
        };
        
        console.log("[API][Order Status] Successfully built response payload:", JSON.stringify(responsePayload));
        return NextResponse.json(responsePayload, { status: 200 });

    } catch (error) {
        console.error("[API][Order Status] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}


