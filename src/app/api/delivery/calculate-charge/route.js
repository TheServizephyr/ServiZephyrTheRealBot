/**
 * DELIVERY CHARGE CALCULATION API
 * Calculate delivery charge and validate delivery distance
 */

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { calculateHaversineDistance, calculateDeliveryCharge } from '@/lib/distance';

export async function POST(req) {
    try {
        const body = await req.json();
        const { restaurantId, addressLat, addressLng, subtotal } = body;
        const subtotalNum = parseFloat(subtotal) || 0;

        if (!restaurantId || !addressLat || !addressLng || subtotal === undefined) {
            return NextResponse.json(
                { error: 'Missing required fields: restaurantId, addressLat, addressLng, subtotal' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        const restaurantSnap = await restaurantRef.get();

        if (!restaurantSnap.exists) {
            return NextResponse.json(
                { error: 'Restaurant not found' },
                { status: 404 }
            );
        }

        const restaurantData = restaurantSnap.data();

        // ✅ FIXED: Support all possible coordinate field structures
        // Priority: coordinates.lat/lng → address.latitude/longitude → businessAddress.latitude/longitude
        const restaurantLat = restaurantData.coordinates?.lat || restaurantData.address?.latitude || restaurantData.businessAddress?.latitude;
        const restaurantLng = restaurantData.coordinates?.lng || restaurantData.address?.longitude || restaurantData.businessAddress?.longitude;

        console.log('[API /delivery/calculate-charge] 📍 Restaurant:', { lat: restaurantLat, lng: restaurantLng });
        console.log('[API /delivery/calculate-charge] 📍 Customer:', { lat: addressLat, lng: addressLng });

        if (!restaurantLat || !restaurantLng) {
            console.error('[API /delivery/calculate-charge] ❌ Restaurant coordinates not found');
            return NextResponse.json(
                { error: 'Restaurant coordinates not configured' },
                { status: 400 }
            );
        }

        // Calculate aerial distance
        const aerialDistance = calculateHaversineDistance(
            restaurantLat,
            restaurantLng,
            addressLat,
            addressLng
        );

        // ✅ CRITICAL: Read delivery settings from subcollection (where owner dashboard saves them)
        const deliveryConfigSnap = await restaurantRef.collection('delivery_settings').doc('config').get();
        const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};

        console.log('[API /delivery/calculate-charge] 📋 Delivery Config from subcollection:', deliveryConfig);

        // Fallback helper: subcollection → restaurant doc → default
        const getSetting = (key, defaultVal) => deliveryConfig[key] ?? restaurantData[key] ?? defaultVal;

        // Get delivery settings - use migrated field names with subcollection priority
        const settings = {
            deliveryRadius: getSetting('deliveryRadius', 10),
            deliveryChargeType: getSetting('deliveryFeeType', getSetting('deliveryChargeType', 'fixed')),
            fixedCharge: getSetting('deliveryFixedFee', getSetting('fixedCharge', 0)),
            perKmCharge: getSetting('deliveryPerKmFee', getSetting('perKmCharge', 0)),
            freeDeliveryThreshold: getSetting('deliveryFreeThreshold', getSetting('freeDeliveryThreshold', 0)),
            freeDeliveryRadius: getSetting('freeDeliveryRadius', 0),
            freeDeliveryMinOrder: getSetting('freeDeliveryMinOrder', 0),
            roadDistanceFactor: getSetting('roadDistanceFactor', 1.3), // default 1.3 (road ~30% longer)
            deliveryTiers: getSetting('deliveryTiers', []),
        };

        console.log('[API /delivery/calculate-charge] ⚙️ Final Settings:', settings);

        // Calculate delivery charge and validate
        const result = calculateDeliveryCharge(aerialDistance, subtotalNum, settings);

        return NextResponse.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('[Delivery Charge Calculation Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to calculate delivery charge' },
            { status: 500 }
        );
    }
}
