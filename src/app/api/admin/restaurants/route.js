
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { getAuth } from '@/lib/firebase-admin';

export async function GET(req) {
    try {
        const firestore = getFirestore();
        const restaurantsSnap = await firestore.collection('restaurants').get();
        
        const restaurants = restaurantsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                ownerId: data.ownerId, // Pass ownerId to fetch details later
                ownerName: 'N/A', 
                ownerEmail: 'N/A', 
                onboarded: data.createdAt?.toDate().toISOString() || new Date().toISOString(),
                // CRITICAL FIX: Default to 'Pending' if approvalStatus is missing
                status: data.approvalStatus || 'Pending',
            };
        });

        // This is a slow operation, do not do this in production for large datasets
        // For a real app, you should denormalize ownerName and ownerEmail into the restaurant doc
        for (let restaurant of restaurants) {
            if (restaurant.ownerId) {
                try {
                    const userRecord = await getAuth().getUser(restaurant.ownerId);
                    restaurant.ownerName = userRecord.displayName || 'No Name';
                    restaurant.ownerEmail = userRecord.email;
                } catch(e) {
                    console.warn(`Could not find user for ownerId: ${restaurant.ownerId}`)
                }
            }
        }

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
        
        await restaurantRef.update({ approvalStatus: status });
        
        // If approving, make sure the doc exists by setting with merge
        if(status === 'Approved') {
            await restaurantRef.set({ approvalStatus: status }, { merge: true });
        }
        
        return NextResponse.json({ message: 'Restaurant status updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("ADMIN: PATCH RESTAURANT ERROR", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
