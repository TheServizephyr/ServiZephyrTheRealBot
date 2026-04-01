'use client';

import { auth } from '@/lib/firebase';

function readCachedAccessToken(user) {
  if (!user) return '';
  return String(
    user?.stsTokenManager?.accessToken ||
    user?.accessToken ||
    ''
  ).trim();
}

export function getCachedAccessToken(user = auth.currentUser) {
  return readCachedAccessToken(user);
}

export async function getBestEffortIdToken(user = auth.currentUser, options = {}) {
  const {
    timeoutMs = 0,
  } = options || {};

  if (!user) {
    throw new Error('Authentication required.');
  }

  const fallbackToken = readCachedAccessToken(user);

  try {
    const tokenPromise = user.getIdToken();

    if (timeoutMs > 0) {
      let timeoutId = null;
      return await Promise.race([
        tokenPromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('id token timeout')), timeoutMs);
        }),
      ]).finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
    }

    return await tokenPromise;
  } catch (error) {
    if (fallbackToken) {
      console.warn('[auth] Falling back to cached access token:', error?.message || error);
      return fallbackToken;
    }
    throw error;
  }
}

export async function clearServerSessionCookies() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch (error) {
    console.error('[logout] Failed to clear server session cookies:', error);
  }
}

export async function logoutClientSession({ redirectTo = '/' } = {}) {
  try {
    await clearServerSessionCookies();
  } finally {
    try {
      await auth.signOut();
    } catch (error) {
      console.error('[logout] Firebase signOut failed:', error);
    }
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = redirectTo;
  }
}
