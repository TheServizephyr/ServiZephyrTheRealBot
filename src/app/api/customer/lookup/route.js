import { NextResponse } from 'next/server';
import { getDecodedAuthContext, getFirestore } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import {
    enforceRateLimit,
    readSignedGuestSessionCookie,
    verifyAppCheckToken,
} from '@/lib/public-auth';
import { hashAuditValue, logRequestAudit } from '@/lib/security/request-audit';
import { resolveCustomerLookupProfile } from '@/services/customer/customerLookup.service';

const getClientIp = (req) => {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
};

export async function POST(req) {
    let auditActorUid = null;
    const previewBody = await req.clone().json().catch(() => ({}));
    const auditTokenId = hashAuditValue(previewBody?.ref || previewBody?.guestId || previewBody?.phone || '');
    const respond = (payload, status = 200, metadata = {}) => {
        logRequestAudit({
            req,
            statusCode: status,
            source: 'customer_lookup',
            actorUid: auditActorUid,
            tokenId: auditTokenId,
            metadata,
        });
        return NextResponse.json(payload, { status });
    };

    try {
        await verifyAppCheckToken(req, { required: false });
        const firestore = await getFirestore();
        const body = await req.json();
        const { phone, guestId: explicitGuestId, ref } = body || {};

        const rateKey = `customer-lookup:${getClientIp(req)}:${String(ref || explicitGuestId || phone || 'anon').slice(0, 64)}`;
        const rate = await enforceRateLimit(firestore, {
            key: rateKey,
            limit: 30,
            windowSec: 60,
            req,
            auditContext: 'customer_lookup',
        });
        if (!rate.allowed) {
            return respond({ message: 'Too many lookup attempts. Please wait and retry.' }, 429, {
                outcome: 'rate_limited',
                hasRef: !!ref,
                hasPhone: !!phone,
                hasGuestId: !!explicitGuestId,
            });
        }

        const cookieStore = cookies();
        const guestSession = readSignedGuestSessionCookie(cookieStore, ['customer_lookup']);
        const cookieGuestId = guestSession?.subjectId || null;

        let loggedInUid = null;
        try {
            const decodedToken = await getDecodedAuthContext(req, { checkRevoked: false, allowSessionCookie: true });
            loggedInUid = decodedToken.uid;
        } catch (e) {
            console.warn('[API /customer/lookup] No authenticated user context:', e.message);
        }

        const result = await resolveCustomerLookupProfile(firestore, {
            phone,
            explicitGuestId,
            ref,
            cookieGuestId,
            loggedInUid,
        });

        if (result?.actorUid) {
            auditActorUid = result.actorUid;
        }

        if (!result?.found) {
            return respond(result?.payload || { message: 'User not found.' }, result?.status || 404, result?.metadata || {
                outcome: 'not_found',
            });
        }

        return respond(result.response, 200, result.metadata || {
            outcome: 'resolved',
        });
    } catch (error) {
        console.error('[API /customer/lookup] Error:', error);
        return respond({ message: `Backend Error: ${error.message}` }, 500, {
            outcome: 'error',
            error: error?.message || 'unknown_error',
        });
    }
}
