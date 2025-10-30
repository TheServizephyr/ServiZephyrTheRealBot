

import admin from 'firebase-admin';

function getServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log("[firebase-admin] Initializing with FIREBASE_SERVICE_ACCOUNT_JSON from .env.local.");
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.error("[firebase-admin] CRITICAL: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON.", e);
      return null;
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    console.log("[firebase-admin] Initializing with Base64 encoded Vercel environment variable.");
    try {
      const decodedServiceAccount = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
      return JSON.parse(decodedServiceAccount);
    } catch (e) {
      console.error("[firebase-admin] CRITICAL: Failed to parse Base64 encoded service account.", e);
      return null;
    }
  }

  // Fallback for local development if the full JSON isn't provided.
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    console.warn("[firebase-admin] Using individual Firebase environment variables. Setting FIREBASE_SERVICE_ACCOUNT_JSON is the recommended method for local development.");
    return {
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
  }

  console.error("[firebase-admin] FATAL: No Firebase service account credentials found. Set FIREBASE_SERVICE_ACCOUNT_JSON or other required env variables.");
  return null;
}

function initializeAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = getServiceAccount();
    if (serviceAccount) {
      try {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log("[firebase-admin] Firebase Admin SDK initialized successfully.");
      } catch (error) {
        console.error("[firebase-admin] CRITICAL: Firebase Admin SDK initialization failed.", error);
      }
    }
  }
  return admin;
}

const adminInstance = initializeAdmin();

const getAuth = () => {
    if (!adminInstance.apps.length) {
        throw new Error("Firebase Admin SDK not initialized. Check your environment variables.");
    }
    return adminInstance.auth();
};

const getFirestore = () => {
    if (!adminInstance.apps.length) {
        throw new Error("Firebase Admin SDK not initialized. Check your environment variables.");
    }
    return adminInstance.firestore();
};

const FieldValue = admin.firestore.FieldValue;

export { getAuth, getFirestore, FieldValue };
