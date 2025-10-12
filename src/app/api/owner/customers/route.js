
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

        const customersRef = firestore.collection('restaurants').doc(restaurantId).collection('customers');
        const customersSnap = await customersRef.orderBy('totalSpend', 'desc').get();

        const customers = customersSnap.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                ...data,
                // Ensure date is ISO string for client
                lastOrderDate: data.lastOrderDate?.toDate().toISOString()
            };
        });
        
        const totalCustomers = customers.length;
        const topSpender = customers.length > 0 ? customers.reduce((prev, current) => ((prev.totalSpend || 0) > (current.totalSpend || 0)) ? prev : current, {}) : {};
        
        // This calculation would be more complex in a real app, here simplified
        const newThisMonth = customers.filter(c => {
            if (!c.lastOrderDate) return false;
            const lastOrder = new Date(c.lastOrderDate);
            const now = new Date();
            return lastOrder.getMonth() === now.getMonth() && lastOrder.getFullYear() === now.getFullYear();
        }).length;

        const repeatCustomers = customers.filter(c => (c.totalOrders || 0) > 1).length;
        
        const stats = {
            totalCustomers,
            newThisMonth: newThisMonth, 
            repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) : 0,
            topSpender,
        };

        return NextResponse.json({ customers, stats }, { status: 200 });

    } catch (error) {
        console.error("GET CUSTOMERS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        
        const { customerId, notes } = await req.json();

        if (!customerId || notes === undefined) {
            return NextResponse.json({ message: 'Customer ID and notes are required.' }, { status: 400 });
        }

        // The customerId is the UID of the user. We are updating the record in the restaurant's sub-collection.
        const customerRef = firestore.collection('restaurants').doc(restaurantId).collection('customers').doc(customerId);
        
        const customerSnap = await customerRef.get();
        if (!customerSnap.exists) {
            return NextResponse.json({ message: 'Customer not found in this restaurant.' }, { status: 404 });
        }

        // Only update the notes field in the restaurant's sub-collection.
        await customerRef.update({ notes: notes });

        return NextResponse.json({ message: 'Customer notes updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH CUSTOMER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
