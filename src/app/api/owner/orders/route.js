
import { NextResponse } from 'next/server';
import { firestore as adminFirestore } from 'firebase-admin';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetRestaurant(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // --- ADMIN IMPERSONATION LOGIC ---
    const url = new URL(req.url);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', impersonatedOwnerId).limit(1).get();
        if (restaurantsQuery.empty) {
            throw { message: 'Impersonated owner does not have an associated restaurant.', status: 404 };
        }
        const restaurantSnap = restaurantsQuery.docs[0];
        return { uid: impersonatedOwnerId, restaurantId: restaurantSnap.id, restaurantSnap, isAdmin: true };
    }
    // --- END ADMIN IMPERSONATION LOGIC ---

    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    
    const restaurantDoc = restaurantsQuery.docs[0];
    return { uid, restaurantId: restaurantDoc.id, restaurantSnap: restaurantDoc };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        
        // --- Verify Owner ---
        const { uid, restaurantId, restaurantSnap } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        
        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('id');
        
        // --- Logic to fetch a SINGLE order for the bill page ---
        if (orderId) {
            const orderRef = firestore.collection('orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) {
                return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
            }
            
            let orderData = orderDoc.data();
            // Security check: ensure the fetched order belongs to the owner's restaurant
            if (orderData.restaurantId !== restaurantId) {
                return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
            }
            
            // CONVERT TIMESTAMP TO ISO STRING FOR CLIENT
            if (orderData.orderDate && orderData.orderDate.toDate) {
                orderData = { ...orderData, orderDate: orderData.orderDate.toDate().toISOString() };
            }


            const restaurantData = restaurantSnap.data();

            return NextResponse.json({ order: orderData, restaurant: restaurantData }, { status: 200 });
        }


        // --- Original logic to fetch ALL orders for the live orders page ---
        const ordersRef = firestore.collection('orders');
        const ordersSnap = await ordersRef.where('restaurantId', '==', restaurantId).orderBy('orderDate', 'desc').get();

        const orders = ordersSnap.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                ...data,
                // Ensure date is ISO string for client-side processing
                orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                customer: data.customerName,
                amount: data.totalAmount,
            };
        });

        return NextResponse.json({ orders }, { status: 200 });

    } catch (error) {
        console.error("GET ORDERS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        // We still verify the owner to ensure they have rights, even though orderId is unique
        await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { orderId, newStatus } = await req.json();

        if (!orderId || !newStatus) {
            return NextResponse.json({ message: 'Order ID and new status are required.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        await orderRef.update({ status: newStatus });

        return NextResponse.json({ message: 'Order status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH ORDER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function DELETE(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { orderId } = await req.json();

        if (!orderId) {
            return NextResponse.json({ message: 'Order ID is required.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        await orderRef.delete();

        return NextResponse.json({ message: 'Order rejected and removed.' }, { status: 200 });
    } catch (error) {
        console.error("DELETE ORDER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
