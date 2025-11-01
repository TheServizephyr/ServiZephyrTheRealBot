
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper
    
    // --- ADMIN IMPERSONATION & PERMISSION LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, collectionName: 'restaurants', isAdmin: userRole === 'admin' };
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, collectionName: 'shops', isAdmin: userRole === 'admin' };
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const boysRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys');
        const ordersRef = firestore.collection('orders').where('restaurantId', '==', businessId);

        const [boysSnap, readyOrdersSnap] = await Promise.all([
            boysRef.get(),
            ordersRef.where('status', '==', 'preparing').get()
        ]);
        
        let boys = boysSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const readyOrders = readyOrdersSnap.docs.map(doc => ({
            id: doc.id,
            customer: doc.data().customerName,
            items: (doc.data().items || []).length
        }));
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const deliveredOrdersSnap = await ordersRef
            .where('status', '==', 'delivered')
            .where('orderDate', '>=', today)
            .get();

        const deliveriesByBoy = {};
        deliveredOrdersSnap.docs.forEach(doc => {
            const orderData = doc.data();
            if (orderData.deliveryBoyId) {
                deliveriesByBoy[orderData.deliveryBoyId] = (deliveriesByBoy[orderData.deliveryBoyId] || 0) + 1;
            }
        });

        boys = boys.map(boy => ({
            ...boy,
            deliveriesToday: deliveriesByBoy[boy.id] || 0
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
                deliveries: 0 
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
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { boy } = await req.json();

        if (!boy || !boy.name || !boy.phone) {
            return NextResponse.json({ message: 'Missing required delivery boy data.' }, { status: 400 });
        }

        const newBoyRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys').doc();
        
        const newBoyData = {
            ...boy,
            id: newBoyRef.id,
            status: 'Inactive',
            location: null,
            deliveriesToday: 0,
            totalDeliveries: 0,
            avgDeliveryTime: 0,
            avgRating: 0,
            createdAt: firestore.FieldValue.serverTimestamp(),
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
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { boy } = await req.json();

        if (!boy || !boy.id) {
            return NextResponse.json({ message: 'Boy ID is required for updating.' }, { status: 400 });
        }

        const boyRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys').doc(boy.id);
        
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
