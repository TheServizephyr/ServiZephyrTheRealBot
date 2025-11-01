
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[DEBUG] /api/auth/check-role: Received a request.");
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const authHeader = req.headers.get('authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.error("[DEBUG] /api/auth/check-role: Authorization header missing or malformed.");
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        const token = authHeader.split('Bearer ')[1];
        
        console.log("[DEBUG] /api/auth/check-role: Verifying ID token...");
        const decodedToken = await auth.verifyIdToken(token);
        const uid = decodedToken.uid;
        console.log(`[DEBUG] /api/auth/check-role: Token verified for UID: ${uid}`);

        // 1. Check the 'users' collection first (for customers, owners, admins)
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore 'users' document fetched. Exists: ${userDoc.exists}`);

        if (userDoc.exists) {
            const userData = userDoc.data();
            console.log("[DEBUG] /api/auth/check-role: User document data:", userData);
            const role = userData.role;
            const businessType = userData.businessType || null;

            if (role === 'admin' && !decodedToken.isAdmin) {
                await auth.setCustomUserClaims(uid, { isAdmin: true });
                console.log(`[DEBUG] /api/auth/check-role: Custom claim 'isAdmin: true' set for UID: ${uid}.`);
            } else if (role !== 'admin' && decodedToken.isAdmin) {
                 await auth.setCustomUserClaims(uid, { isAdmin: null });
                 console.log(`[DEBUG] /api/auth/check-role: User is no longer admin, removing custom claim for UID: ${uid}.`);
            }

            if (role) {
                console.log(`[DEBUG] /api/auth/check-role: Role found in 'users': '${role}'. Returning 200.`);
                return NextResponse.json({ role, businessType }, { status: 200 });
            }
        }
        
        // --- START FIX: Check 'drivers' collection if not found in 'users' ---
        console.log(`[DEBUG] /api/auth/check-role: User not in 'users' or has no role. Checking 'drivers' collection.`);
        const driverRef = firestore.collection('drivers').doc(uid);
        const driverDoc = await driverRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore 'drivers' document fetched. Exists: ${driverDoc.exists}`);

        if (driverDoc.exists) {
            console.log(`[DEBUG] /api/auth/check-role: Role found in 'drivers': 'rider'. Returning 200.`);
            return NextResponse.json({ role: 'rider', businessType: null }, { status: 200 });
        }
        // --- END FIX ---


        // If the user document doesn't exist in either collection, they are a new user.
        console.log(`[DEBUG] /api/auth/check-role: User not found in any collection for UID: ${uid}. Returning 404.`);
        return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });

    } catch (error) {
        console.error('[DEBUG] /api/auth/check-role: CRITICAL ERROR:', error);
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        if (error.code === 'auth/argument-error' && error.message.includes('Firebase ID token has incorrect "aud" (audience) claim')) {
            return NextResponse.json({ message: `Critical Backend Mismatch: ${error.message}` }, { status: 500 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
