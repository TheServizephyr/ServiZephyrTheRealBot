

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const url = new URL(req.headers.get('referer') || 'http://localhost');
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].ref;
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusiness(req);
        
        const tablesSnap = await businessRef.collection('tables').get();
        const tables = tablesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return NextResponse.json({ tables }, { status: 200 });

    } catch (error) {
        console.error("GET DINE-IN TABLES ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function POST(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusiness(req);
        const { tableId, maxCapacity } = await req.json();

        if (!tableId || !maxCapacity || maxCapacity < 1) {
            return NextResponse.json({ message: 'Table ID and a valid capacity are required.' }, { status: 400 });
        }
        
        const tableRef = businessRef.collection('tables').doc(tableId);

        await tableRef.set({
            max_capacity: Number(maxCapacity),
            current_pax: 0,
            createdAt: new Date(),
        }, { merge: true });

        return NextResponse.json({ message: 'Table saved successfully.' }, { status: 201 });

    } catch (error) {
        console.error("POST DINE-IN TABLE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
     try {
        const businessRef = await verifyOwnerAndGetBusiness(req);
        const { tableId, state } = await req.json();

        if (!tableId || !state) {
            return NextResponse.json({ message: 'Table ID and new state are required.' }, { status: 400 });
        }
        
        const validStates = ['available', 'needs_cleaning', 'occupied'];
        if (!validStates.includes(state)) {
            return NextResponse.json({ message: 'Invalid state provided.' }, { status: 400 });
        }

        const tableRef = businessRef.collection('tables').doc(tableId);

        if (state === 'available') {
            await tableRef.set({ state: 'available', lastCleaned: new Date() }, { merge: true });
        } else {
            await tableRef.set({ state: state }, { merge: true });
        }

        return NextResponse.json({ message: `Table ${tableId} status updated to ${state}.` }, { status: 200 });

    } catch (error) {
        console.error("PATCH DINE-IN TABLE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


