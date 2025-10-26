
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';

// Helper to get authenticated user UID
async function getUserId(req) {
    console.log("[API][user/addresses] Verifying user token...");
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Unauthorized', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(token);
    console.log(`[API][user/addresses] Token verified. UID: ${decodedToken.uid}`);
    return decodedToken.uid;
}

// GET: Fetch all saved addresses for a user
export async function GET(req) {
    console.log("[API][user/addresses] GET request received.");
    try {
        const uid = await getUserId(req);
        const userRef = getFirestore().collection('users').doc(uid);
        const docSnap = await userRef.get();
        
        if (!docSnap.exists) {
             console.warn(`[API][user/addresses] User document not found for UID: ${uid}.`);
             return NextResponse.json({ addresses: [] }, { status: 200 });
        }
        
        console.log(`[API][user/addresses] User document found for UID: ${uid}.`);
        const userData = docSnap.data();
        const addresses = userData.addresses || [];
        
        console.log(`[API][user/addresses] Found ${addresses.length} addresses for user.`);
        console.log("[API][user/addresses] Sending addresses in response:", JSON.stringify(addresses, null, 2));


        return NextResponse.json({ addresses }, { status: 200 });
    } catch (error) {
        console.error("GET /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// POST: Add a new address to the user's profile
export async function POST(req) {
    console.log("[API][user/addresses] POST request received.");
    const uid = await getUserId(req);
    const newAddress = await req.json();

    try {
        // Validate new address - it is now a structured object with a 'full' property
        if (!newAddress || !newAddress.id || !newAddress.name || !newAddress.phone || !newAddress.street || !newAddress.city || !newAddress.pincode || !newAddress.state || !newAddress.full) {
            console.error("[API][user/addresses] POST validation failed: Invalid address data provided.", newAddress);
            return NextResponse.json({ message: 'Invalid address data provided. All fields are required.' }, { status: 400 });
        }

        const userRef = getFirestore().collection('users').doc(uid);
        
        console.log(`[API][user/addresses] Attempting to add address for user ${uid}.`);
        await userRef.update({
            addresses: FieldValue.arrayUnion(newAddress)
        });

        console.log(`[API][user/addresses] Address added successfully for user ${uid}.`);
        return NextResponse.json({ message: 'Address added successfully!', address: newAddress }, { status: 200 });

    } catch (error) {
        console.error(`[API][user/addresses] POST /api/user/addresses ERROR for UID ${uid}:`, error);
        if (error.code === 'not-found' || error.message.includes('NOT_FOUND')) {
             console.warn(`[API][user/addresses] User document for ${uid} not found. Creating a new one.`);
             try {
                const userRef = getFirestore().collection('users').doc(uid);
                await userRef.set({ addresses: [newAddress] }, { merge: true });
                 console.log(`[API][user/addresses] New user document created and address added for UID ${uid}.`);
                return NextResponse.json({ message: 'User profile created and address added!', address: newAddress }, { status: 201 });
             } catch (createError) {
                 console.error(`[API][user/addresses] POST (CREATE) ERROR for UID ${uid}:`, createError);
                 return NextResponse.json({ message: createError.message || 'Internal Server Error' }, { status: 500 });
             }
        }
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// DELETE: Remove an address from the user's profile
export async function DELETE(req) {
    console.log("[API][user/addresses] DELETE request received.");
    try {
        const uid = await getUserId(req);
        const { addressId } = await req.json();

        if (!addressId) {
             console.error("[API][user/addresses] DELETE validation failed: Address ID is required.");
            return NextResponse.json({ message: 'Address ID is required.' }, { status: 400 });
        }
        
        const userRef = getFirestore().collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
             console.warn(`[API][user/addresses] DELETE failed: User document not found for UID: ${uid}.`);
            return NextResponse.json({ message: 'User not found.' }, { status: 404 });
        }
        
        const userData = userDoc.data();
        const currentAddresses = userData.addresses || [];
        
        const addressToRemove = currentAddresses.find(addr => addr.id === addressId);

        if (!addressToRemove) {
             console.warn(`[API][user/addresses] DELETE failed: Address ID ${addressId} not found in user profile for UID ${uid}.`);
            return NextResponse.json({ message: 'Address not found in user profile.' }, { status: 404 });
        }
        
        console.log(`[API][user/addresses] Attempting to remove address ID ${addressId} for user ${uid}.`);
        await userRef.update({
            addresses: FieldValue.arrayRemove(addressToRemove)
        });

        console.log(`[API][user/addresses] Address ID ${addressId} removed successfully for user ${uid}.`);
        return NextResponse.json({ message: 'Address removed successfully!' }, { status: 200 });

    } catch (error) {
        console.error("DELETE /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
