
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their business
async function verifyOwnerAndGetBusiness(req) {
    const auth = await getAuth();
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    // --- ADMIN IMPERSONATION LOGIC ---
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
        console.log(`[API Impersonation] Admin ${uid} is viewing status for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    } else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!querySnapshot.empty) {
            const docData = querySnapshot.docs[0].data();
            return {
                status: docData.approvalStatus || 'pending',
                restrictedFeatures: docData.restrictedFeatures || [],
                suspensionRemark: docData.suspensionRemark || '',
            };
        }
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
