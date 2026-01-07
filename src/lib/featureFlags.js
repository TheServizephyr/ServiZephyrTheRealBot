/**
 * ServiZephyr Feature Flags
 * 
 * Centralized feature flag management for safe rollouts and A/B testing.
 * All flags default to FALSE for production safety.
 */

export const FEATURE_FLAGS = {
    /**
     * Phase 5 Step 1: Service Layer for Order Create
     * 
     * When TRUE: Uses new orderService.createOrderV2()
     * When FALSE: Uses legacy inline implementation
     * 
     * Status: IN DEVELOPMENT
     * Default: FALSE (safe fallback to legacy)
     * Rollout: Will enable after full V2 implementation + testing
     */
    USE_NEW_ORDER_SERVICE: process.env.NEXT_PUBLIC_USE_NEW_ORDER_SERVICE === 'true',
};
