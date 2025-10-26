

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { phone } = await req.json();

        if (!phone) {
            return NextResponse.json({ message: 'Phone number is required.' }, { status: 400 });
        }
        
        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        console.log(`[DEBUG] /api/customer/lookup: Received lookup request for phone: ${normalizedPhone}`);
        
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef
            .where('phone', '==', normalizedPhone)
            .where('role', '==', 'customer')
            .limit(1)
            .get();

        if (!userQuery.empty) {
            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();
            console.log(`[DEBUG] /api/customer/lookup: Found verified user in 'users' collection. UID: ${userDoc.id}`);
            
            const responseData = {
                name: userData.name,
                addresses: userData.addresses || [],
                isVerified: true,
            };
            return NextResponse.json(responseData, { status: 200 });
        }
        
        console.log(`[DEBUG] /api/customer/lookup: No verified customer found. Checking 'unclaimed_profiles'.`);
        const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
        const unclaimedProfileSnap = await unclaimedProfileRef.get();
        
        if (unclaimedProfileSnap.exists) {
            const unclaimedData = unclaimedProfileSnap.data();
            console.log(`[DEBUG] /api/customer/lookup: Found unclaimed profile for phone: ${normalizedPhone}`);
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
        
        console.log(`[DEBUG] /api/customer/lookup: No profile found for ${normalizedPhone} in any collection.`);
        return NextResponse.json({ message: 'User not found.' }, { status: 404 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

  