
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';

// Helper to get authenticated user UID
async function getUserId(req) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Allow non-authenticated users for specific scenarios if needed, otherwise throw.
        // For now, we enforce authentication for adding/deleting addresses.
        throw { message: 'Unauthorized', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    return decodedToken.uid;
}

// POST: Add a new address to the user's profile
export async function POST(req) {
    try {
        const uid = await getUserId(req);
        const newAddress = await req.json();

        // Validate new address - it is now a structured object with a 'full' property
        if (!newAddress || !newAddress.id || !newAddress.name || !newAddress.phone || !newAddress.street || !newAddress.city || !newAddress.pincode || !newAddress.state || !newAddress.full) {
            return NextResponse.json({ message: 'Invalid address data provided. All fields are required.' }, { status: 400 });
        }

        const userRef = getFirestore().collection('users').doc(uid);
        
        await userRef.update({
            addresses: FieldValue.arrayUnion(newAddress)
        });

        return NextResponse.json({ message: 'Address added successfully!', address: newAddress }, { status: 200 });

    } catch (error) {
        console.error("POST /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// DELETE: Remove an address from the user's profile
export async function DELETE(req) {
    try {
        const uid = await getUserId(req);
        const { addressId } = await req.json();

        if (!addressId) {
            return NextResponse.json({ message: 'Address ID is required.' }, { status: 400 });
        }
        
        const userRef = getFirestore().collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return NextResponse.json({ message: 'User not found.' }, { status: 404 });
        }
        
        const userData = userDoc.data();
        const currentAddresses = userData.addresses || [];
        
        const addressToRemove = currentAddresses.find(addr => addr.id === addressId);

        if (!addressToRemove) {
            return NextResponse.json({ message: 'Address not found in user profile.' }, { status: 404 });
        }
        
        await userRef.update({
            addresses: FieldValue.arrayRemove(addressToRemove)
        });

        return NextResponse.json({ message: 'Address removed successfully!' }, { status: 200 });

    } catch (error) {
        console.error("DELETE /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
