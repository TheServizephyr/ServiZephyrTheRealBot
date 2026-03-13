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
        let settingsRef = firestore.collection('settings').doc(restaurantId);
        let settingsDoc = await settingsRef.get();
        // If no settings found, check if it's a store/street_vendor
        if (!settingsDoc.exists) {
            settingsRef = firestore.collection('store_settings').doc(restaurantId);
            settingsDoc = await settingsRef.get();
            if (!settingsDoc.exists) {
                settingsRef = firestore.collection('vendor_settings').doc(restaurantId);
                settingsDoc = await settingsRef.get();
            }
        }

        if (!settingsDoc.exists) {
            // Return default settings if none exist
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
                headers: {
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
                }
            });
        }

        const data = settingsDoc.data() || {};

        // Return only safe, non-sensitive settings to public
        const publicSettings = {
            deliveryEnabled: data.deliveryEnabled !== false,
            pickupEnabled: data.pickupEnabled !== false,
            dineInEnabled: data.dineInEnabled !== false,
            deliveryCodEnabled: data.deliveryCodEnabled !== false,
            deliveryOnlinePaymentEnabled: data.deliveryOnlinePaymentEnabled !== false,
            pickupOnlinePaymentEnabled: data.pickupOnlinePaymentEnabled !== false,
            pickupPodEnabled: data.pickupPodEnabled !== false,
            dineInOnlinePaymentEnabled: data.dineInOnlinePaymentEnabled !== false,
            dineInPayAtCounterEnabled: data.dineInPayAtCounterEnabled !== false,
            deliveryCharge: data.deliveryCharge || 0,
            deliveryFreeThreshold: data.deliveryFreeThreshold || null,
        };

        return NextResponse.json(publicSettings, {
            status: 200,
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' // CDN Cache: 1 minute
            }
        });

    } catch (error) {
        console.error('Error fetching public settings:', error);
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}
