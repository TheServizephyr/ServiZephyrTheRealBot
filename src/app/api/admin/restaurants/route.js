
import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase-admin/app';

// This function should be in a lib file but placing here for simplicity
function initAdmin() {
    if (!getApps().length) {
        // You need to configure your service account in environment variables
        // for this to work on Vercel
        initializeApp();
    }
}
initAdmin();


export async function GET(req) {
    try {
        const firestore = getFirestore();
        const restaurantsSnap = await firestore.collection('restaurants').get();
        
        const restaurants = restaurantsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                ownerName: 'N/A', // You need a way to link ownerId to owner name
                ownerEmail: 'N/A', // Same as above
                onboarded: data.createdAt?.toDate().toISOString() || new Date().toISOString(),
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
        
        if (status === 'Rejected') {
            await restaurantRef.delete();
            return NextResponse.json({ message: 'Restaurant rejected and deleted successfully' }, { status: 200 });
        } else {
             await restaurantRef.update({ approvalStatus: status });
             return NextResponse.json({ message: 'Restaurant status updated successfully' }, { status: 200 });
        }


    } catch (error) {
        console.error("ADMIN: PATCH RESTAURANT ERROR", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

