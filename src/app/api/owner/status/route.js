
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their business
async function verifyOwnerAndGetBusiness(req) {
    const auth = await getAuth();
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
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
