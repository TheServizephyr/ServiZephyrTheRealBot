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

export async function POST(req) {
    const startedAt = Date.now();
    if (FEATURE_FLAGS.USE_NEW_ORDER_SERVICE) {
        console.log('[Order Create API] 🆕 Using V2 (Service Layer)');
        const response = await createOrderV2(req);
        console.log(`[Order Create API] ✅ V2 completed in ${Date.now() - startedAt}ms`);
        return response;
    }

    console.log('[Order Create API] 📦 Using V1 (Legacy Implementation)');
    const response = await createOrderV1(req);
    console.log(`[Order Create API] ✅ V1 completed in ${Date.now() - startedAt}ms`);
    return response;
}
