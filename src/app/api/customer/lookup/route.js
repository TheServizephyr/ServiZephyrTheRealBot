

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';

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
        console.log(`[API /customer/lookup] Legacy Phone Lookup: ${normalizedPhone}`);

        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();

        if (!userQuery.empty) {
            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();

            return NextResponse.json({
                name: userData.name,
                addresses: userData.addresses || [],
                isVerified: true,
            }, { status: 200 });
        }

        // Unclaimed Profile (Legacy Data)
        const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
        const unclaimedProfileSnap = await unclaimedProfileRef.get();

        if (unclaimedProfileSnap.exists) {
            const unclaimedData = unclaimedProfileSnap.data();
            const responseData = {
                name: unclaimedData.name,
                addresses: (unclaimedData.addresses || []).map(addr => {
                    if (typeof addr === 'string') {
                        return {
                            id: `addr_unclaimed_${Date.now()}`,
                            label: 'Default',
                            name: unclaimedData.name || 'User',
                            phone: unclaimedData.phone || '',
                            street: addr,
                            city: '',
                            state: '',
                            pincode: '',
                            country: 'IN',
                            full: addr
                        };
                    }
                    if (addr && typeof addr === 'object' && !addr.full) {
                        addr.full = `${addr.street || ''}, ${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`.replace(/, , /g, ', ').trim();
                    }
                    return addr;
                }).filter(Boolean),
                isVerified: false,
            };
            return NextResponse.json(responseData, { status: 200 });
        }

        return NextResponse.json({ message: 'User not found.' }, { status: 404 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP API ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
