
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
        
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();

        if (!userQuery.empty) {
            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();
            
            const responseData = {
                name: userData.name,
                addresses: userData.addresses || [],
                isVerified: true,
            };
            return NextResponse.json(responseData, { status: 200 });
        }
        
        const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
        const unclaimedProfileSnap = await unclaimedProfileRef.get();
        
        if (unclaimedProfileSnap.exists) {
            const unclaimedData = unclaimedProfileSnap.data();
            const responseData = {
                name: unclaimedData.name,
                addresses: unclaimedData.addresses || [],
                isVerified: false, 
            };
             return NextResponse.json(responseData, { status: 200 });
        }
        
        return NextResponse.json({ message: 'User not found.' }, { status: 404 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

    