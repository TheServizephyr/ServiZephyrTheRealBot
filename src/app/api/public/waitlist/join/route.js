
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { restaurantId, name, phone, paxCount } = await req.json();

        if (!restaurantId || !name || !phone || !paxCount) {
            return NextResponse.json({ message: 'Missing required fields.' }, { status: 400 });
        }

        // Validate restaurant exists
        const restaurantSnap = await firestore.collection('restaurants').doc(restaurantId).get();
        if (!restaurantSnap.exists) {
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }

        const restaurantData = restaurantSnap.data();
        if (restaurantData.isOpen === false) {
            return NextResponse.json({ message: 'Restaurant is currently closed. We are not accepting new waitlist entries.' }, { status: 403 });
        }
        if (!restaurantData.isWaitlistEnabled) {
            return NextResponse.json({ message: 'Waitlist is currently disabled for this restaurant.' }, { status: 403 });
        }

        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        if (!/^\d{10}$/.test(normalizedPhone)) {
            return NextResponse.json({ message: 'Invalid phone number format.' }, { status: 400 });
        }

        const waitlistRef = firestore.collection('restaurants').doc(restaurantId).collection('waitlist');

        // Check if phone number already exists in active waitlist
        const existingEntryQuery = await waitlistRef
            .where('phone', '==', normalizedPhone)
            .where('status', 'in', ['pending', 'notified'])
            .limit(1)
            .get();

        if (!existingEntryQuery.empty) {
            return NextResponse.json({ message: 'You are already on the waitlist for this restaurant.' }, { status: 409 });
        }

        const newEntryRef = waitlistRef.doc();
        const newEntryData = {
            id: newEntryRef.id,
            name,
            phone: normalizedPhone,
            paxCount: parseInt(paxCount) || 1,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            restaurantId: restaurantId,
            restaurantName: restaurantData.name || 'Restaurant'
        };

        await newEntryRef.set(newEntryData);

        return NextResponse.json({
            message: 'Successfully joined the waitlist!',
            entryId: newEntryRef.id
        }, { status: 201 });

    } catch (error) {
        console.error("PUBLIC JOIN WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
