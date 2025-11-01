
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API accept-invite] Request received.");
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req); // Authenticates the rider making the request

        const { restaurantId, restaurantName, inviteId } = await req.json();
        
        if (!restaurantId || !restaurantName || !inviteId) {
            console.error("[API accept-invite] Validation failed: Missing required fields.");
            return NextResponse.json({ message: 'Missing invitation details.' }, { status: 400 });
        }

        console.log(`[API accept-invite] Rider ${uid} is accepting invite from restaurant ${restaurantId}`);

        const batch = firestore.batch();

        // 1. Update the rider's main document in 'drivers' collection
        const driverDocRef = firestore.collection('drivers').doc(uid);
        batch.update(driverDocRef, {
            currentRestaurantId: restaurantId,
            currentRestaurantName: restaurantName,
        });
        console.log(`[API accept-invite] Batch: Marked driver ${uid} to be updated.`);

        // 2. Get the rider's full profile to add to the restaurant's subcollection
        const userDocRef = firestore.collection('users').doc(uid);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            throw new Error("Rider's main user profile does not exist.");
        }
        const userData = userDoc.data();
        
        // 3. Create a new document for the rider in the restaurant's 'deliveryBoys' subcollection
        // THE FIX: Check business type to determine collection
        let restaurantDoc = await firestore.collection('restaurants').doc(restaurantId).get();
        let businessCollection = 'restaurants';
        if (!restaurantDoc.exists) {
            const shopDoc = await firestore.collection('shops').doc(restaurantId).get();
            if (shopDoc.exists) {
                businessCollection = 'shops';
                restaurantDoc = shopDoc;
            } else {
                 throw new Error("The specified business does not exist.");
            }
        }
        
        const restaurantRiderRef = firestore.collection(businessCollection).doc(restaurantId).collection('deliveryBoys').doc(uid);
        
        batch.set(restaurantRiderRef, {
            id: uid,
            name: userData.name || 'Unnamed Rider',
            phone: userData.phone || 'No Phone',
            email: userData.email,
            status: 'offline', // Start as offline
            createdAt: FieldValue.serverTimestamp(),
            profilePictureUrl: userData.profilePictureUrl || null,
        }, { merge: true });
        console.log(`[API accept-invite] Batch: Marked rider to be added to ${businessCollection}/${restaurantId}/deliveryBoys.`);


        // 4. Delete the invitation from the rider's subcollection
        const inviteRef = firestore.collection('drivers').doc(uid).collection('invites').doc(inviteId);
        batch.delete(inviteRef);
        console.log(`[API accept-invite] Batch: Marked invite ${inviteId} for deletion.`);

        // Commit all batched writes at once
        await batch.commit();
        console.log(`[API accept-invite] Batch committed successfully. Rider ${uid} is now part of ${restaurantName}.`);

        return NextResponse.json({ message: `Successfully joined ${restaurantName}! You can now go online to receive orders.` }, { status: 200 });

    } catch (error) {
        console.error("[API accept-invite] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: error.status || 500 });
    }
}
