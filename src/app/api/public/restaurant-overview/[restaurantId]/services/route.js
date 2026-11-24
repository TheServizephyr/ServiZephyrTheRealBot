import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { getPublicRestaurantServiceStatus } from '@/services/business/publicRestaurantOverview.service';

export const revalidate = 30;

export async function GET(_req, { params }) {
    try {
        const firestore = await getFirestore();
        const status = await getPublicRestaurantServiceStatus(firestore, params.restaurantId);
        if (!status) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }
        return NextResponse.json(status, {
            headers: { 'Cache-Control': 'public, s-maxage=30' },
        });
    } catch (error) {
        console.error('[public restaurant services] Failed to load status:', error);
        return NextResponse.json({ message: 'Restaurant service status is unavailable.' }, { status: 500 });
    }
}
