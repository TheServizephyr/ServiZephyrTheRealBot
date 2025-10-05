import { firestore as adminFirestore } from 'firebase-admin';
import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { name, address, phone, restaurantId } = await req.json();

        if (!name || !address || !phone || !restaurantId) {
            return NextResponse.json({ message: 'Missing required fields.' }, { status: 400 });
        }
        
        if (!/^\d{10}$/.test(phone)) {
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }
        
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        const restaurantDoc = await restaurantRef.get();
        if (!restaurantDoc.exists) {
            return NextResponse.json({ message: 'This restaurant does not exist.' }, { status: 404 });
        }

        const batch = firestore.batch();
        
        const usersRef = firestore.collection('users');
        const existingUserQuery = await usersRef.where('phone', '==', phone).limit(1).get();

        if (!existingUserQuery.empty) {
            const existingUserDoc = existingUserQuery.docs[0];
            const masterUid = existingUserDoc.id;
            console.log(`[Register API] Existing user found with UID: ${masterUid} for phone: ${phone}. Merging details.`);

            batch.update(existingUserDoc.ref, {
                name: name,
                address: address, 
            });

            const restaurantCustomerRef = restaurantRef.collection('customers').doc(masterUid);
            batch.set(restaurantCustomerRef, {
                name: name,
                phone: phone,
                address: address,
                email: existingUserDoc.data().email,
                totalSpend: 0,
                loyaltyPoints: 0,
                totalOrders: 0,
                lastOrderDate: null,
                notes: 'Customer details added via WhatsApp form.',
                status: 'claimed'
            }, { merge: true });

            const userRestaurantLinkRef = existingUserDoc.ref.collection('joined_restaurants').doc(restaurantId);
            batch.set(userRestaurantLinkRef, {
                restaurantName: restaurantDoc.data().name,
                joinedAt: adminFirestore.FieldValue.serverTimestamp(),
                totalSpend: 0,
                loyaltyPoints: 0,
                totalOrders: 0,
            });

            await batch.commit();

            console.log(`[Register API] Updated master profile, created claimed restaurant customer entry, and added to joined_restaurants for UID: ${masterUid}`);

        } else {
            console.log(`[Register API] No existing user found for phone: ${phone}. Creating unclaimed profile.`);

            const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(phone);
            batch.set(unclaimedProfileRef, {
                name: name,
                address: address,
                phone: phone,
                associatedRestaurants: adminFirestore.FieldValue.arrayUnion(restaurantId),
                createdAt: adminFirestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            
            const restaurantCustomerRef = restaurantRef.collection('customers').doc(phone);
            batch.set(restaurantCustomerRef, {
                name: name,
                phone: phone,
                address: address,
                totalSpend: 0,
                loyaltyPoints: 0,
                totalOrders: 0,
                lastOrderDate: null,
                notes: 'Customer joined via WhatsApp form.',
                status: 'unclaimed'
            }, { merge: true });

            await batch.commit();

            console.log(`[Register API] Created unclaimed profile AND temp restaurant customer entry for phone: ${phone}`);
        }


        return NextResponse.json({ 
            message: 'Thank you! Your details have been saved. You can now close this window and return to WhatsApp to place your order.'
        }, { status: 200 });

    } catch (error) {
        console.error('CUSTOMER REGISTRATION ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
