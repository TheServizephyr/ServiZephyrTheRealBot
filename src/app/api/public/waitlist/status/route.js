import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

function toIso(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000).toISOString();
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000).toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const restaurantId = String(searchParams.get('restaurantId') || '').trim();
        const entryId = String(searchParams.get('entryId') || '').trim();
        const arrivalCode = String(searchParams.get('arrivalCode') || '').trim().toUpperCase();

        if (!restaurantId || !entryId || !arrivalCode) {
            return NextResponse.json({ message: 'restaurantId, entryId and arrivalCode are required.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const entryRef = firestore.collection('restaurants').doc(restaurantId).collection('waitlist').doc(entryId);
        const entrySnap = await entryRef.get();
        if (!entrySnap.exists) {
            return NextResponse.json({ message: 'Waitlist entry not found.' }, { status: 404 });
        }

        const data = entrySnap.data() || {};
        const storedCode = String(data.arrivalCode || '').trim().toUpperCase();
        if (!storedCode || storedCode !== arrivalCode) {
            return NextResponse.json({ message: 'Invalid arrival code.' }, { status: 403 });
        }

        return NextResponse.json({
            id: entrySnap.id,
            status: String(data.status || 'pending').toLowerCase(),
            waitlistToken: data.waitlistToken || '',
            name: data.name || '',
            phone: data.phone || '',
            paxCount: data.paxCount || 1,
            restaurantName: data.restaurantName || '',
            createdAt: toIso(data.createdAt),
            notifiedAt: toIso(data.notifiedAt),
            noShowDeadlineAt: toIso(data.noShowDeadlineAt),
            seatedAt: toIso(data.seatedAt),
            updatedAt: toIso(data.updatedAt),
        }, { status: 200 });
    } catch (error) {
        console.error('[public/waitlist/status] ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
