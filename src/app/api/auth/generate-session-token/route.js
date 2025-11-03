
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { nanoid } from 'nanoid';

export async function POST(req) {
    console.log("[API][generate-session-token] POST request received.");
    try {
        const uid = await verifyAndGetUid(req);
        const firestore = await getFirestore();

        // 1. Fetch user's phone number from 'users' collection
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            console.error(`[API][generate-session-token] User profile not found for UID: ${uid}`);
            return NextResponse.json({ message: 'User profile not found. Please complete your profile.' }, { status: 404 });
        }
        
        const userData = userDoc.data();
        const phone = userData.phone;

        if (!phone) {
            console.error(`[API][generate-session-token] Phone number not found for user UID: ${uid}`);
            return NextResponse.json({ message: 'Phone number not found in your profile. Please update it.' }, { status: 400 });
        }

        // 2. Generate a secure, unique token
        const token = nanoid(24);
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2-hour validity

        // 3. Save token to Firestore
        const authTokenRef = firestore.collection('auth_tokens').doc(token);
        await authTokenRef.set({
            phone: phone,
            expiresAt: expiresAt,
            uid: uid // Optional: link token to user for auditing
        });
        
        console.log(`[API][generate-session-token] Generated new token for phone: ${phone}`);

        // 4. Return the phone number and token
        return NextResponse.json({ phone, token }, { status: 200 });

    } catch (error) {
        console.error('GENERATE SESSION TOKEN API ERROR:', error);
        if (error.status) {
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
