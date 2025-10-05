
import admin from 'firebase-admin';

// This is a placeholder for the service account key. 
// In a real production app, this would be handled by environment variables.
// For Firebase App Hosting, this setup works because it automatically provides credentials.
function getServiceAccount() {
  // VERCEL DEPLOYMENT LOGIC: Read from environment variables
  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    console.log("Found Vercel environment variables for Firebase Admin.");
    return {
      "type": "service_account",
      "project_id": "studio-6552995429-8bffe",
      "private_key_id": "d135b90208c5c76c125d56221c97b819f390ec96",
      "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      "client_email": process.env.FIREBASE_CLIENT_EMAIL,
      "client_id": "116524443994344445839",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
      "client_x509_cert_url": `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL.replace('@', '%40')}`
    };
  }

  // LOCAL DEVELOPMENT LOGIC: Fallback to local file
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
    if (serviceAccount) {
      console.log("Initializing Firebase Admin with provided service account.");
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'studio-6552995429-8bffe',
      });
    } else {
      console.log("Attempting to initialize Firebase Admin automatically (App Hosting/GCP).");
      app = admin.initializeApp();
    }
  } catch (error) {
     console.error("CRITICAL: Firebase Admin SDK initialization failed.", error);
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
