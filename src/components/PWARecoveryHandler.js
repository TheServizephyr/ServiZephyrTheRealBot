'use client';

import { useEffect } from 'react';

/**
 * PWA Background Recovery Handler
 * 
 * Mobile browsers aggressively suspend PWA tabs when in background.
 * When user returns, the JavaScript context might be broken, causing blank screens.
 * 
 * This component detects when user returns to the app and checks if the page is responsive.
 * If it appears frozen, it forces a reload to recover gracefully.
 */
export default function PWARecoveryHandler() {
    useEffect(() => {
        let lastHiddenTime = 0;
        const MAX_BACKGROUND_TIME = 5 * 60 * 1000; // 5 minutes

        const handleVisibilityChange = () => {
            if (document.hidden) {
                // App going to background - save timestamp
                lastHiddenTime = Date.now();
                console.log('[PWA Recovery] App going to background');
            } else {
                // App coming back to foreground
                const timeInBackground = Date.now() - lastHiddenTime;
                console.log('[PWA Recovery] App returning from background after', Math.round(timeInBackground / 1000), 'seconds');

                // If app was in background for more than 5 minutes, check if page is responsive
                if (lastHiddenTime > 0 && timeInBackground > MAX_BACKGROUND_TIME) {
                    console.log('[PWA Recovery] Long background time detected, checking page health...');

                    // Give the page a moment to respond after coming to foreground
                    setTimeout(() => {
                        // Check if React has rendered (a basic health check)
                        const rootElement = document.getElementById('__next') || document.body.firstElementChild;
                        const hasContent = rootElement && rootElement.children.length > 0;

                        if (!hasContent) {
                            console.log('[PWA Recovery] Page appears frozen, reloading...');
                            window.location.reload();
                        } else {
                            console.log('[PWA Recovery] Page appears healthy');
                        }
                    }, 1000);
                }
            }
        };

        // Handle page freeze/resume events (modern browsers)
        const handleFreeze = () => {
            console.log('[PWA Recovery] Page freeze event detected');
            lastHiddenTime = Date.now();
        };

        const handleResume = () => {
            console.log('[PWA Recovery] Page resume event detected');
            const timeInBackground = Date.now() - lastHiddenTime;

            if (timeInBackground > MAX_BACKGROUND_TIME) {
                console.log('[PWA Recovery] Resuming after long freeze, reloading...');
                window.location.reload();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('freeze', handleFreeze);
        document.addEventListener('resume', handleResume);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            document.removeEventListener('freeze', handleFreeze);
            document.removeEventListener('resume', handleResume);
        };
    }, []);

    return null;
}
