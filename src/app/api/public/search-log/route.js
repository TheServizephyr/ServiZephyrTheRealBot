import { NextResponse } from 'next/server';
import { getFirestore, Timestamp } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const { query, lat, lng, areaHint = '' } = body;

        if (!query || typeof query !== 'string' || !query.trim()) {
            return NextResponse.json({ error: 'Query is required and must be a non-empty string' }, { status: 400 });
        }

        const firestore = await getFirestore();

        const searchLog = {
            query: query.trim().toLowerCase(),
            timestamp: Timestamp.now(),
        };

        if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
            const parsedLat = parseFloat(lat);
            const parsedLng = parseFloat(lng);
            if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
                searchLog.coordinates = {
                    lat: parsedLat,
                    lng: parsedLng
                };
            }
        }

        if (areaHint && typeof areaHint === 'string') {
            searchLog.areaHint = areaHint.trim();
        }

        const docRef = await firestore.collection('searches').add(searchLog);

        return NextResponse.json({
            success: true,
            id: docRef.id
        }, { status: 201 });
    } catch (error) {
        console.error('POST /api/public/search-log error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            message: error.message
        }, { status: 500 });
    }
}
