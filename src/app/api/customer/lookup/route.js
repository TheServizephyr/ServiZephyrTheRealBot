
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { phone } = await req.json();

        if (!phone) {
            return NextResponse.json({ message: 'Phone number is required.' }, { status: 400 });
        }
        
        // Normalize phone to 10 digits
        const normalizedPhone = phone.startsWith('91') ? phone.substring(2) : phone;
        
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();

        if (userQuery.empty) {
            return NextResponse.json({ message: 'User not found.' }, { status: 404 });
        }
        
        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        
        const responseData = {
            name: userData.name,
            addresses: userData.addresses || [] // Ensure addresses is always an array
        };
        
        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
