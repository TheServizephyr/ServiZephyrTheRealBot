

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { calculateDeliveryChargeForBusiness } from '@/services/delivery/deliveryCharge.service';

export const dynamic = 'force-dynamic';

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function hasValidCustomerLocation(lat, lng) {
    return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

async function fetchCollection(firestore, collectionName, customerLocation) {
    const snapshot = await firestore.collection(collectionName).where('approvalStatus', '==', 'approved').get();

    const locations = await Promise.all(snapshot.docs.map(async (doc) => {
        const data = doc.data();
        if (data.address && data.address.latitude && data.address.longitude) {
            const businessTypeRaw = data.businessType || collectionName.slice(0, -1);
            const businessType = businessTypeRaw === 'shop' ? 'store' : businessTypeRaw;

            let deliveryResult = null;
            let deliverySettings = {};
            try {
                const deliveryConfigSnap = await doc.ref.collection('delivery_settings').doc('config').get();
                const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
                ({ result: deliveryResult, settings: deliverySettings } = calculateDeliveryChargeForBusiness({
                    businessData: data,
                    businessType,
                    deliveryConfig,
                    addressLat: customerLocation.lat,
                    addressLng: customerLocation.lng,
                    subtotal: 0,
                }));
            } catch (error) {
                console.warn(`[public locations] Skipping ${doc.id}:`, error?.message || error);
                return null;
            }

            if (!deliveryResult?.allowed) {
                return null;
            }

            const deliveryRadius = toFiniteNumber(deliverySettings.deliveryRadius) ??
                toFiniteNumber(data.deliveryRadius);

            return {
                id: doc.id,
                name: data.name || 'Unnamed Business',
                businessType,
                lat: data.address.latitude,
                lng: data.address.longitude,
                address: `${data.address.street}, ${data.address.city}`,
                deliveryRadius,
                distanceKm: deliveryResult.roadDistance,
                aerialDistanceKm: deliveryResult.aerialDistance,
                roadDistanceFactor: deliveryResult.roadFactor,
            };
        }
        return null;
    }));

    return locations.filter(Boolean); // Filter out any null entries
}

export async function GET(req) {
    try {
        const firestore = await getFirestore();
        const { searchParams } = new URL(req.url);
        const customerLat = toFiniteNumber(searchParams.get('lat'));
        const customerLng = toFiniteNumber(searchParams.get('lng'));

        if (!hasValidCustomerLocation(customerLat, customerLng)) {
            return NextResponse.json({
                locations: [],
                requiresLocation: true,
                message: 'Customer location is required to show restaurants in delivery range.',
            }, { status: 200 });
        }

        const customerLocation = { lat: customerLat, lng: customerLng };
        
        const [restaurants, shops] = await Promise.all([
            fetchCollection(firestore, 'restaurants', customerLocation),
            fetchCollection(firestore, 'shops', customerLocation)
        ]);
        
        const allLocations = [...restaurants, ...shops];

        return NextResponse.json({ locations: allLocations, requiresLocation: false }, { status: 200 });

    } catch (error) {
        console.error("GET /api/public/locations ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
