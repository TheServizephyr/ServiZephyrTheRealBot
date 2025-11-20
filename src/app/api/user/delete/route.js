import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export async function DELETE(req) {
    console.log("[API /user/delete] DELETE request received.");
    try {
        // 1. Authenticate the user making the request
        const uid = await verifyAndGetUid(req);
        if (!uid) {
            throw { message: 'Authentication required to delete an account.', status: 401 };
        }
        
        console.log(`[API /user/delete] Authenticated request for UID: ${uid}`);

        const firestore = await getFirestore();
        const auth = await getAuth();

        const userRef = firestore.collection('users').doc(uid);

        // Start a batch to ensure atomicity
        const batch = firestore.batch();
        
        // 2. Mark the Firestore user document for deletion
        batch.delete(userRef);
        console.log(`[API /user/delete] Batch: Marked Firestore user document for deletion at 'users/${uid}'.`);

        // 3. Delete the user from Firebase Authentication
        // This is the final step. We'll do it after the batch commit.
        await auth.deleteUser(uid);
        console.log(`[API /user/delete] Successfully deleted user from Firebase Authentication for UID: ${uid}.`);

        // 4. Commit the Firestore deletion
        await batch.commit();
        console.log(`[API /user/delete] Batch committed. Firestore data deleted.`);


        return NextResponse.json({ message: 'Account permanently deleted from all systems.' }, { status: 200 });

    } catch (error) {
        console.error('[API /user/delete] CRITICAL ERROR:', error);
        
        // Handle custom errors from our helper with a status property
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        
        // Handle Firebase-specific errors
        if (error.code === 'auth/user-not-found') {
             return NextResponse.json({ message: 'User not found in authentication system. May have been already deleted.' }, { status: 404 });
        }
        
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
