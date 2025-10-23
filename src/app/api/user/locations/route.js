
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';

// Helper to get authenticated user UID
async function getUserId(req) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Unauthorized: Missing token', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    return decodedToken.uid;
}

// GET: Fetch all saved locations for a user
export async function GET(req) {
    try {
        const uid = await getUserId(req);
        const locationsRef = getFirestore().collection('users').doc(uid).collection('locations');
        const snapshot = await locationsRef.orderBy('createdAt', 'desc').get();
        
        const locations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return NextResponse.json({ locations }, { status: 200 });
    } catch (error) {
        console.error("GET /api/user/locations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// POST: Add a new address to the user's profile
export async function POST(req) {
    try {
        const uid = await getUserId(req);
        const newAddress = await req.json();

        // Validate new address
        if (!newAddress || !newAddress.id || !newAddress.name || !newAddress.phone || !newAddress.full) {
            return NextResponse.json({ message: 'Invalid address data provided.' }, { status: 400 });
        }

        const locationRef = getFirestore().collection('users').doc(uid).collection('locations').doc(newAddress.id);
        
        await locationRef.set({
            ...newAddress,
            createdAt: FieldValue.serverTimestamp()
        });

        return NextResponse.json({ message: 'Address saved successfully!', address: newAddress }, { status: 201 });

    } catch (error) {
        console.error("POST /api/user/locations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// DELETE: Remove an address from the user's profile
export async function DELETE(req) {
    try {
        const uid = await getUserId(req);
        const { locationId } = await req.json();

        if (!locationId) {
            return NextResponse.json({ message: 'Location ID is required.' }, { status: 400 });
        }
        
        const locationRef = getFirestore().collection('users').doc(uid).collection('locations').doc(locationId);
        await locationRef.delete();

        return NextResponse.json({ message: 'Address removed successfully!' }, { status: 200 });

    } catch (error) {
        console.error("DELETE /api/user/locations ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
