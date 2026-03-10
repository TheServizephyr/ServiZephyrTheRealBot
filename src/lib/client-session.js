'use client';

import { auth } from '@/lib/firebase';

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
