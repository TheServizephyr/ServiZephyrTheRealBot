
import admin from 'firebase-admin';

// This is a placeholder for the service account key. 
// In a real production app, this would be handled by environment variables.
// For Firebase App Hosting, this setup works because it automatically provides credentials.
function getServiceAccount() {
  try {
    // This will only work in local development if the file exists.
    return require('./serviceAccountKey').serviceAccount;
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn("Could not find local serviceAccountKey.js. This is expected in production.");
    }
    return null; // Return null if not found, so production init can proceed.
  }
}

let app;

if (!admin.apps.length) {
  const serviceAccount = getServiceAccount();
  try {
    // This is the correct way for App Hosting. It uses the ADC (Application Default Credentials)
    // provided by the environment, so no config object is needed.
    app = admin.initializeApp();
    console.log("Firebase Admin SDK initialized automatically for PRODUCTION (App Hosting).");
  } catch (error) {
    console.warn("Automatic Admin SDK initialization failed. Error:", error.message);
    // This fallback is primarily for LOCAL development.
    if (serviceAccount) {
      console.log("Falling back to local service account key for DEVELOPMENT.");
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'studio-6552995429-8bffe',
      });
    } else {
       console.error("CRITICAL: Firebase Admin SDK initialization failed. No credentials found for production or development.");
    }
  }
} else {
  // If already initialized, get the existing app.
  app = admin.app();
}

const getAuth = () => {
    if (!app) {
        console.error("FATAL: getAuth() called but Firebase Admin SDK is not initialized.");
        throw new Error("Firebase Admin SDK not initialized.");
    }
    return admin.auth(app);
};

const getFirestore = () => {
    if (!app) {
        console.error("FATAL: getFirestore() called but Firebase Admin SDK is not initialized.");
        throw new Error("Firebase Admin SDK not initialized.");
    }
    return admin.firestore(app);
};

export { getAuth, getFirestore };
