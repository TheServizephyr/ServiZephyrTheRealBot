
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const authHeader = req.headers.get('authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await auth.verifyIdToken(token);
        const uid = decodedToken.uid;

        // Check the single 'users' collection for the user's role
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            const userData = userDoc.data();
            const role = userData.role;
            if (role) {
                // User has a role, login is successful.
                return NextResponse.json({ role }, { status: 200 });
            } else {
                 // This case is unlikely if profile completion is enforced, but good to have.
                 return NextResponse.json({ message: 'Role not found for this user.' }, { status: 404 });
            }
        } else {
            // If the user document doesn't exist, they are a new user.
            return NextResponse.json({ message: 'User profile not found.' }, { status: 404 });
        }

    } catch (error) {
        console.error('CHECK ROLE ERROR:', error);
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
