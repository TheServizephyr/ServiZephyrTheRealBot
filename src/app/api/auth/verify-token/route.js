

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import {
    enforceRateLimit,
    resolveGuestAccessRef,
    setSignedGuestSessionCookie,
    verifyAppCheckToken,
    verifyScopedAuthToken,
} from '@/lib/public-auth';

const getClientIp = (req) => {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
};

export async function POST(req) {
    console.log("[API verify-token] POST request received.");
    try {
        await verifyAppCheckToken(req, { required: false });
        const firestore = await getFirestore();
        const { phone, token, tableId, ref } = await req.json();
        const rateKey = `verify-token:${getClientIp(req)}:${String(ref || phone || tableId || 'anon').slice(0, 64)}`;
        const rate = await enforceRateLimit(firestore, {
            key: rateKey,
            limit: 24,
            windowSec: 60,
            req,
            auditContext: 'auth_verify_token',
        });
        if (!rate.allowed) {
            return NextResponse.json({ message: 'Too many verification attempts. Please try again shortly.' }, { status: 429 });
        }
        console.log(`[API verify-token] Payload - Token: ${token ? 'Yes' : 'No'}, Ref: ${ref ? 'Yes' : 'No'}, Phone: ${phone ? 'Yes' : 'No'}, Table: ${tableId ? 'Yes' : 'No'}`);

        if (!token) {
            return NextResponse.json({ message: 'Session token is required.' }, { status: 400 });
        }

        const tokenCheck = await verifyScopedAuthToken(firestore, token, {
            allowedTypes: ['dine-in', 'whatsapp', 'tracking'],
            req,
            auditContext: 'auth_verify_token',
        });
        if (!tokenCheck.valid) {
            console.warn('[API verify-token] Token invalid:', tokenCheck.reason);
            return NextResponse.json({ message: 'Invalid or expired session token.' }, { status: 403 });
        }
        const tokenData = tokenCheck.tokenData || {};

        // --- DINE-IN FLOW (Unchanged) ---
        if (tokenData.type === 'dine-in') {
            if (!tableId || tokenData.tableId !== tableId) {
                return NextResponse.json({ message: 'Invalid table for this session.' }, { status: 403 });
            }
            return NextResponse.json({ message: 'Token is valid.', type: 'dine-in' }, { status: 200 });
        }

        // --- GUEST IDENTITY FLOW (New) ---
        if (ref) {
            const refSession = await resolveGuestAccessRef(firestore, ref, {
                requiredScopes: ['customer_lookup'],
                allowLegacy: true,
                touch: true,
            });
            if (!refSession?.subjectId) {
                console.error("[API verify-token] Failed to resolve ref.");
                return NextResponse.json({ message: 'Invalid link format.' }, { status: 400 });
            }

            const tokenUserId = tokenData.userId || tokenData.guestId;
            if (tokenUserId !== refSession.subjectId) {
                console.warn(`[API verify-token] Guest ID mismatch. Token: ${tokenUserId}, Ref: ${refSession.subjectId}`);
                return NextResponse.json({ message: 'Invalid session link.' }, { status: 403 });
            }

            setSignedGuestSessionCookie(cookies(), {
                subjectId: refSession.subjectId,
                subjectType: refSession.subjectType,
                sessionId: refSession.sessionId || ref,
                scopes: ['customer_lookup', 'active_orders', 'checkout', 'track_orders'],
                maxAgeSec: 7 * 24 * 60 * 60,
            });

            console.log(`[API verify-token] GUEST Session verified for ${refSession.subjectId}. Cookie set.`);
            return NextResponse.json({
                message: 'Token is valid.',
                type: 'guest',
                guestId: refSession.subjectId
            }, { status: 200 });
        }

        // --- LEGACY PHONE FLOW & NEW USERID FLOW (Backward Compatibility) ---
        if (tokenData.type === 'whatsapp' || tokenData.type === 'tracking') {
            // Support both new userId field and legacy phone field
            const tokenPhone = tokenData.phone;

            if (tokenPhone && (!phone || tokenPhone !== phone)) {
                console.warn(`[API verify-token] Phone mismatch for legacy token.`);
                return NextResponse.json({ message: 'Invalid session.' }, { status: 403 });
            }
            // Even for legacy, let's try to upgrade them to a cookie if possible
            // But we don't have a guestId here easily without migration. 
            // We just allow them to proceed as before.
            console.log(`[API verify-token] LEGACY Phone session verified.`);
            return NextResponse.json({ message: 'Token is valid.', type: 'legacy_phone' }, { status: 200 });
        }

        return NextResponse.json({ message: 'Unknown token type.' }, { status: 400 });

    } catch (error) {
        console.error('[API verify-token] Error:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
