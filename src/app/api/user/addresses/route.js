

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';

// Helper to get authenticated user UID or null if not logged in
async function getUserIdFromToken(req) {
    try {
        const authHeader = req.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await getAuth().verifyIdToken(token);
        return decodedToken.uid;
    } catch (error) {
        // Token is invalid, expired, or not present
        return null;
    }
}


// GET: Fetch all saved addresses for a user
export async function GET(req) {
    console.log("[API][user/addresses] GET request received.");
    try {
        const uid = await getUserIdFromToken(req);
        if (!uid) {
            return NextResponse.json({ message: 'User not authenticated.' }, { status: 401 });
        }

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
        return NextResponse.json({ addresses }, { status: 200 });
    } catch (error) {
        console.error("GET /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// POST: Add a new address to the user's profile
export async function POST(req) {
    console.log("[API][user/addresses] POST request received.");
    try {
        const uid = await getUserIdFromToken(req);
        const { address, phone } = await req.json(); // Expect phone number from the client

        // --- VALIDATION ---
        if (!address || !address.id || !address.full || typeof address.latitude !== 'number' || typeof address.longitude !== 'number') {
            console.error("[API][user/addresses] POST validation failed: Invalid address data provided.", address);
            return NextResponse.json({ message: 'Invalid address data. A full address and location coordinates are required.' }, { status: 400 });
        }
        
        const firestore = getFirestore();
        let targetRef;

        // --- REVISED LOGIC: Determine where to save the address ---
        if (uid) {
            // If the user is logged in, always save to their UID-based document.
            console.log(`[API][user/addresses] User is logged in (UID: ${uid}). Saving address to 'users' collection.`);
            targetRef = firestore.collection('users').doc(uid);
        } else if (phone) {
            // If not logged in, but a phone number is provided (from WhatsApp flow).
            const normalizedPhone = phone.slice(-10);
            console.log(`[API][user/addresses] User not logged in. Using phone number: ${normalizedPhone}.`);
            
            // First, check if a verified user exists with this phone number.
            const userQuery = await firestore.collection('users').where('phone', '==', normalizedPhone).limit(1).get();
            if (!userQuery.empty) {
                // A verified user exists, save the address to their profile.
                targetRef = userQuery.docs[0].ref;
                 console.log(`[API][user/addresses] Found existing verified user for phone. Saving to UID: ${targetRef.id}.`);
            } else {
                // No verified user found, save to (or create) an unclaimed profile.
                targetRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
                 console.log(`[API][user/addresses] No verified user found. Saving to 'unclaimed_profiles' for phone: ${normalizedPhone}.`);
            }
        } else {
            // If no UID and no phone number, we cannot save the address.
             return NextResponse.json({ message: 'Authentication token or phone number is required to save an address.' }, { status: 401 });
        }

        // Add the address to the determined target document.
        await targetRef.set({
            addresses: FieldValue.arrayUnion(address)
        }, { merge: true });

        console.log(`[API][user/addresses] Address added successfully to document: ${targetRef.path}.`);
        return NextResponse.json({ message: 'Address added successfully!', address }, { status: 200 });

    } catch (error) {
        console.error(`[API][user/addresses] POST /api/user/addresses ERROR:`, error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// DELETE: Remove an address from the user's profile
export async function DELETE(req) {
    console.log("[API][user/addresses] DELETE request received.");
    try {
        const uid = await getUserIdFromToken(req);
        if (!uid) {
            return NextResponse.json({ message: 'User not authenticated.' }, { status: 401 });
        }
        
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


