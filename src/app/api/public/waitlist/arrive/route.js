import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { restaurantId, entryId, arrivalCode } = await req.json();

        const safeRestaurantId = String(restaurantId || '').trim();
        const safeEntryId = String(entryId || '').trim();
        const safeCode = String(arrivalCode || '').trim().toUpperCase();

        if (!safeRestaurantId || !safeEntryId || !safeCode) {
            return NextResponse.json({ message: 'restaurantId, entryId and arrivalCode are required.' }, { status: 400 });
        }

        const entryRef = firestore.collection('restaurants')
            .doc(safeRestaurantId)
            .collection('waitlist')
            .doc(safeEntryId);

        const entrySnap = await entryRef.get();
        if (!entrySnap.exists) {
            return NextResponse.json({ message: 'Waitlist entry not found.' }, { status: 404 });
        }

        const entryData = entrySnap.data() || {};
        const currentStatus = String(entryData.status || '').toLowerCase();
        const storedCode = String(entryData.arrivalCode || '').trim().toUpperCase();

        if (!storedCode || storedCode !== safeCode) {
            return NextResponse.json({ message: 'Invalid arrival code.' }, { status: 403 });
        }

        if (['cancelled', 'no_show'].includes(currentStatus)) {
            return NextResponse.json({ message: `This queue is ${currentStatus.replace('_', ' ')}.` }, { status: 409 });
        }

        if (['arrived', 'seated'].includes(currentStatus)) {
            return NextResponse.json({
                message: currentStatus === 'seated' ? 'You are already seated.' : 'Arrival already marked.',
                status: currentStatus,
            }, { status: 200 });
        }

        await entryRef.set({
            status: 'arrived',
            arrivedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return NextResponse.json({
            message: 'Arrival marked successfully.',
            status: 'arrived',
        }, { status: 200 });
    } catch (error) {
        console.error('[public/waitlist/arrive] ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
