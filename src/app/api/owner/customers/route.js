
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper
    
    // Admin impersonation logic
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

        const customersRef = firestore.collection(collectionName).doc(businessId).collection('customers');
        const customersSnap = await customersRef.orderBy('totalSpend', 'desc').get();

        const customers = customersSnap.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                ...data,
                lastOrderDate: data.lastOrderDate?.toDate().toISOString()
            };
        });
        
        const totalCustomers = customers.length;
        const topSpender = customers.length > 0 ? customers.reduce((prev, current) => ((prev.totalSpend || 0) > (current.totalSpend || 0)) ? prev : current, {}) : {};
        
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
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        
        const { customerId, notes } = await req.json();

        if (!customerId || notes === undefined) {
            return NextResponse.json({ message: 'Customer ID and notes are required.' }, { status: 400 });
        }

        const customerRef = firestore.collection(collectionName).doc(businessId).collection('customers').doc(customerId);
        
        const customerSnap = await customerRef.get();
        if (!customerSnap.exists) {
            return NextResponse.json({ message: 'Customer not found in this business.' }, { status: 404 });
        }

        await customerRef.update({ notes: notes });

        return NextResponse.json({ message: 'Customer notes updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH CUSTOMER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
