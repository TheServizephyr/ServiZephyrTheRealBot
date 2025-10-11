
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { getAuth } from '@/lib/firebase-admin';

export async function GET(req) {
    try {
        const firestore = getFirestore();
        const restaurantsSnap = await firestore.collection('restaurants').get();
        
        const restaurantPromises = restaurantsSnap.docs.map(async (doc) => {
            const data = doc.data();
            
            // --- START: CRITICAL FIX ---
            // If doc.data() is undefined (document exists but has no fields), skip it.
            if (!data) {
                console.warn(`[ADMIN] Skipping empty document with ID: ${doc.id}`);
                return null;
            }
            // --- END: CRITICAL FIX ---

            const restaurant = {
                id: doc.id,
                name: data.name || 'Unnamed Restaurant',
                ownerId: data.ownerId,
                ownerName: 'N/A', 
                ownerEmail: 'N/A', 
                onboarded: data.createdAt?.toDate().toISOString() || new Date().toISOString(),
                status: data.approvalStatus || 'Pending',
            };

            if (restaurant.ownerId) {
                try {
                    const userRecord = await getAuth().getUser(restaurant.ownerId);
                    restaurant.ownerName = userRecord.displayName || 'No Name';
                    restaurant.ownerEmail = userRecord.email;
                } catch(e) {
                    console.warn(`Could not find user for ownerId: ${restaurant.ownerId}`)
                }
            }
            return restaurant;
        });

        // Filter out any null results from the skipped empty documents
        const restaurants = (await Promise.all(restaurantPromises)).filter(Boolean);

        return NextResponse.json({ restaurants }, { status: 200 });

    } catch (error) {
        console.error("ADMIN: GET RESTAURANTS ERROR", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}


export async function PATCH(req) {
    try {
        const { restaurantId, status } = await req.json();

        if (!restaurantId || !status) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }

        const validStatuses = ['Approved', 'Suspended', 'Rejected'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status provided' }, { status: 400 });
        }

        const firestore = getFirestore();
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        
        await restaurantRef.set({ approvalStatus: status }, { merge: true });
        
        return NextResponse.json({ message: 'Restaurant status updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("ADMIN: PATCH RESTAURANT ERROR", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
