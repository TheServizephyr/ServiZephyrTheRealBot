
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

export async function GET(req) {
    try {
        const firestore = getFirestore();
        const restaurantsSnap = await firestore.collection('restaurants').get();
        
        const restaurantPromises = restaurantsSnap.docs.map(async (doc) => {
            const data = doc.data();
            
            // CRITICAL FIX: If a document is empty (but might have subcollections), skip it.
            if (!data) {
                console.warn(`[API] Skipping empty document with ID: ${doc.id}`);
                return null;
            }

            const restaurant = {
                id: doc.id,
                name: data.name || 'Unnamed Restaurant',
                ownerId: data.ownerId,
                ownerName: 'N/A', 
                ownerEmail: 'N/A', 
                // SAFETY NET: Use a default date if createdAt is missing
                onboarded: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                // SAFETY NET: Default to 'Pending' if approvalStatus is missing
                status: data.approvalStatus || 'Pending',
            };

            if (restaurant.ownerId) {
                try {
                    const userRecord = await getAuth().getUser(restaurant.ownerId);
                    restaurant.ownerName = userRecord.displayName || 'No Name';
                    restaurant.ownerEmail = userRecord.email;
                } catch(e) {
                    // This catch block is important to prevent a crash if a user is not found
                    console.warn(`[API] Could not find user for ownerId: ${restaurant.ownerId} in restaurant ${restaurant.name}. Proceeding without owner details.`);
                }
            }
            return restaurant;
        });

        // Use filter(Boolean) to remove any null entries from empty documents
        const restaurants = (await Promise.all(restaurantPromises)).filter(Boolean);

        return NextResponse.json({ restaurants }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/restaurants ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
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
        console.error("PATCH /api/admin/restaurants ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
