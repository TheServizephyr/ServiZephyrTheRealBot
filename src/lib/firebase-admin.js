
import admin from 'firebase-admin';

// Load environment variables from .env file for local development
require('dotenv').config();

function getServiceAccount() {
  // Primary Method: Use Base64 encoded service account from Vercel environment variables.
  // This is the most robust method and avoids parsing issues with private keys.
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

  // Fallback Method: For local development or if the Base64 variable is not set.
  // This will construct the object from individual keys.
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    console.warn("[firebase-admin] Using individual Firebase environment variables. Base64 method is recommended for production.");
    return {
      projectId: process.env.FIREBASE_PROJECT_ID || 'studio-6552995429-8bffe',
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
  }

  console.error("[firebase-admin] FATAL: No Firebase service account credentials found. Set FIREBASE_SERVICE_ACCOUNT_BASE64 env variable.");
  return null;
}

// Initialize Firebase Admin SDK
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

const getAuth = () => {
    if (!admin.apps.length || !admin.app()) {
        throw new Error("Firebase Admin SDK not initialized. Check your environment variables.");
    }
    return admin.auth();
};

const getFirestore = () => {
    if (!admin.apps.length || !admin.app()) {
        throw new Error("Firebase Admin SDK not initialized. Check your environment variables.");
    }
    return admin.firestore();
};

export { getAuth, getFirestore };
