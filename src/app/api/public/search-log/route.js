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

        // Write the log entry with a timeout fallback for offline/development environments
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Search log write timed out after 2000ms')), 2000);
        });

        try {
            const docRef = await Promise.race([
                firestore.collection('searches').add(searchLog),
                timeoutPromise
            ]);
            return NextResponse.json({
                success: true,
                id: docRef.id
            }, { status: 201 });
        } catch (dbErr) {
            console.warn(`[search-log] Operating in offline mode or DB timed out: ${dbErr.message}`);
            return NextResponse.json({ success: true, offline: true, message: 'Offline fallback success' }, { status: 201 });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
}
