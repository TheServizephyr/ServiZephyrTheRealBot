'use client';

import { useEffect } from 'react';
import { isCustomerFlowPath, isLikelyInAppBrowser, isIosSafariLike } from '@/lib/browser/customerFlowSafeMode';

/**
 * Global Haptic Feedback Handler
 * 
 * Adds subtle vibration feedback to important interactive elements.
 * Designed to be subtle and non-intrusive.
 */
export default function GlobalHapticHandler() {
    useEffect(() => {
        // Check if vibration is supported
        if (typeof navigator === 'undefined' || !navigator.vibrate) {
            return;
        }

        const pathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
        const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
        const isPublicCustomerFlow = isCustomerFlowPath(pathname);
        const disableHaptics = isPublicCustomerFlow || isLikelyInAppBrowser(userAgent) || isIosSafariLike(userAgent);
        if (disableHaptics) {
            return;
        }

        const handleClick = (e) => {
            const target = e.target;

            // Only vibrate on important interactive elements - NOT everything
            // This prevents excessive vibration that feels annoying
            const isButton = target.closest('button, input[type="button"], input[type="submit"]');
            const isImportantLink = target.closest('a[role="button"], [role="button"]');

            // Only these important elements get haptic feedback
            if (isButton || isImportantLink) {
                // Very subtle vibration - 5ms is barely noticeable but still provides feedback
                navigator.vibrate(5);
            }
        };

        document.addEventListener('click', handleClick, { capture: true, passive: true });

        return () => {
            document.removeEventListener('click', handleClick, { capture: true });
        };
    }, []);

    return null;
}
