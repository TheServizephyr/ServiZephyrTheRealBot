import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

// This is a placeholder for a function that can re-authenticate.
// In a real scenario with password-based accounts, this would be more complex.
// For Google Sign-In, re-authentication is handled on the client.
// Since we are now handling this on the server, we assume the client has passed necessary credentials.
// For now, we will proceed with the deletion, but acknowledge this limitation.
// The FIX is to perform deletion on the client-side after re-authentication.
// However, the current structure uses a server-side API, so we adjust it.

export async function POST(req) {
    console.log("[API /user/delete] POST request received for deletion.");
    try {
        const uid = await verifyAndGetUid(req);
        if (!uid) {
            throw { message: 'Authentication required to delete an account.', status: 401 };
        }
        
        console.log(`[API /user/delete] Authenticated request for UID: ${uid}`);

        const firestore = await getFirestore();
        const auth = await getAuth();

        const userRef = firestore.collection('users').doc(uid);

        const batch = firestore.batch();
        
        batch.delete(userRef);
        console.log(`[API /user/delete] Batch: Marked Firestore user document for deletion at 'users/${uid}'.`);
        
        // This is the step that can fail without recent login.
        // The Admin SDK's deleteUser does not require re-authentication.
        await auth.deleteUser(uid);
        console.log(`[API /user/delete] Successfully deleted user from Firebase Authentication for UID: ${uid}.`);
        
        await batch.commit();
        console.log(`[API /user/delete] Batch committed. Firestore data deleted.`);

        return NextResponse.json({ message: 'Account permanently deleted from all systems.' }, { status: 200 });

    } catch (error) {
        console.error('[API /user/delete] CRITICAL ERROR:', error);
        
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        
        if (error.code === 'auth/user-not-found') {
             return NextResponse.json({ message: 'User not found in authentication system. May have been already deleted.' }, { status: 404 });
        }
        
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
