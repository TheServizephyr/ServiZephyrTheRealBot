import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

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

        if (currentStatus === 'seated') {
            return NextResponse.json({
                message: 'You are already seated.',
                status: 'seated',
            }, { status: 200 });
        }

        if (currentStatus === 'arrived') {
            return NextResponse.json({
                message: 'Arrival already marked by staff.',
                status: 'arrived',
            }, { status: 200 });
        }

        return NextResponse.json({
            message: 'Token verified. Please show this token to restaurant staff for seating.',
            status: currentStatus || 'pending',
        }, { status: 200 });
    } catch (error) {
        console.error('[public/waitlist/arrive] ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
