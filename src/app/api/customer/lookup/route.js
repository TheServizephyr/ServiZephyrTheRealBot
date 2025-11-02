

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { phone } = await req.json();

        if (!phone) {
            return NextResponse.json({ message: 'Phone number is required.' }, { status: 400 });
        }
        
        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        console.log(`[API /customer/lookup] Received lookup request for phone: ${normalizedPhone}`);
        
        const usersRef = firestore.collection('users');
        // Search for a VERIFIED user first.
        const userQuery = await usersRef
            .where('phone', '==', normalizedPhone)
            // .where('role', '==', 'customer') // This might be too restrictive if owners also order as customers. Let's rely on the existence in 'users' collection as a sign of verification.
            .limit(1)
            .get();

        if (!userQuery.empty) {
            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();
            console.log(`[API /customer/lookup] Found verified user in 'users' collection. UID: ${userDoc.id}`);
            
            const responseData = {
                name: userData.name,
                addresses: userData.addresses || [],
                isVerified: true,
            };
            return NextResponse.json(responseData, { status: 200 });
        }
        
        // If no verified user, check for an UNCLAIMED profile.
        console.log(`[API /customer/lookup] No verified user found. Checking 'unclaimed_profiles'.`);
        const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
        const unclaimedProfileSnap = await unclaimedProfileRef.get();
        
        if (unclaimedProfileSnap.exists) {
            const unclaimedData = unclaimedProfileSnap.data();
            console.log(`[API /customer/lookup] Found unclaimed profile for phone: ${normalizedPhone}`);
            const responseData = {
                name: unclaimedData.name,
                // Ensure addresses from unclaimed profiles are also in the correct format
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
        
        console.log(`[API /customer/lookup] No profile found for ${normalizedPhone} in any collection.`);
        return NextResponse.json({ message: 'User not found.' }, { status: 404 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP API ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
