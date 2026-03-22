import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { getPublicRestaurantOverview } from '@/services/business/publicRestaurantOverview.service';

export const revalidate = 60;

export async function GET(_req, { params }) {
    try {
        const restaurantId = String(params?.restaurantId || '').trim();
        if (!restaurantId) {
            return NextResponse.json({ message: 'Business ID is required.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const overview = await getPublicRestaurantOverview(firestore, restaurantId);

        if (!overview) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }

        return NextResponse.json(overview, {
            status: 200,
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
            },
        });
    } catch (error) {
        console.error('[API /public/restaurant-overview] ERROR:', error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}
