
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';

// Helper to verify owner and get their business
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req);
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
        targetOwnerId = impersonatedOwnerId;
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        return { id: doc.id, data: doc.data(), ref: doc.ref };
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        return { id: doc.id, data: doc.data(), ref: doc.ref };
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


// POST an invitation to a rider
export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { id: restaurantId, data: restaurantData, ref: restaurantRef } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const { riderEmail } = await req.json();

        if (!riderEmail) {
            return NextResponse.json({ message: 'Rider email is required.' }, { status: 400 });
        }

        // Find the rider in the 'users' collection by email
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('email', '==', riderEmail).where('role', '==', 'rider').limit(1).get();

        if (userQuery.empty) {
             return NextResponse.json({ message: `No rider found with the email "${riderEmail}". Please ensure they have registered on the rider portal.` }, { status: 404 });
        }
        
        // If found in 'users' collection (which is the primary place for rider role)
        const userDoc = userQuery.docs[0];
        const riderUid = userDoc.id;

        // Check if rider is already employed by this restaurant
        const existingRiderRef = restaurantRef.collection('deliveryBoys').doc(riderUid);
        const existingRiderSnap = await existingRiderRef.get();
        if (existingRiderSnap.exists) {
            return NextResponse.json({ message: 'This rider is already part of your team.' }, { status: 409 });
        }
        
        // Send invite by creating a document in the rider's sub-collection
        const inviteRef = firestore.collection('drivers').doc(riderUid).collection('invites').doc(restaurantId);
        
        await inviteRef.set({
            restaurantId: restaurantId,
            restaurantName: restaurantData.name,
            invitedAt: FieldValue.serverTimestamp(),
            status: 'pending',
        });

        return NextResponse.json({ message: `Invitation sent successfully to ${userDoc.data().name}!` }, { status: 200 });

    } catch (error) {
        console.error("POST RIDER INVITE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
