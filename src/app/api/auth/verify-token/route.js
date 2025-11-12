

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[API verify-token] POST request received.");
    try {
        const firestore = await getFirestore();
        const { phone, token, tableId } = await req.json();
        console.log(`[API verify-token] Received payload - Phone: ${phone}, Token: ${token ? 'Present' : 'Missing'}, TableID: ${tableId}`);

        if (!token) {
            console.error("[API verify-token] Validation failed: Session token is required.");
            return NextResponse.json({ message: 'Session token is required.' }, { status: 400 });
        }

        const tokenRef = firestore.collection('auth_tokens').doc(token);
        const tokenDoc = await tokenRef.get();

        if (!tokenDoc.exists) {
            console.warn(`[API verify-token] Token not found in Firestore: ${token}`);
            return NextResponse.json({ message: 'Invalid or expired session token.' }, { status: 403 });
        }

        const tokenData = tokenDoc.data();
        const expiresAt = tokenData.expiresAt.toDate();

        if (new Date() > expiresAt) {
            console.warn(`[API verify-token] Token has expired for token: ${token}`);
            await tokenRef.delete();
            return NextResponse.json({ message: 'Your session has expired. Please restart.' }, { status: 403 });
        }
        
        console.log(`[API verify-token] Token found. Type: ${tokenData.type}, Expires: ${expiresAt.toISOString()}`);

        if (tokenData.type === 'dine-in') {
            if (!tableId) {
                console.error("[API verify-token] Validation failed: Table ID is required for dine-in session.");
                return NextResponse.json({ message: 'Table ID is required for dine-in session verification.' }, { status: 400 });
            }
            if (tokenData.tableId !== tableId) {
                 console.warn(`[API verify-token] Table ID mismatch. Token table: ${tokenData.tableId}, Provided table: ${tableId}`);
                 return NextResponse.json({ message: 'Session token is not valid for this table.' }, { status: 403 });
            }
            console.log(`[API verify-token] DINE-IN token verified successfully for table: ${tableId}`);
            return NextResponse.json({ message: 'Token is valid.' }, { status: 200 });
        }

        if (tokenData.type === 'whatsapp' || tokenData.type === 'tracking') {
            if (!phone) {
                 console.error("[API verify-token] Validation failed: Phone number is required for this session type.");
                 return NextResponse.json({ message: 'Phone number is required for this session.' }, { status: 400 });
            }
            if (tokenData.phone !== phone) {
                console.warn(`[API verify-token] Phone number mismatch. Token phone: ${tokenData.phone}, Provided phone: ${phone}`);
                return NextResponse.json({ message: 'Session token is not valid for this phone number.' }, { status: 403 });
            }
            console.log(`[API verify-token] ${tokenData.type.toUpperCase()} token verified successfully for phone: ${phone}`);
            return NextResponse.json({ message: 'Token is valid.' }, { status: 200 });
        }
        
        console.error(`[API verify-token] Unknown token type found: '${tokenData.type}' for token ${token}`);
        return NextResponse.json({ message: 'Unknown token type.' }, { status: 400 });

    } catch (error) {
        console.error('[API verify-token] CRITICAL ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
