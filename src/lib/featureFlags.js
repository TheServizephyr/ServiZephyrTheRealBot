/**
 * ServiZephyr Feature Flags
 * 
 * Centralized feature flag management for safe rollouts and A/B testing.
 * All flags default to FALSE for production safety.
 */

export const FEATURE_FLAGS = {
    /**
     * Phase 5 Step 1-2: Service Layer for Order Create
     * 
     * When TRUE: Uses new orderService.createOrderV2()
     * When FALSE: Uses legacy inline implementation
     * 
     * Status: READY (COD tested)
     * Default: FALSE (gradual rollout)
     */
    USE_NEW_ORDER_SERVICE: process.env.NEXT_PUBLIC_USE_NEW_ORDER_SERVICE === 'true',

    /**
     * Phase 5 Stage 3: Online Payments in V2
     * 
     * When TRUE: V2 handles online payments (Razorpay/PhonePe)
     * When FALSE: V2 falls back to V1 for online payments
     * 
     * Status: IN DEVELOPMENT
     * Default: FALSE (safe fallback to V1)
     * 
     * Hybrid Strategy:
     * - COD/Counter → V2 (already working)
     * - Online → V1 fallback (until this flag enabled)
     */
    USE_V2_ONLINE_PAYMENT: process.env.NEXT_PUBLIC_USE_V2_ONLINE_PAYMENT === 'true',

    /**
     * Phase 2: New Dine-In Endpoints (Subcollection Migration)
     * 
     * When TRUE: Uses new /api/owner/dinein-tabs/* endpoints  
     * When FALSE: Uses legacy /api/dinein/* endpoints
     * 
     * Status: STABLE ✅ (Tested and deployed)
     * Default: TRUE (new endpoints active)
     * 
     * New Architecture Benefits:
     * - Atomic tab creation with transactions
     * - Payment locking during processing
     * - Source of truth recalculation
     * - Integrity verification
     * - Token-based security
     * 
     * Endpoints:
     * - /api/owner/dinein-tabs/create
     * - /api/owner/dinein-tabs/join
     * - /api/owner/dinein-tabs/settle
     * - /api/owner/dinein-tabs/cleanup
     */
    USE_NEW_DINEIN_ENDPOINTS: process.env.NEXT_PUBLIC_USE_NEW_DINEIN_ENDPOINTS !== 'false', // Default TRUE

    /**
     * Phase 6: Public bootstrap API for order/checkout first load
     *
     * When TRUE: client runtime fetchers prefer /api/public/bootstrap/[restaurantId]
     * When FALSE: legacy menu/settings/customer/order waterfall remains active
     */
    USE_PUBLIC_BOOTSTRAP:
        process.env.NEXT_PUBLIC_USE_PUBLIC_BOOTSTRAP === 'true' ||
        process.env.USE_PUBLIC_BOOTSTRAP === 'true',

    /**
     * Phase 6: Menu snapshot derived document
     *
     * When TRUE: public menu/bootstrap may serve from menu_snapshot/current
     * When FALSE: legacy raw menu collection fan-out remains active
     */
    USE_MENU_SNAPSHOT:
        process.env.NEXT_PUBLIC_USE_MENU_SNAPSHOT === 'true' ||
        process.env.USE_MENU_SNAPSHOT === 'true',

    /**
     * Phase 6: Owner dashboard stats derived document
     *
     * When TRUE: owner dashboard-data may serve from dashboard_stats/current
     * When FALSE: route computes directly from raw collections
     */
    USE_DASHBOARD_STATS:
        process.env.NEXT_PUBLIC_USE_DASHBOARD_STATS === 'true' ||
        process.env.USE_DASHBOARD_STATS === 'true',

    /**
     * Phase 6: Cron-driven stats reconciliation
     *
     * When TRUE: cron processor can reconcile dashboard_stats/current
     */
    USE_DASHBOARD_STATS_RECONCILE:
        process.env.NEXT_PUBLIC_USE_DASHBOARD_STATS_RECONCILE === 'true' ||
        process.env.USE_DASHBOARD_STATS_RECONCILE === 'true',

    /**
     * Phase 6: Cross-tab primary live session behavior
     *
     * Placeholder server/client gate for future owner live-session dedupe.
     */
    USE_CROSS_TAB_LIVE_LEADER:
        process.env.NEXT_PUBLIC_USE_CROSS_TAB_LIVE_LEADER === 'true' ||
        process.env.USE_CROSS_TAB_LIVE_LEADER === 'true',
};

export function isEnabledFeatureFlag(flagName) {
    return FEATURE_FLAGS?.[flagName] === true;
}
