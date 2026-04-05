/**
 * ORDER CREATE API ROUTE (THIN CONTROLLER)
 * 
 * Phase 5 Step 1: Converted to thin controller with feature flag.
 * 
 * This file now only routes requests to V1 (legacy) or V2 (service layer).
 * All business logic moved to respective implementations.
 * 
 * Feature Flag: NEXT_PUBLIC_USE_NEW_ORDER_SERVICE
 *   - false (default): Uses legacy V1 implementation
 *   - true: Uses new V2 service layer (NOT YET READY)
 */

import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { createOrderV1 } from './legacy/createOrderV1_LEGACY';
import { createOrderV2 } from '@/services/orderService';
import { normalizeFlow, trackApiTelemetry, trackFunnelEvent } from '@/lib/opsTelemetry';
import { trackEndpointRead, trackEndpointWrite } from '@/lib/readTelemetry';
import { findBusinessById } from '@/services/business/businessService';
import { getFirestore } from '@/lib/firebase-admin';
import { queueDashboardStatsRefresh } from '@/lib/server/dashboardStats';
import { enforceRateLimit } from '@/lib/public-auth';

// Allow up to 30s for order creation (8+ Firestore ops + payment gateway)
export const maxDuration = 30;

async function touchDerivedOrderState(restaurantId) {
    const safeRestaurantId = String(restaurantId || '').trim();
    if (!safeRestaurantId) return;

    try {
        const firestore = await getFirestore();
        const business = await findBusinessById(firestore, safeRestaurantId, {
            includeDeliverySettings: false,
        });
        if (!business?.ref) return;

        await queueDashboardStatsRefresh({
            businessRef: business.ref,
            businessId: safeRestaurantId,
            collectionName: business.collection,
            reason: 'order_created',
            bumpStatsVersion: true,
            bumpActiveOrderVersion: true,
        });
    } catch (error) {
        console.warn('[Order Create API] Failed to queue derived-state refresh:', error?.message || error);
    }
}

export async function POST(req) {
    const startedAt = Date.now();
    let flow = 'other';
    let statusCode = 200;
    let errorMessage = null;
    let isAddonOrder = false;
    let restaurantId = '';
    let itemCount = 0;
    let paymentMethod = '';

    try {
        // --- Rate limiting: 10 orders per IP per minute ---
        const clientIp = (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
        const firestore = await getFirestore();
        const rate = await enforceRateLimit(firestore, {
            key: `order-create:${clientIp}`,
            limit: 10,
            windowSec: 60,
            req,
            auditContext: 'order_create',
        });
        if (!rate.allowed) {
            return NextResponse.json({ message: 'Too many order requests. Please wait a moment.' }, { status: 429 });
        }

        // Clone body once so business handler can still read original request stream.
        try {
            const body = await req.clone().json();
            flow = normalizeFlow(body?.deliveryType);
            isAddonOrder = !!body?.existingOrderId;
            restaurantId = String(body?.restaurantId || body?.shopId || '').trim().slice(0, 80);
            itemCount = Array.isArray(body?.items) ? body.items.length : 0;
            paymentMethod = String(body?.paymentMethod || '').trim().toLowerCase();
        } catch {
            flow = 'other';
            isAddonOrder = false;
            restaurantId = '';
            itemCount = 0;
            paymentMethod = '';
        }

        void trackFunnelEvent('order_create_attempt', flow);

        if (FEATURE_FLAGS.USE_NEW_ORDER_SERVICE) {
            console.log('[Order Create API] 🆕 Using V2 (Service Layer)');
            const response = await createOrderV2(req);
            statusCode = response?.status || 200;
            if (statusCode >= 400) {
                void trackFunnelEvent('order_create_failed', flow);
            } else {
                const estimatedWrites = Math.max(1, (isAddonOrder ? 2 : 3) + ((flow === 'dine-in' || flow === 'car-order') ? 1 : 0));
                const estimatedReads = Math.max(
                    1,
                    (isAddonOrder ? 3 : 5) +
                    Math.max(1, itemCount) +
                    ((flow === 'dine-in' || flow === 'car-order') ? 1 : 0) +
                    ((paymentMethod === 'online' || paymentMethod === 'razorpay' || paymentMethod === 'phonepe') ? 1 : 0)
                );
                await Promise.allSettled([
                    trackEndpointWrite('api.order.create', estimatedWrites),
                    trackEndpointRead('api.order.create', estimatedReads),
                ]);
                if (process.env.NODE_ENV !== 'production') {
                    console.log(
                        `[Order Create API] Telemetry tracked (V2): reads=${estimatedReads}, writes=${estimatedWrites}, flow=${flow}, addon=${isAddonOrder}`
                    );
                }
                void trackFunnelEvent('order_create_success', flow);
                await touchDerivedOrderState(restaurantId);
            }
            console.log(`[Order Create API] ✅ V2 completed in ${Date.now() - startedAt}ms`);
            return response;
        }

        console.log('[Order Create API] 📦 Using V1 (Legacy Implementation)');
        const response = await createOrderV1(req);
        statusCode = response?.status || 200;
        if (statusCode >= 400) {
            void trackFunnelEvent('order_create_failed', flow);
        } else {
            const estimatedWrites = Math.max(1, (isAddonOrder ? 2 : 3) + ((flow === 'dine-in' || flow === 'car-order') ? 1 : 0));
            const estimatedReads = Math.max(
                1,
                (isAddonOrder ? 3 : 5) +
                Math.max(1, itemCount) +
                ((flow === 'dine-in' || flow === 'car-order') ? 1 : 0) +
                ((paymentMethod === 'online' || paymentMethod === 'razorpay' || paymentMethod === 'phonepe') ? 1 : 0)
            );
            await Promise.allSettled([
                trackEndpointWrite('api.order.create', estimatedWrites),
                trackEndpointRead('api.order.create', estimatedReads),
            ]);
            if (process.env.NODE_ENV !== 'production') {
                console.log(
                    `[Order Create API] Telemetry tracked (V1): reads=${estimatedReads}, writes=${estimatedWrites}, flow=${flow}, addon=${isAddonOrder}`
                );
            }
            void trackFunnelEvent('order_create_success', flow);
            await touchDerivedOrderState(restaurantId);
        }
        console.log(`[Order Create API] ✅ V1 completed in ${Date.now() - startedAt}ms`);
        return response;
    } catch (error) {
        statusCode = error?.status || 500;
        errorMessage = error?.message || 'Order creation failed';
        void trackFunnelEvent('order_create_failed', flow);
        throw error;
    } finally {
        void trackApiTelemetry({
            endpoint: 'api.order.create',
            durationMs: Date.now() - startedAt,
            statusCode,
            errorMessage,
            context: {
                flow,
                isAddonOrder,
                restaurantId: restaurantId || null,
                implementation: FEATURE_FLAGS.USE_NEW_ORDER_SERVICE ? 'v2' : 'v1',
            },
        });
    }
}
