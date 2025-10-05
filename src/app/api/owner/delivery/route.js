
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


async function seedInitialDeliveryBoys(firestore, restaurantId) {
    const batch = firestore.batch();
    const boysRef = firestore.collection('restaurants').doc(restaurantId).collection('deliveryBoys');
    
    const initialBoys = [
        { name: 'Arjun Kumar', phone: '9876543210', status: 'Available', deliveriesToday: 5, totalDeliveries: 150, avgDeliveryTime: 28, avgRating: 4.8 },
        { name: 'Vijay Singh', phone: '9876543211', status: 'On Delivery', deliveriesToday: 7, totalDeliveries: 210, avgDeliveryTime: 25, avgRating: 4.9 },
    ];
    
    const finalBoys = [];

    initialBoys.forEach(boyData => {
        const docRef = boysRef.doc();
        const newBoy = {
            id: docRef.id,
            location: null,
            createdAt: adminFirestore.FieldValue.serverTimestamp(),
            ...boyData
        };
        batch.set(docRef, newBoy);
        finalBoys.push(newBoy);
    });

    await batch.commit();
    return finalBoys;
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

        const boysRef = firestore.collection('restaurants').doc(restaurantId).collection('deliveryBoys');
        const boysSnap = await boysRef.get();
        let boys = [];

        if (boysSnap.empty) {
            boys = await seedInitialDeliveryBoys(firestore, restaurantId);
        } else {
            boys = boysSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        const ordersRef = firestore.collection('orders').where('restaurantId', '==', restaurantId);
        const readyOrdersSnap = await ordersRef.where('status', '==', 'Ready for Dispatch').get();
        const readyOrders = readyOrdersSnap.docs.map(doc => ({
            id: doc.id,
            customer: doc.data().customerName,
            items: (doc.data().items || []).length
        }));
        
        const performance = {
            totalDeliveries: boys.reduce((sum, boy) => sum + (boy.deliveriesToday || 0), 0),
            avgDeliveryTime: boys.length > 0 ? Math.round(boys.reduce((sum, boy) => sum + (boy.avgDeliveryTime || 30), 0) / boys.length) : 0,
            topPerformer: boys.reduce((top, boy) => ((boy.totalDeliveries || 0) > (top.totalDeliveries || 0)) ? boy : top, {}),
        };

        const weeklyPerformance = Array.from({length: 7}, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (6-i));
            return {
                day: date.toLocaleDateString('en-IN', { weekday: 'short'}),
                deliveries: Math.floor(Math.random() * (performance.totalDeliveries || 50)) + 10
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
