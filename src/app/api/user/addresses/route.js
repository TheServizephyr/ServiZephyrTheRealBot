
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { getOrCreateGuestProfile } from '@/lib/guest-utils';

// Helper to get authenticated user UID or null if not logged in
async function getUserIdFromToken(req) {
    try {
        const uid = await verifyAndGetUid(req);
        return uid;
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

        const firestore = await getFirestore();
        const userRef = firestore.collection('users').doc(uid);
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
        const { address, phone, ref, guestId: explicitGuestId } = await req.json(); // Expect phone number from the client

        // Retrieve Guest ID from Cookie
        const cookieStore = require('next/headers').cookies();
        const sessionCookie = cookieStore.get('auth_guest_session');
        let guestId = sessionCookie?.value || explicitGuestId;

        // Also support de-obfuscation if ref is passed
        /* 
           Note: If we imported deobfuscateGuestId here, we could use ref directly. 
           For now, we rely on the secure httpOnly cookie set by verify-token.
        */

        if (!address || !address.id || !address.full || typeof address.latitude !== 'number' || typeof address.longitude !== 'number') {
            console.error("[API][user/addresses] POST validation failed: Invalid address data provided.", address);
            return NextResponse.json({ message: 'Invalid address data. A full address and location coordinates are required.' }, { status: 400 });
        }

        if (!phone) {
            return NextResponse.json({ message: 'A phone number is required to save an address for a session.' }, { status: 401 });
        }

        // CRITICAL: Use UID-first priority via getOrCreateGuestProfile
        const firestore = await getFirestore();
        const normalizedPhone = phone.slice(-10);

        // Get or create user profile (UID-first, then guest)
        const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
        const userId = profileResult.userId;

        console.log(`[API][user/addresses] Resolved userId: ${userId}, isGuest: ${profileResult.isGuest}`);

        // Determine target collection
        let targetRef;
        let currentName = profileResult.data?.name || '';
        const newName = address.name;

        if (profileResult.isGuest) {
            targetRef = firestore.collection('guest_profiles').doc(userId);
            console.log(`[API][user/addresses] Saving to guest profile: ${userId}`);
        } else {
            targetRef = firestore.collection('users').doc(userId);
            console.log(`[API][user/addresses] Saving to user UID: ${userId}`);
        }

        const updateData = {
            addresses: FieldValue.arrayUnion(address),
            // Update phone on profile if missing
            phone: phone
        };

        // ✅ SYNC NAME: If profile has no name or is "Guest", update it from address contact
        if ((!currentName || currentName === 'Guest') && newName) {
            console.log(`[API][user/addresses] Updating profile name from '${currentName}' to '${newName}'`);
            updateData.name = newName;
        }

        await targetRef.set(updateData, { merge: true });

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
        const firestore = await getFirestore();
        const { addressId, phone } = await req.json();

        if (!addressId) {
            console.error("[API][user/addresses] DELETE validation failed: Address ID is required.");
            return NextResponse.json({ message: 'Address ID is required.' }, { status: 400 });
        }

        let targetRef;

        // Scenario 1: Request is from a WhatsApp user, identified by phone number
        if (phone) {
            const normalizedPhone = phone.slice(-10);
            console.log(`[API][user/addresses] DELETE request for phone number: ${normalizedPhone}`);

            // CRITICAL: Use UID-first priority
            const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
            const userId = profileResult.userId;

            if (profileResult.isGuest) {
                targetRef = firestore.collection('guest_profiles').doc(userId);
                console.log(`[API][user/addresses] Deleting from guest profile: ${userId}`);
            } else {
                targetRef = firestore.collection('users').doc(userId);
                console.log(`[API][user/addresses] Deleting from user UID: ${userId}`);
            }
        }
        // Scenario 2: Request is from a logged-in user, identified by ID token
        else {
            const uid = await getUserIdFromToken(req);
            if (!uid) {
                return NextResponse.json({ message: 'User not authenticated.' }, { status: 401 });
            }
            console.log(`[API][user/addresses] DELETE request for UID: ${uid}`);
            targetRef = firestore.collection('users').doc(uid);
        }

        const docSnap = await targetRef.get();
        if (!docSnap.exists) {
            console.warn(`[API][user/addresses] DELETE failed: User document not found at path: ${targetRef.path}.`);
            return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });
        }

        const userData = docSnap.data();
        const currentAddresses = userData.addresses || [];

        const addressExists = currentAddresses.some(addr => addr.id === addressId);
        if (!addressExists) {
            console.warn(`[API][user/addresses] DELETE failed: Address ID ${addressId} not found in profile for document: ${targetRef.path}.`);
            return NextResponse.json({ message: 'Address not found in user profile.' }, { status: 404 });
        }

        const updatedAddresses = currentAddresses.filter(addr => addr.id !== addressId);

        console.log(`[API][user/addresses] Attempting to remove address ID ${addressId} for document ${targetRef.path}.`);
        await targetRef.update({
            addresses: updatedAddresses
        });

        console.log(`[API][user/addresses] Address ID ${addressId} removed successfully for document ${targetRef.path}.`);
        return NextResponse.json({ message: 'Address removed successfully!' }, { status: 200 });

    } catch (error) {
        console.error("DELETE /api/user/addresses ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
