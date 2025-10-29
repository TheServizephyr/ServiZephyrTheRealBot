

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business Ref
async function verifyOwnerAndGetBusinessRef(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    let finalUserId = uid;
    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', finalUserId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].ref;
    }
    
    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', finalUserId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


// GET the saved operational location
export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        
        // ** THE FIX: Get from the main document's 'address' field **
        const businessSnap = await businessRef.get();

        if (!businessSnap.exists) {
             return NextResponse.json({ location: null, message: 'Business document not found.' }, { status: 404 });
        }
        
        const businessData = businessSnap.data();
        const address = businessData.address;

        if (!address || typeof address.latitude !== 'number' || typeof address.longitude !== 'number') {
            return NextResponse.json({ location: null, message: 'No operational location set.' }, { status: 200 });
        }

        return NextResponse.json({ location: address }, { status: 200 });

    } catch (error) {
        console.error("GET /api/owner/locations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// POST/PATCH to save or update the operational location
export async function POST(req) {
     try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const { location } = await req.json();

        if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
            return NextResponse.json({ message: 'Valid location object with latitude and longitude is required.' }, { status: 400 });
        }
        
        // ** THE FIX: Save to the main 'address' field, not a subcollection **
        const locationData = {
            address: {
                ...location, // This includes all fields from the client
                updatedAt: FieldValue.serverTimestamp(),
            }
        };

        await businessRef.set(locationData, { merge: true });

        return NextResponse.json({ message: 'Operational location saved successfully!', location: locationData.address }, { status: 200 });

    } catch (error) {
        console.error("POST /api/owner/locations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
