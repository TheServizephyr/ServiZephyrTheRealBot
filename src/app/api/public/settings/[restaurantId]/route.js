import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
    try {
        const { restaurantId } = await params;

        if (!restaurantId) {
            return NextResponse.json({ error: 'Restaurant ID is required' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // Search in the correct collections where owner settings are actually stored
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        let businessDoc = null;

        for (const collection of collectionsToTry) {
            const docRef = firestore.collection(collection).doc(restaurantId);
            const snap = await docRef.get();
            if (snap.exists) {
                businessDoc = snap;
                break;
            }
        }

        if (!businessDoc) {
            // Return safe defaults if business not found
            return NextResponse.json({
                deliveryEnabled: true,
                pickupEnabled: true,
                dineInEnabled: true,
                deliveryCodEnabled: true,
                deliveryOnlinePaymentEnabled: true,
                pickupOnlinePaymentEnabled: true,
                pickupPodEnabled: true,
                dineInOnlinePaymentEnabled: true,
                dineInPayAtCounterEnabled: true,
            }, {
                status: 200,
                headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
            });
        }

        const businessData = businessDoc.data() || {};

        // Also fetch delivery_settings sub-collection (single source of truth for delivery settings)
        let deliveryConfig = {};
        try {
            const deliveryConfigSnap = await businessDoc.ref.collection('delivery_settings').doc('config').get();
            if (deliveryConfigSnap.exists) {
                deliveryConfig = deliveryConfigSnap.data() || {};
            }
        } catch (err) {
            console.warn('[public/settings] Failed to fetch delivery_settings sub-collection:', err);
        }

        // Fallback: sub-collection value > parent doc value > hardcoded default
        const fallback = (key, defaultVal) => deliveryConfig[key] ?? businessData[key] ?? defaultVal;

        const publicSettings = {
            deliveryEnabled: fallback('deliveryEnabled', true),
            pickupEnabled: fallback('pickupEnabled', true),
            dineInEnabled: fallback('dineInEnabled', true),
            deliveryCodEnabled: fallback('deliveryCodEnabled', true),
            deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
            pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
            pickupPodEnabled: fallback('pickupPodEnabled', true),
            dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
            dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
            deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
            deliveryFreeThreshold: fallback('deliveryFreeThreshold', null),
        };

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
