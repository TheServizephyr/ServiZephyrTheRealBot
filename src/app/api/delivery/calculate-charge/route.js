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
        const coordinates = restaurantData.coordinates || {};

        if (!coordinates.lat || !coordinates.lng) {
            return NextResponse.json(
                { error: 'Restaurant coordinates not configured' },
                { status: 400 }
            );
        }

        // Calculate aerial distance
        const aerialDistance = calculateHaversineDistance(
            coordinates.lat,
            coordinates.lng,
            addressLat,
            addressLng
        );

        // Get delivery settings
        const settings = {
            deliveryRadius: restaurantData.deliveryRadius || 10, // default 10km
            deliveryChargeType: restaurantData.deliveryChargeType || 'fixed',
            fixedCharge: restaurantData.fixedCharge || 0,
            perKmCharge: restaurantData.perKmCharge || 0,
            freeDeliveryThreshold: restaurantData.freeDeliveryThreshold || 0,
            freeDeliveryRadius: restaurantData.freeDeliveryRadius || 0,
            freeDeliveryMinOrder: restaurantData.freeDeliveryMinOrder || 0,
            roadDistanceFactor: restaurantData.roadDistanceFactor || 1.0, // optional, defaults to 1.0 (no adjustment)
        };

        // Calculate delivery charge and validate
        const result = calculateDeliveryCharge(aerialDistance, subtotal, settings);

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
