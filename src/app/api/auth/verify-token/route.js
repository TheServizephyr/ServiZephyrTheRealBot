
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const firestore = await getFirestore(); // THE FIX: Added await
        const { phone, token } = await req.json();

        if (!phone || !token) {
            return NextResponse.json({ message: 'Phone number and token are required.' }, { status: 400 });
        }

        const tokenRef = firestore.collection('auth_tokens').doc(token);
        const tokenDoc = await tokenRef.get();

        if (!tokenDoc.exists) {
            console.warn(`[API verify-token] Token not found: ${token}`);
            return NextResponse.json({ message: 'Invalid or expired session token.' }, { status: 403 });
        }

        const tokenData = tokenDoc.data();

        // 1. Check if the phone number matches
        if (tokenData.phone !== phone) {
            console.warn(`[API verify-token] Phone number mismatch. Token phone: ${tokenData.phone}, Provided phone: ${phone}`);
            return NextResponse.json({ message: 'Session token is not valid for this phone number.' }, { status: 403 });
        }

        // 2. Check for expiry
        const expiresAt = tokenData.expiresAt.toDate();
        if (new Date() > expiresAt) {
            console.warn(`[API verify-token] Token has expired for phone: ${phone}`);
            // Optional: Delete the expired token from Firestore
            await tokenRef.delete();
            return NextResponse.json({ message: 'Your session has expired. Please restart from WhatsApp.' }, { status: 403 });
        }

        console.log(`[API verify-token] Token verified successfully for phone: ${phone}`);
        return NextResponse.json({ message: 'Token is valid.' }, { status: 200 });

    } catch (error) {
        console.error('VERIFY TOKEN API ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
