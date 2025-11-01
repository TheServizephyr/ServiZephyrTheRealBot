
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[DEBUG] /api/auth/check-role: Received a request.");
    try {
        const uid = await verifyAndGetUid(req); // Use the new helper
        const firestore = await getFirestore();
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
            
            // This custom claim logic can be simplified, but let's keep it for now
            const auth = await getAuth();
            const { customClaims } = await auth.getUser(uid);

            if (role === 'admin' && !customClaims?.isAdmin) {
                await auth.setCustomUserClaims(uid, { isAdmin: true });
                console.log(`[DEBUG] /api/auth/check-role: Custom claim 'isAdmin: true' set for UID: ${uid}.`);
            } else if (role !== 'admin' && customClaims?.isAdmin) {
                 await auth.setCustomUserClaims(uid, { isAdmin: null });
                 console.log(`[DEBUG] /api/auth/check-role: User is no longer admin, removing custom claim for UID: ${uid}.`);
            }

            if (role) {
                console.log(`[DEBUG] /api/auth/check-role: Role found in 'users': '${role}'. Returning 200.`);
                return NextResponse.json({ role, businessType }, { status: 200 });
            }
        }
        
        console.log(`[DEBUG] /api/auth/check-role: User not in 'users' or has no role. Checking 'drivers' collection.`);
        const driverRef = firestore.collection('drivers').doc(uid);
        const driverDoc = await driverRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore 'drivers' document fetched. Exists: ${driverDoc.exists}`);

        if (driverDoc.exists) {
            console.log(`[DEBUG] /api/auth/check-role: Role found in 'drivers': 'rider'. Returning 200.`);
            return NextResponse.json({ role: 'rider', businessType: null }, { status: 200 });
        }

        console.log(`[DEBUG] /api/auth/check-role: User not found in any collection for UID: ${uid}. Returning 404.`);
        return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });

    } catch (error) {
        console.error('[DEBUG] /api/auth/check-role: CRITICAL ERROR:', error);
        if (error.code === 'auth/id-token-expired') {
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        // Handle custom errors from our helper
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
