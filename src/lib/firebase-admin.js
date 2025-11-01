

import admin from 'firebase-admin';

let adminInstance;

async function initializeAdmin() {
  if (admin.apps.length > 0) {
    return admin;
  }

  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    try {
      // Use await to ensure initialization completes
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("[firebase-admin] Firebase Admin SDK initialized successfully.");
      return admin;
    } catch (error) {
      console.error("[firebase-admin] CRITICAL: Firebase Admin SDK initialization failed.", error);
      // Re-throw or handle error appropriately in a server environment
      throw new Error("Firebase Admin SDK could not be initialized.");
    }
  }
  throw new Error("FATAL: No Firebase service account credentials found.");
}


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

const getAdminInstance = async () => {
    if (!adminInstance) {
        adminInstance = await initializeAdmin();
    }
    return adminInstance;
};

const getAuth = async () => {
    const adminSdk = await getAdminInstance();
    return adminSdk.auth();
};

const getFirestore = async () => {
    const adminSdk = await getAdminInstance();
    return adminSdk.firestore();
};

const FieldValue = admin.firestore.FieldValue;

export { getAuth, getFirestore, FieldValue };
