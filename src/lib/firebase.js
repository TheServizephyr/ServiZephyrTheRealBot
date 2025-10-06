
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// Your web app's Firebase configuration
const firebaseConfig = {
  "projectId": "studio-6552995429-8bffe",
  "appId": "1:901130035292:web:6986494d18fbe805c5c699",
  "apiKey": "AIzaSyBDf2QxMRQgS3KGI6iRMZFBg5iFfZ4uK3g",
  "authDomain": "studio-6552995429-8bffe.firebaseapp.com",
  "measurementId": "",
  "messagingSenderId": "901130035292"
};


// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize App Check to prevent "Domain not authorized" errors on the live site.
if (typeof window !== 'undefined') {
  try {
    // This key is public and safe to expose.
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('6Ld-pB8pAAAAAN5yA_2gE1F5QE4F_e4a0B6a_2e7'), 
      isTokenAutoRefreshEnabled: true
    });
    console.log("Firebase App Check initialized successfully.");
  } catch (error) {
    console.warn("Firebase App Check initialization failed. This can happen in some environments and might be expected.", error);
  }
}

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

export { app, auth, googleProvider, db };
