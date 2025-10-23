
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function verifyOwnerAndGetBusinessRef(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader) throw { message: 'Unauthorized', status: 401 };
    
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    let targetOwnerId = uid;
    if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
        throw { message: 'Access Denied', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].ref;
    }
    
    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}

export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        
        const conversationsSnap = await businessRef.collection('conversations')
            .orderBy('lastMessageTimestamp', 'desc')
            .get();
            
        const conversations = conversationsSnap.docs.map(doc => {
            const data = doc.data();
            // Ensure timestamp is serializable
            const lastMessageTimestamp = data.lastMessageTimestamp?.toDate ? data.lastMessageTimestamp.toDate().toISOString() : null;
            return {
                ...data,
                lastMessageTimestamp,
            };
        });

        return NextResponse.json({ conversations }, { status: 200 });

    } catch (error) {
        console.error("GET /api/owner/whatsapp-direct/conversations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
