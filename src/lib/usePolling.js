import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for adaptive polling with visibility awareness and Activity backoff.
 * 
 * @param {Function} callback - The async function to call
 * @param {object} options - Configuration options
 * @param {number} options.interval - Base interval in ms (default: 15000)
 * @param {number} options.backoffFactor - Multiplier for hidden tab (default: 4)
 * @param {boolean} options.enabled - Whether polling is active
 * @param {Array} options.deps - Dependencies to restart polling
 */
export function usePolling(callback, {
    interval = 15000,
    backoffFactor = 4,
    enabled = true,
    deps = []
} = {}) {
    const savedCallback = useRef(callback);
    const refreshRef = useRef(() => Promise.resolve());

    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    useEffect(() => {
        let disposed = false;
        let timer = null;
        let inFlight = null;
        const runPolling = () => {
            if (disposed || !enabled) return Promise.resolve();
            if (inFlight) return inFlight;
            clearTimeout(timer);
            inFlight = Promise.resolve().then(() => {
                if (!disposed) return savedCallback.current();
            }).catch(error => {
                console.error('[usePolling] Callback failed:', error);
            }).finally(() => {
                inFlight = null;
                // An awaited request can finish after unmount or a scope change.
                // Never let that old effect resurrect its polling timer.
                if (disposed) return;
                const delay = document.visibilityState === 'visible' ? interval : interval * backoffFactor;
                timer = setTimeout(runPolling, delay);
            });
            return inFlight;
        };
        refreshRef.current = runPolling;
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void runPolling();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        if (enabled) {
            runPolling();
        }

        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearTimeout(timer);
            if (refreshRef.current === runPolling) refreshRef.current = () => Promise.resolve();
        };
        // Callers supply individual scope dependencies; their array identity is irrelevant.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, interval, backoffFactor, ...deps]);

    return {
        refresh: useCallback(() => refreshRef.current(), [])
    };
}
