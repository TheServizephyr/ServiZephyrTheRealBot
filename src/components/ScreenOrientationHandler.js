'use client';

import { useEffect } from 'react';

const isStandaloneDisplayMode = () => {
  if (typeof window === 'undefined') return false;

  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator?.standalone ||
    String(document.referrer || '').startsWith('android-app://')
  );
};

export default function ScreenOrientationHandler() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const applyOrientationPreference = () => {
      const orientationApi = window.screen?.orientation;
      if (!orientationApi) return;

      if (typeof orientationApi.unlock === 'function') {
        try {
          orientationApi.unlock();
        } catch {
          // Ignore unsupported unlock failures.
        }
      }

      if (!isStandaloneDisplayMode() || typeof orientationApi.lock !== 'function') {
        return;
      }

      Promise.resolve(orientationApi.lock('any')).catch(() => {
        // Some browsers reject programmatic orientation changes outside
        // installed/fullscreen contexts. Best-effort only.
      });
    };

    applyOrientationPreference();
    window.addEventListener('orientationchange', applyOrientationPreference);
    window.addEventListener('resize', applyOrientationPreference);
    window.addEventListener('pageshow', applyOrientationPreference);

    return () => {
      window.removeEventListener('orientationchange', applyOrientationPreference);
      window.removeEventListener('resize', applyOrientationPreference);
      window.removeEventListener('pageshow', applyOrientationPreference);
    };
  }, []);

  return null;
}
