import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { searchDishes } from '@/services/public/foodSearch.service';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q') || '';
        const latStr = searchParams.get('lat');
        const lngStr = searchParams.get('lng');
        const filter = searchParams.get('filter') || 'nearest';
        const page = parseInt(searchParams.get('page') || '1', 10);
        const limit = parseInt(searchParams.get('limit') || '15', 10);

        const lat = latStr ? parseFloat(latStr) : null;
        const lng = lngStr ? parseFloat(lngStr) : null;

        const city = searchParams.get('city') || null;

        const firestore = await getFirestore();

        const results = await searchDishes(firestore, {
            query,
            lat,
            lng,
            filter,
            page,
            limit,
            city
        });

        // Add Cache-Control header to allow browser caching if desired (optional)
        return NextResponse.json(results, {
            status: 200,
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
            }
        });
    } catch (error) {
        console.error('GET /api/public/food-search error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            message: error.message
        }, { status: 500 });
    }
}
