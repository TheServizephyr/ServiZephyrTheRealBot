
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

        // --- START FIX: Stricter Invitation Logic ---

        // 1. Find the rider in the 'users' collection by email. They MUST be a rider.
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('email', '==', lowercasedEmail).where('role', '==', 'rider').limit(1).get();

        if (userQuery.empty) {
            // Rider not found or not registered as a rider. Block the invite.
            return NextResponse.json({ message: 'No rider found with this email address. Please ask the rider to register on the Rider Portal first.' }, { status: 404 });
        }
        
        const userDoc = userQuery.docs[0];
        const riderUid = userDoc.id;

        // 2. Check if this rider is already part of the owner's team.
        const existingRiderRef = restaurantRef.collection('deliveryBoys').doc(riderUid);
        const existingRiderSnap = await existingRiderRef.get();
        if (existingRiderSnap.exists) {
            return NextResponse.json({ message: 'This rider is already part of your team.' }, { status: 409 }); // 409 Conflict
        }
        
        // 3. Check if an invite has already been sent and is pending.
        const inviteRef = firestore.collection('drivers').doc(riderUid).collection('invites').doc(restaurantId);
        const existingInviteSnap = await inviteRef.get();
        if (existingInviteSnap.exists) {
            return NextResponse.json({ message: 'An invitation has already been sent to this rider.' }, { status: 409 });
        }

        // --- END FIX ---
        
        // All checks passed, proceed with sending the invite.
        await inviteRef.set({
            restaurantId: restaurantId,
            restaurantName: restaurantData.name,
            invitedAt: FieldValue.serverTimestamp(),
            status: 'pending',
        });

        return NextResponse.json({ message: `Invitation sent successfully to ${riderEmail}!` }, { status: 200 });

    } catch (error) {
        console.error("POST RIDER INVITE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
