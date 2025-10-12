
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

export async function GET(req) {
    try {
        const firestore = getFirestore();
        const restaurantsSnap = await firestore.collection('restaurants').get();
        
        const restaurantPromises = restaurantsSnap.docs.map(async (doc) => {
            const data = doc.data();
            
            if (!data || Object.keys(data).length === 0) {
                console.warn(`[API] Skipping empty document with ID: ${doc.id}`);
                return null;
            }

            // Standardize the status field. Default to 'Pending' if missing.
            const status = data.approvalStatus || 'pending';
            const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);

            const restaurant = {
                id: doc.id,
                name: data.name || 'Unnamed Restaurant',
                ownerId: data.ownerId,
                ownerName: 'N/A', 
                ownerEmail: 'N/A', 
                onboarded: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                status: capitalizedStatus, // Use the capitalized status
            };

            // This check prevents crash if ownerId is missing
            if (restaurant.ownerId) {
                try {
                    const userRecord = await getAuth().getUser(restaurant.ownerId);
                    restaurant.ownerName = userRecord.displayName || 'No Name';
                    restaurant.ownerEmail = userRecord.email;
                } catch(e) {
                    // Log a warning but don't crash the entire API call
                    console.warn(`[API] Could not find user for ownerId: ${restaurant.ownerId} in restaurant ${restaurant.name}. Proceeding without owner details.`);
                }
            }
            return restaurant;
        });

        // Filter out any null values that resulted from empty docs or errors
        const restaurants = (await Promise.all(restaurantPromises)).filter(Boolean);

        return NextResponse.json({ restaurants }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/restaurants ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}


export async function PATCH(req) {
    try {
        const { restaurantId, status, restrictedFeatures, suspensionRemark } = await req.json();

        if (!restaurantId || !status) {
            return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
        }

        const validStatuses = ['Approved', 'Suspended', 'Rejected'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status provided' }, { status: 400 });
        }

        const firestore = getFirestore();
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        
        const updateData = {
            approvalStatus: status.toLowerCase(),
        };

        if (status === 'Suspended') {
            updateData.restrictedFeatures = restrictedFeatures || [];
            updateData.suspensionRemark = suspensionRemark || '';
        } else {
            // When reactivating or rejecting, remove restrictions and remark
            updateData.restrictedFeatures = [];
            updateData.suspensionRemark = '';
        }
        
        await restaurantRef.set(updateData, { merge: true });
        
        return NextResponse.json({ message: 'Restaurant status updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("PATCH /api/admin/restaurants ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
