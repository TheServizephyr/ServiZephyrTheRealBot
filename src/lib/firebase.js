
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from 'firebase/firestore';


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

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

export { app, auth, googleProvider, db };
