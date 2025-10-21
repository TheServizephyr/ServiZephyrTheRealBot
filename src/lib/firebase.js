
// This file is now a bridge to the centralized Firebase initialization.
// It ensures that any component importing from 'lib/firebase' gets the
// same, correctly initialized instances.

import { initializeFirebase } from '@/firebase';
import { GoogleAuthProvider } from 'firebase/auth';

const { auth, firestore: db } = initializeFirebase();
const googleProvider = new GoogleAuthProvider();
const app = initializeFirebase().firebaseApp;


export { app, auth, googleProvider, db };
