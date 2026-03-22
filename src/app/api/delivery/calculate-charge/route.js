/**
 * DELIVERY CHARGE CALCULATION API
 * Calculate delivery charge and validate delivery distance
 */

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { calculateDeliveryChargeForAddress } from '@/services/delivery/deliveryCharge.service';

export async function POST(req) {
    try {
        const body = await req.json();
        const firestore = await getFirestore();
        const result = await calculateDeliveryChargeForAddress(firestore, body || {});
        return NextResponse.json(result.payload, { status: result.status });

    } catch (error) {
        console.error('[Delivery Charge Calculation Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to calculate delivery charge' },
            { status: 500 }
        );
    }
}
