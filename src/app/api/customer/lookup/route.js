
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
        
        // Find the restaurant the user might have points in.
        // This is a simplification. A real-world scenario might need the restaurantId.
        const joinedRestaurantsRef = userDoc.ref.collection('joined_restaurants');
        const restaurantsSnap = await joinedRestaurantsRef.limit(1).get();
        let loyaltyPoints = 0;
        if (!restaurantsSnap.empty) {
            loyaltyPoints = restaurantsSnap.docs[0].data().loyaltyPoints || 0;
        }

        const responseData = {
            name: userData.name,
            addresses: userData.addresses || [], // Ensure addresses is always an array
            loyaltyPoints: loyaltyPoints // Send loyalty points to the frontend
        };
        
        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error('CUSTOMER LOOKUP ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
