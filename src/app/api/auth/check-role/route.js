
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

        // Check the single 'users' collection for the user's role
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore document fetched for UID: ${uid}. Exists: ${userDoc.exists}`);

        if (userDoc.exists) {
            const userData = userDoc.data();
            console.log("[DEBUG] /api/auth/check-role: User document data:", userData);
            const role = userData.role;
            const businessType = userData.businessType || null; // Get businessType
            if (role) {
                // User has a role, login is successful.
                console.log(`[DEBUG] /api/auth/check-role: Role found: '${role}', BusinessType: '${businessType}'. Returning 200.`);
                return NextResponse.json({ role, businessType }, { status: 200 }); // Return businessType as well
            } else {
                 // This case is unlikely if profile completion is enforced, but good to have.
                 console.warn(`[DEBUG] /api/auth/check-role: User document exists but 'role' field is missing for UID: ${uid}.`);
                 return NextResponse.json({ message: 'Role not found for this user.' }, { status: 404 });
            }
        } else {
            // If the user document doesn't exist, they are a new user.
            console.log(`[DEBUG] /api/auth/check-role: User document does not exist for UID: ${uid}. Returning 404.`);
            return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });
        }

    } catch (error) {
        console.error('[DEBUG] /api/auth/check-role: CRITICAL ERROR:', error);
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        // Specific check for the audience error to provide a clearer message
        if (error.code === 'auth/argument-error' && error.message.includes('Firebase ID token has incorrect "aud" (audience) claim')) {
            return NextResponse.json({ message: `Critical Backend Mismatch: ${error.message}` }, { status: 500 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
