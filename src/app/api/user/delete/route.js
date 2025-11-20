import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

// This API is now simplified. It expects a fresh ID token from the client,
// which the client gets after re-authenticating the user.
export async function POST(req) {
    console.log("[API /user/delete] POST request received for deletion.");
    try {
        // The token is verified here. If it's old, this will fail.
        // The client is responsible for providing a fresh token after re-auth.
        const uid = await verifyAndGetUid(req);
        if (!uid) {
            throw { message: 'Authentication required to delete an account.', status: 401 };
        }
        
        console.log(`[API /user/delete] Authenticated request for UID: ${uid}`);

        const firestore = await getFirestore();
        const auth = await getAuth();

        const userRef = firestore.collection('users').doc(uid);

        const batch = firestore.batch();
        
        // 1. Mark the Firestore user document for deletion
        batch.delete(userRef);
        console.log(`[API /user/delete] Batch: Marked Firestore user document for deletion at 'users/${uid}'.`);
        
        // 2. Delete the user from Firebase Authentication
        // This is the action that requires recent login, which the client-side re-auth handles.
        await auth.deleteUser(uid);
        console.log(`[API /user/delete] Successfully deleted user from Firebase Authentication for UID: ${uid}.`);
        
        // 3. Commit the batched Firestore delete
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
        
        // This will catch the 'auth/requires-recent-login' if the client fails to re-authenticate
        if (error.code === 'auth/requires-recent-login') {
            return NextResponse.json({ message: 'This is a sensitive operation and requires recent authentication. Please sign in again.' }, { status: 401 });
        }
        
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
