
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify owner and get their business
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
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    // **THE FIX: Check both collections**
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (!restaurantsQuery.empty) {
        const restaurantDoc = restaurantsQuery.docs[0];
        const restaurantData = restaurantDoc.data();
        return { 
            status: restaurantData.approvalStatus || 'pending', 
            restrictedFeatures: restaurantData.restrictedFeatures || [],
            suspensionRemark: restaurantData.suspensionRemark || '',
        };
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', uid).limit(1).get();
    if (!shopsQuery.empty) {
        const shopDoc = shopsQuery.docs[0];
        const shopData = shopDoc.data();
        return { 
            status: shopData.approvalStatus || 'pending', 
            restrictedFeatures: shopData.restrictedFeatures || [],
            suspensionRemark: shopData.suspensionRemark || '',
        };
    }

    // If neither is found, it's a new user who just completed profile but doc hasn't been created
    // Or it could be an error. Let the client decide based on 404.
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const { status, restrictedFeatures, suspensionRemark } = await verifyOwnerAndGetBusiness(req);
        return NextResponse.json({ status, restrictedFeatures, suspensionRemark }, { status: 200 });
    } catch (error) {
        console.error("GET /api/owner/status ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
