
import { firestore as adminFirestore } from 'firebase-admin';
import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { name, address, phone, restaurantId, items, notes } = await req.json();

        if (!name || !address || !phone || !restaurantId || !items) {
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

        let userId;
        let userData;

        if (!existingUserQuery.empty) {
            const existingUserDoc = existingUserQuery.docs[0];
            userId = existingUserDoc.id;
            userData = existingUserDoc.data();
            console.log(`[Order API] Existing user found with UID: ${userId} for phone: ${phone}.`);
            
            // Check if address already exists, if not, add it
            const userAddresses = userData.addresses || [];
            if (!userAddresses.some(a => a.full === address)) {
                 batch.update(existingUserDoc.ref, {
                    addresses: adminFirestore.FieldValue.arrayUnion({ id: `addr_${Date.now()}`, full: address })
                }, { merge: true });
            }

        } else {
            console.log(`[Order API] No existing user found for phone: ${phone}. Creating new user profile.`);
            const newUserRef = usersRef.doc(); // Auto-generate UID
            userId = newUserRef.id;
            
            batch.set(newUserRef, {
                name: name,
                phone: phone,
                addresses: [{ id: `addr_${Date.now()}`, full: address }],
                role: 'customer',
                createdAt: adminFirestore.FieldValue.serverTimestamp(),
            });
            console.log(`[Order API] New user profile created with UID: ${userId}`);
        }

        // Add to restaurant's customer sub-collection
        const restaurantCustomerRef = restaurantRef.collection('customers').doc(userId);
        batch.set(restaurantCustomerRef, {
            name: name, // Denormalize for easy lookup in dashboard
            phone: phone,
            status: 'claimed',
        }, { merge: true });

         // Add to user's joined_restaurants sub-collection
        const userRestaurantLinkRef = usersRef.doc(userId).collection('joined_restaurants').doc(restaurantId);
        batch.set(userRestaurantLinkRef, {
             restaurantName: restaurantDoc.data().name,
             joinedAt: adminFirestore.FieldValue.serverTimestamp(),
        }, { merge: true });


        // Create the actual order
        const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const newOrderRef = firestore.collection('orders').doc();
        batch.set(newOrderRef, {
            customerName: name,
            customerId: userId,
            customerAddress: address,
            customerPhone: phone,
            restaurantId: restaurantId,
            restaurantName: restaurantDoc.data().name,
            items: items.map(item => ({ name: item.name, qty: item.quantity, price: item.price })),
            totalAmount: totalAmount,
            status: 'pending',
            priority: Math.floor(Math.random() * 5) + 1, // Random priority for now
            orderDate: adminFirestore.FieldValue.serverTimestamp(),
            notes: notes || null
        });
        
        console.log(`[Order API] Order ${newOrderRef.id} created for user ${userId}.`);

        await batch.commit();

        return NextResponse.json({ 
            message: 'Order placed successfully! We will notify you on WhatsApp.'
        }, { status: 200 });

    } catch (error) {
        console.error('CUSTOMER ORDER/REGISTER ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
