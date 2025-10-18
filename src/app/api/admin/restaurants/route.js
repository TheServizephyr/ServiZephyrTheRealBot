
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

async function fetchCollection(firestore, collectionName) {
    const snapshot = await firestore.collection(collectionName).get();
    const auth = getAuth();
    
    const promises = snapshot.docs.map(async (doc) => {
        const data = doc.data();
        
        if (!data || Object.keys(data).length === 0) {
            console.warn(`[API] Skipping empty document in ${collectionName} with ID: ${doc.id}`);
            return null;
        }

        const status = data.approvalStatus || 'pending';
        const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);

        const business = {
            id: doc.id,
            name: data.name || 'Unnamed Business',
            ownerId: data.ownerId,
            ownerName: 'N/A', 
            ownerEmail: 'N/A', 
            onboarded: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            status: capitalizedStatus,
            restrictedFeatures: data.restrictedFeatures || [],
            businessType: data.businessType || (collectionName === 'restaurants' ? 'restaurant' : 'shop'),
        };

        if (business.ownerId) {
            try {
                const userRecord = await auth.getUser(business.ownerId);
                business.ownerName = userRecord.displayName || 'No Name';
                business.ownerEmail = userRecord.email;
            } catch(e) {
                console.warn(`[API] Could not find user for ownerId: ${business.ownerId} in ${business.name}.`);
            }
        }
        return business;
    });

    return (await Promise.all(promises)).filter(Boolean);
}

export async function GET(req) {
    try {
        const firestore = getFirestore();
        
        const [restaurants, shops] = await Promise.all([
            fetchCollection(firestore, 'restaurants'),
            fetchCollection(firestore, 'shops')
        ]);
        
        const allListings = [...restaurants, ...shops];
        
        // Sort by onboarding date as a default
        allListings.sort((a, b) => new Date(b.onboarded) - new Date(a.onboarded));

        return NextResponse.json({ restaurants: allListings }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/restaurants ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}


export async function PATCH(req) {
    try {
        const { restaurantId, businessType, status, restrictedFeatures, suspensionRemark } = await req.json();

        if (!restaurantId || !businessType || !status) {
            return NextResponse.json({ message: 'Missing required fields: restaurantId, businessType, status' }, { status: 400 });
        }

        const validStatuses = ['Approved', 'Suspended', 'Rejected'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status provided' }, { status: 400 });
        }

        const firestore = getFirestore();
        const collectionName = businessType === 'restaurant' ? 'restaurants' : 'shops';
        const restaurantRef = firestore.collection(collectionName).doc(restaurantId);
        
        const updateData = {
            approvalStatus: status.toLowerCase(),
        };

        if (status === 'Suspended') {
            updateData.restrictedFeatures = restrictedFeatures || [];
            updateData.suspensionRemark = suspensionRemark || '';
        } else {
            // Clear suspension details when moving to another status
            updateData.restrictedFeatures = [];
            updateData.suspensionRemark = '';
        }
        
        await restaurantRef.set(updateData, { merge: true });
        
        return NextResponse.json({ message: 'Business status updated successfully' }, { status: 200 });

    } catch (error) {
        console.error("PATCH /api/admin/restaurants ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
