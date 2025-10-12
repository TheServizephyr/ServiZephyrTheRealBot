
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
        const restaurantId = restaurantsQuery.docs[0].id;
        return { uid: impersonatedOwnerId, restaurantId, isAdmin: true };
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
    const restaurantId = restaurantsQuery.docs[0].id;
    
    return { uid, restaurantId };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

        const boysRef = firestore.collection('restaurants').doc(restaurantId).collection('deliveryBoys');
        const boysSnap = await boysRef.get();
        const boys = boysSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const ordersRef = firestore.collection('orders').where('restaurantId', '==', restaurantId);
        const readyOrdersSnap = await ordersRef.where('status', '==', 'Ready for Dispatch').get();
        const readyOrders = readyOrdersSnap.docs.map(doc => ({
            id: doc.id,
            customer: doc.data().customerName,
            items: (doc.data().items || []).length
        }));
        
        const performance = {
            totalDeliveries: boys.reduce((sum, boy) => sum + (boy.deliveriesToday || 0), 0),
            avgDeliveryTime: boys.length > 0 ? Math.round(boys.reduce((sum, boy) => sum + (boy.avgDeliveryTime || 0), 0) / boys.length) : 0,
            topPerformer: boys.length > 0 ? boys.reduce((top, boy) => ((boy.totalDeliveries || 0) > (top.totalDeliveries || 0)) ? boy : top, boys[0]) : {},
        };

        const weeklyPerformance = Array.from({length: 7}, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (6-i));
            return {
                day: date.toLocaleDateString('en-IN', { weekday: 'short'}),
                deliveries: 0 // This would need to be calculated from historical order data in a real app
            };
        });

        return NextResponse.json({ boys, performance, readyOrders, weeklyPerformance }, { status: 200 });

    } catch (error) {
        console.error("GET DELIVERY DATA ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { boy } = await req.json();

        if (!boy || !boy.name || !boy.phone) {
            return NextResponse.json({ message: 'Missing required delivery boy data.' }, { status: 400 });
        }

        const newBoyRef = firestore.collection('restaurants').doc(restaurantId).collection('deliveryBoys').doc();
        
        const newBoyData = {
            ...boy,
            id: newBoyRef.id,
            status: 'Inactive',
            location: null,
            deliveriesToday: 0,
            totalDeliveries: 0,
            avgDeliveryTime: 0,
            avgRating: 0,
            createdAt: adminFirestore.FieldValue.serverTimestamp(),
        };

        await newBoyRef.set(newBoyData);

        return NextResponse.json({ message: 'Delivery Boy added successfully!', id: newBoyRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST DELIVERY BOY ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { boy } = await req.json();

        if (!boy || !boy.id) {
            return NextResponse.json({ message: 'Boy ID is required for updating.' }, { status: 400 });
        }

        const boyRef = firestore.collection('restaurants').doc(restaurantId).collection('deliveryBoys').doc(boy.id);
        
        const { id, ...updateData } = boy;

        if (updateData.status === 'Inactive') {
            updateData.location = null;
        }

        await boyRef.update(updateData);

        return NextResponse.json({ message: 'Delivery Boy updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH DELIVERY BOY ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
