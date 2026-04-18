'use client';

import { useEffect } from 'react';
import { allowAnyScreenOrientation } from '@/lib/screenOrientation';

export default function ScreenOrientationHandler() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const applyOrientationPreference = () => {
      void allowAnyScreenOrientation();
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
