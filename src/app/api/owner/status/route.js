
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify owner and get their first restaurant
async function verifyOwnerAndGetRestaurant(req) {
    const auth = getAuth();
    const firestore = getFirestore();
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
        // This can happen during profile completion, so we default to 'pending'
        return { status: 'pending', restrictedFeatures: [] };
    }
    
    const restaurantDoc = restaurantsQuery.docs[0];
    const restaurantData = restaurantDoc.data();
    
    return { 
        status: restaurantData.approvalStatus || 'pending', 
        restrictedFeatures: restaurantData.restrictedFeatures || [] 
    };
}


export async function GET(req) {
    try {
        const { status, restrictedFeatures } = await verifyOwnerAndGetRestaurant(req);
        return NextResponse.json({ status, restrictedFeatures }, { status: 200 });
    } catch (error) {
        console.error("GET /api/owner/status ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
