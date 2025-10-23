

import admin from 'firebase-admin';

function getServiceAccount() {
  // New Method (Primary for Local): Parse the full JSON string from .env.local
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log("[firebase-admin] Initializing with FIREBASE_SERVICE_ACCOUNT_JSON from .env.local.");
    try {
      // The variable is a string representation of a JSON object, so it needs to be parsed.
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.error("[firebase-admin] CRITICAL: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON.", e);
      return null;
    }
  }

  // Vercel Method: Use Base64 encoded service account from Vercel environment variables.
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

  // Old Fallback Method: For local development if the above are not set.
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    console.warn("[firebase-admin] Using individual Firebase environment variables. FIREBASE_SERVICE_ACCOUNT_JSON is recommended for local dev.");
    return {
      projectId: process.env.FIREBASE_PROJECT_ID || 'studio-6552995429-8bffe',
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
  }

  console.error("[firebase-admin] FATAL: No Firebase service account credentials found. Set FIREBASE_SERVICE_ACCOUNT_JSON or other required env variables.");
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

const FieldValue = admin.firestore.FieldValue;

export { getAuth, getFirestore, FieldValue };
