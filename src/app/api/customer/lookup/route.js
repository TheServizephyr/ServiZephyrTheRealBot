

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { getOrCreateGuestProfile } from '@/lib/guest-utils';

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const body = await req.json(); // Body might be empty if using cookie
        const { phone, guestId: explicitGuestId } = body || {};

        // 1. Check for Secure Session Cookie
        const cookieStore = cookies();
        const sessionCookie = cookieStore.get('auth_guest_session');
        let guestId = sessionCookie?.value || explicitGuestId;

        console.log(`[API /customer/lookup] Request - GuestID: ${guestId ? 'Yes' : 'No'}, Phone: ${phone ? 'Yes' : 'No'}`);

        // --- GUEST PROFILE LOOKUP ---
        if (guestId) {
            console.log(`[API /customer/lookup] Fetching Guest Profile: ${guestId}`);
            const guestDoc = await firestore.collection('guest_profiles').doc(guestId).get();

            if (guestDoc.exists) {
                const guestData = guestDoc.data();
                return NextResponse.json({
                    name: guestData.name || 'Guest',
                    addresses: guestData.addresses || [],
                    isVerified: false, // Guests are not "verified" users in the traditional sense
                    isGuest: true
                }, { status: 200 });
            } else {
                console.warn(`[API /customer/lookup] Guest Profile not found: ${guestId}`);
                // Fallthrough? If provided GuestID is invalid, should we fail?
                // Probably yes.
                return NextResponse.json({ message: 'Guest profile not found.' }, { status: 404 });
            }
        }

        // --- LEGACY PHONE LOOKUP ---
        if (!phone) {
            return NextResponse.json({ message: 'User identifier required.' }, { status: 400 });
        }

        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        console.log(`[API /customer/lookup] Phone Lookup (UID-first): ${normalizedPhone}`);

        // CRITICAL: Use UID-first priority via getOrCreateGuestProfile
        const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
        const userId = profileResult.userId;

        let userData;
        if (profileResult.isGuest) {
            // Guest profile
            const guestDoc = await firestore.collection('guest_profiles').doc(userId).get();
            if (guestDoc.exists) {
                userData = guestDoc.data();
                return NextResponse.json({
                    name: userData.name || 'Guest',
                    addresses: userData.addresses || [],
                    isVerified: false,
                    isGuest: true
                }, { status: 200 });
            }
        } else {
            // Logged-in user (UID)
            const userDoc = await firestore.collection('users').doc(userId).get();
            if (userDoc.exists) {
                userData = userDoc.data();
                return NextResponse.json({
                    name: userData.name,
                    addresses: userData.addresses || [],
                    isVerified: true
                }, { status: 200 });
            }
        }

        return NextResponse.json({ message: 'User not found.' }, { status: 404 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP API ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
