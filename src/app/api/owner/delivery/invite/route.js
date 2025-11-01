
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
        
        const lowercasedEmail = riderEmail.toLowerCase();

        // Find the rider in the 'users' collection by email
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('email', '==', lowercasedEmail).where('role', '==', 'rider').limit(1).get();

        let riderUid;
        let riderName;

        if (!userQuery.empty) {
             const userDoc = userQuery.docs[0];
             riderUid = userDoc.id;
             riderName = userDoc.data().name || 'New Rider';

             // Check if rider is already employed by this restaurant
            const existingRiderRef = restaurantRef.collection('deliveryBoys').doc(riderUid);
            const existingRiderSnap = await existingRiderRef.get();
            if (existingRiderSnap.exists) {
                return NextResponse.json({ message: 'This rider is already part of your team.' }, { status: 409 });
            }
        }
       
        // Send invite by creating a document in the rider's sub-collection (if registered)
        // or a general invites collection (if not registered yet).
        if(riderUid) {
             const inviteRef = firestore.collection('drivers').doc(riderUid).collection('invites').doc(restaurantId);
             await inviteRef.set({
                restaurantId: restaurantId,
                restaurantName: restaurantData.name,
                invitedAt: FieldValue.serverTimestamp(),
                status: 'pending',
            });
        } else {
            // Rider not registered yet, create a pending invite
            const pendingInvitesRef = firestore.collection('pending_invites').doc(lowercasedEmail);
            await pendingInvitesRef.set({
                invites: FieldValue.arrayUnion({
                    restaurantId: restaurantId,
                    restaurantName: restaurantData.name,
                    invitedAt: FieldValue.serverTimestamp(),
                    status: 'pending'
                })
            }, { merge: true });
        }


        return NextResponse.json({ message: `Invitation sent successfully to ${riderEmail}!` }, { status: 200 });

    } catch (error) {
        console.error("POST RIDER INVITE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
