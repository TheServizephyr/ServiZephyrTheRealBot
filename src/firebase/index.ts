'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getDatabase } from 'firebase/database'; // ✅ RTDB for real-time tracking

function getAppCheckInitAttempted() {
  if (typeof globalThis === 'undefined') return false;
  return Boolean(globalThis.__servizephyrAppCheckInitAttempted);
}

function setAppCheckInitAttempted(value: boolean) {
  if (typeof globalThis === 'undefined') return;
  globalThis.__servizephyrAppCheckInitAttempted = value;
}

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (!getApps().length) {
    const firebaseApp = initializeApp(firebaseConfig);
    return getSdks(firebaseApp);
  }

  // If already initialized, return the SDKs with the already initialized App
  return getSdks(getApp());
}

export function getSdks(firebaseApp: FirebaseApp) {
  const auth = getAuth(firebaseApp);
  const appCheckSiteKey =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY
      : undefined;

  // CRITICAL: Set persistence immediately (non-blocking)
  // This MUST execute for redirect flow to work
  setPersistence(auth, browserLocalPersistence)
    .then(() => {
      console.log('[Firebase] ✓ Auth persistence configured: LOCAL');
    })
    .catch((error) => {
      console.error('[Firebase] ✗ Failed to set persistence:', error);
    });

  if (!getAppCheckInitAttempted() && appCheckSiteKey) {
    setAppCheckInitAttempted(true);
    try {
      initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaV3Provider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      console.log('[Firebase] ✓ App Check configured');
    } catch (error) {
      setAppCheckInitAttempted(false);
      console.error('[Firebase] ✗ Failed to initialize App Check:', error);
    }
  }

  return {
    firebaseApp,
    auth,
    firestore: getFirestore(firebaseApp),
    storage: getStorage(firebaseApp),
    rtdb: getDatabase(firebaseApp) // ✅ RTDB for tracking
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
