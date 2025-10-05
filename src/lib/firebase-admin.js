
import admin from 'firebase-admin';

// This function now builds the service account object directly from Vercel's environment variables.
function getServiceAccount() {
  // This logic is now PRIMARY. It will run on Vercel.
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    console.log("[firebase-admin] Initializing with Vercel environment variables.");
    return {
      projectId: process.env.FIREBASE_PROJECT_ID || 'studio-6552995429-8bffe',
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
  }

  // Fallback for local development or other environments if needed.
  console.warn("[firebase-admin] Vercel environment variables not found. The app may not initialize correctly in production.");
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
  } else {
      // This path is taken if the env vars are not set.
      // The error "Firebase Admin SDK not initialized" will be thrown by getAuth/getFirestore.
      console.error("[firebase-admin] FATAL: Service account credentials not found. Cannot initialize Firebase Admin SDK.");
  }
}

const getAuth = () => {
    if (!admin.apps.length || !admin.app()) {
        throw new Error("Firebase Admin SDK not initialized.");
    }
    return admin.auth();
};

const getFirestore = () => {
    if (!admin.apps.length || !admin.app()) {
        throw new Error("Firebase Admin SDK not initialized.");
    }
    return admin.firestore();
};

export { getAuth, getFirestore };
