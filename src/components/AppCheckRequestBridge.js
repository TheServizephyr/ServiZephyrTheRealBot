'use client';

import { useEffect } from 'react';
import { getApp } from 'firebase/app';
import { initializeAppCheck, getToken, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

// Lazy singleton — initialize once, reuse everywhere
let _appCheckInstance = null;
let _tokenPromise = null;
let _cachedToken = null;
let _cachedTokenExpiresAt = 0;

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
function getAppCheckInstance() {
    if (_appCheckInstance) return _appCheckInstance;
    const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
    if (!siteKey) return null;
    try {
        _appCheckInstance = initializeAppCheck(getApp(), {
            provider: new ReCaptchaEnterpriseProvider(siteKey),
            isTokenAutoRefreshEnabled: true
        });
        return _appCheckInstance;
    } catch (err) {
        // Already initialized (e.g. HMR in dev) — silently return null
        console.warn('[AppCheckRequestBridge] Init skipped:', err?.message);
        return null;
    }
}

function shouldAttachAppCheck(input, init = {}) {
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

    const method = String(
      init?.method ||
      (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      return false;
    }

    // Auth/session endpoints must never block on App Check token generation
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

async function getCachedAppCheckToken(appCheck) {
  const now = Date.now();
  if (_cachedToken && (_cachedTokenExpiresAt - now) > TOKEN_REFRESH_BUFFER_MS) {
    return _cachedToken;
  }

  if (_tokenPromise) {
    return _tokenPromise;
  }

  _tokenPromise = (async () => {
    const tokenResult = await Promise.race([
      getToken(appCheck, false),
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);

    if (tokenResult?.token) {
      _cachedToken = tokenResult.token;
      _cachedTokenExpiresAt = Number(tokenResult.expireTimeMillis) || (Date.now() + 5 * 60 * 1000);
      return _cachedToken;
    }

    return null;
  })();

  try {
    return await _tokenPromise;
  } finally {
    _tokenPromise = null;
  }
}

export default function AppCheckRequestBridge() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY) return undefined;
    if (window.__servizephyrAppCheckFetchPatched) return undefined;

    const originalFetch = window.fetch.bind(window);
    const appCheck = getAppCheckInstance();

    if (appCheck) {
      void getCachedAppCheckToken(appCheck).catch((error) => {
        console.warn('[AppCheckRequestBridge] Failed to prewarm App Check token:', error);
      });
    }

    window.fetch = async (input, init = {}) => {
      if (!shouldAttachAppCheck(input, init)) {
        return originalFetch(input, init);
      }

      try {
        if (!appCheck) return originalFetch(input, init);

        const token = await getCachedAppCheckToken(appCheck);
        if (token) {
          const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has('x-firebase-appcheck') && !headers.has('x-firebase-app-check')) {
            headers.set('x-firebase-appcheck', token);
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
