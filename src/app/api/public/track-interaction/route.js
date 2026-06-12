import { NextResponse } from 'next/server';
import { businessRepository } from '@/repositories/business.repository';

export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const { businessId, businessType = 'restaurant', metric } = body;

        if (!businessId) {
            return NextResponse.json({ error: 'businessId is required' }, { status: 400 });
        }

        const validMetrics = ['profileViewCount', 'searchCount', 'appearanceCount'];
        if (!metric || !validMetrics.includes(metric)) {
            return NextResponse.json({ error: `Invalid metric. Must be one of: ${validMetrics.join(', ')}` }, { status: 400 });
        }

        // Validate business type mapping
        const validTypes = ['restaurant', 'shop', 'store', 'street-vendor', 'street_vendor'];
        if (!validTypes.includes(businessType)) {
            return NextResponse.json({ error: 'Invalid businessType' }, { status: 400 });
        }

        // Translate types if necessary to match repository expectations
        let repoType = businessType;
        if (businessType === 'store') repoType = 'shop';
        if (businessType === 'street-vendor') repoType = 'street_vendor';

        // Perform the atomic increment with a timeout fallback for offline/development environments
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Metric increment timed out after 2000ms')), 2000);
        });

        try {
            await Promise.race([
                businessRepository.incrementMetric(businessId, repoType, metric, 1),
                timeoutPromise
            ]);
            return NextResponse.json({ success: true, message: `Incremented ${metric}` }, { status: 200 });
        } catch (dbErr) {
            console.warn(`[track-interaction] Operating in offline mode or DB timed out: ${dbErr.message}`);
            return NextResponse.json({ success: true, offline: true, message: 'Offline fallback success' }, { status: 200 });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
}
