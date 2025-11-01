
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their UID
async function verifyOwner(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use the central helper
    
    // Admin impersonation logic
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing connections for owner ${impersonatedOwnerId}.`);
        return impersonatedOwnerId;
    }

    if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    return uid;
}

export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const ownerId = await verifyOwner(req, auth, firestore);

        const restaurantsQuery = await firestore.collection('restaurants')
            .where('ownerId', '==', ownerId)
            .where('botStatus', '==', 'Connected')
            .get();
            
        const shopsQuery = await firestore.collection('shops')
            .where('ownerId', '==', ownerId)
            .where('botStatus', '==', 'Connected')
            .get();

        if (restaurantsQuery.empty && shopsQuery.empty) {
            return NextResponse.json({ connections: [] }, { status: 200 });
        }
        
        const restaurantConnections = restaurantsQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                restaurantName: data.name,
                whatsAppNumber: data.botPhoneNumberId,
                status: data.botStatus
            };
        });
        
        const shopConnections = shopsQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                restaurantName: data.name,
                whatsAppNumber: data.botPhoneNumberId,
                status: data.botStatus
            };
        });

        const connections = [...restaurantConnections, ...shopConnections];

        return NextResponse.json({ connections }, { status: 200 });

    } catch (error) {
        console.error("GET /api/owner/connections ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
