'use client';

import { useEffect } from 'react';
import { getApp } from 'firebase/app';
import { getAppCheck, getToken } from 'firebase/app-check';

function shouldAttachAppCheck(input) {
  if (typeof window === 'undefined') return false;
  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url || '';
  if (!rawUrl) return false;

  try {
    const url = rawUrl.startsWith('http') ? new URL(rawUrl) : new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return false;
    }

    // Auth/session endpoints must never block on App Check token generation,
    // otherwise mobile redirect login can get stuck on "Finishing login...".
    if (
      url.pathname.startsWith('/api/auth/check-role') ||
      url.pathname.startsWith('/api/auth/logout')
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export default function AppCheckRequestBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY) return undefined;
    if (window.__servizephyrAppCheckFetchPatched) return undefined;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init = {}) => {
      if (!shouldAttachAppCheck(input)) {
        return originalFetch(input, init);
      }

      try {
        const appCheck = getAppCheck(getApp());
        const tokenResult = await Promise.race([
          getToken(appCheck, false),
          new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (tokenResult?.token) {
          const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has('x-firebase-appcheck') && !headers.has('x-firebase-app-check')) {
            headers.set('x-firebase-appcheck', tokenResult.token);
          }
          return originalFetch(input, { ...init, headers });
        }
      } catch (error) {
        console.warn('[AppCheckRequestBridge] Failed to attach App Check token:', error);
      }

      return originalFetch(input, init);
    };

    window.__servizephyrAppCheckFetchPatched = true;

    return () => {
      window.fetch = originalFetch;
      window.__servizephyrAppCheckFetchPatched = false;
    };
  }, []);

  return null;
}
