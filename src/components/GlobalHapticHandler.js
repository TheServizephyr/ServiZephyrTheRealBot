'use client';

import { useEffect } from 'react';

/**
 * Global Haptic Feedback Handler
 * 
 * Adds subtle vibration feedback to ALL clickable elements across the entire app.
 * This works regardless of whether the element uses Button component or not.
 * 
 * Targets: buttons, links, elements with onClick, elements with role="button"
 */
export default function GlobalHapticHandler() {
    useEffect(() => {
        // Check if vibration is supported
        if (typeof navigator === 'undefined' || !navigator.vibrate) {
            console.log('[Haptic] Vibration API not supported on this device');
            return;
        }

        console.log('[Haptic] Global haptic handler initialized');

        const handleClick = (e) => {
            const target = e.target;

            // Check if clicked element or its parent is an interactive element
            const interactiveElement = target.closest('button, a, [role="button"], [onclick], .clickable, input[type="button"], input[type="submit"]');

            // Also check for common interactive class names
            const hasInteractiveClass = target.closest('[class*="btn"], [class*="button"], [class*="click"]');

            // Check if the element or parent has cursor pointer (indicates clickable)
            const computedStyle = window.getComputedStyle(target);
            const hasCursorPointer = computedStyle.cursor === 'pointer';

            if (interactiveElement || hasInteractiveClass || hasCursorPointer) {
                // Trigger subtle vibration (10ms)
                navigator.vibrate(10);
            }
        };

        // Use capture phase to catch all clicks before they're handled
        document.addEventListener('click', handleClick, { capture: true, passive: true });

        return () => {
            document.removeEventListener('click', handleClick, { capture: true });
        };
    }, []);

    return null;
}
