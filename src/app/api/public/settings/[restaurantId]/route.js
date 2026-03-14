import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import { findBusinessById } from '@/services/business/businessService';

export const dynamic = 'force-dynamic';

function normalizeGstCalculationMode(businessData = {}) {
    if (businessData?.gstCalculationMode) {
        const mode = String(businessData.gstCalculationMode).trim().toLowerCase();
        if (mode === 'excluded') return 'excluded';
        if (mode === 'included') return 'included';
    }
    if (businessData?.gstIncludedInPrice === false) return 'excluded';
    return 'included';
}

export async function GET(req, { params }) {
    try {
        const { restaurantId } = await params;

        if (!restaurantId) {
            return NextResponse.json({ error: 'Restaurant ID is required' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // ⚡ Read from the BUSINESS document (restaurants/shops/street_vendors)
        // This is where all settings (GST, charges, payment modes) are actually stored
        // ⚡ Parallel collection lookup (all 3 at once instead of sequential)
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        let businessDoc = null;

        const results = await Promise.all(
            collectionsToTry.map(async (collection) => {
                const snap = await firestore.collection(collection).doc(restaurantId).get();
                return snap.exists ? snap : null;
            })
        );
        businessDoc = results.find(snap => snap !== null) || null;

        // Fallback: try findBusinessById for URL-encoded or case-mismatched IDs
        if (!businessDoc?.exists) {
            const fallbackBusiness = await findBusinessById(firestore, restaurantId);
            if (fallbackBusiness?.ref) {
                businessDoc = await fallbackBusiness.ref.get();
            }
        }

        if (!businessDoc || !businessDoc.exists) {
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

        const data = businessDoc.data() || {};

        // Fetch delivery settings from sub-collection (same pattern as owner settings API)
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
        const fallback = (key, defaultVal) => deliveryConfig[key] ?? data[key] ?? defaultVal;
        const gstCalcMode = normalizeGstCalculationMode(data);

        const publicSettings = {
            // Order Type Toggles
            deliveryEnabled: fallback('deliveryEnabled', true),
            pickupEnabled: fallback('pickupEnabled', true),
            dineInEnabled: fallback('dineInEnabled', true),

            // Payment Method Toggles (per order type)
            deliveryCodEnabled: fallback('deliveryCodEnabled', true),
            deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
            pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
            pickupPodEnabled: fallback('pickupPodEnabled', true),
            dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
            dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),

            // Delivery Settings
            deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
            deliveryFreeThreshold: fallback('deliveryFreeThreshold', null),

            // GST Settings (stored in business document)
            gstEnabled: data.gstEnabled || false,
            gstRate: data.gstPercentage || data.gstRate || 0,
            gstPercentage: data.gstPercentage || data.gstRate || 0,
            gstMinAmount: data.gstMinAmount || 0,
            gstCalculationMode: gstCalcMode,
            gstIncludedInPrice: gstCalcMode === 'included',

            // Convenience Fee Settings
            convenienceFeeEnabled: data.convenienceFeeEnabled || false,
            convenienceFeeRate: data.convenienceFeeRate || 2.5,
            convenienceFeePaidBy: data.convenienceFeePaidBy || 'customer',
            convenienceFeeLabel: data.convenienceFeeLabel || 'Payment Processing Fee',

            // Packaging Charge Settings
            packagingChargeEnabled: data.packagingChargeEnabled || false,
            packagingChargeAmount: data.packagingChargeAmount || 0,

            // Service Fee Settings
            serviceFeeEnabled: data.serviceFeeEnabled || false,
            serviceFeeLabel: data.serviceFeeLabel || 'Additional Charge',
            serviceFeeType: data.serviceFeeType || 'fixed',
            serviceFeeValue: Number(data.serviceFeeValue) || 0,
            serviceFeeApplyOn: data.serviceFeeApplyOn || 'all',
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
