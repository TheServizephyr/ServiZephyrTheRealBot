import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import { getPublicSettings } from '@/services/business/publicSettings.service';

export const revalidate = 60;

export async function GET(req, { params }) {
    try {
        const { restaurantId } = await params;

        if (!restaurantId) {
            return NextResponse.json({ error: 'Restaurant ID is required' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const publicSettings = await getPublicSettings(firestore, restaurantId);

        return NextResponse.json(publicSettings, {
            status: 200,
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
            }
        });

    } catch (error) {
        console.error('Error fetching public settings:', error);
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}
