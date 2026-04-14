

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
import { hashAuditValue, logRequestAudit } from '@/lib/security/request-audit';

const getClientIp = (req) => {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
};

const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);

export async function POST(req) {
    let auditActorUid = null;
    const auditTokenId = hashAuditValue((await req.clone().json().catch(() => ({})))?.token || '');
    const respond = (payload, status = 200, metadata = {}) => {
        logRequestAudit({
            req,
            statusCode: status,
            source: 'auth_verify_token',
            actorUid: auditActorUid,
            tokenId: auditTokenId,
            metadata,
        });
        return NextResponse.json(payload, { status });
    };
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
            return respond({ message: 'Too many verification attempts. Please try again shortly.' }, 429, {
                outcome: 'rate_limited',
                hasPhone: !!phone,
                hasRef: !!ref,
                hasTableId: !!tableId,
            });
        }

        if (!token) {
            return respond({ message: 'Session token is required.' }, 400, {
                outcome: 'missing_token',
                hasPhone: !!phone,
                hasRef: !!ref,
                hasTableId: !!tableId,
            });
        }

        const tokenCheck = await verifyScopedAuthToken(firestore, token, {
            allowedTypes: ['dine-in', 'whatsapp', 'tracking'],
            req,
            auditContext: 'auth_verify_token',
        });
        let tokenData = tokenCheck.tokenData || {};
        let legacyOrderTokenFallback = null;
        if (!tokenCheck.valid) {
            if (['not_found', 'expired'].includes(tokenCheck.reason)) {
                const legacyOrderSnap = await firestore.collection('orders')
                    .where('trackingToken', '==', token)
                    .limit(5)
                    .get();

                if (!legacyOrderSnap.empty) {
                    let resolvedRefSession = null;
                    if (ref) {
                        resolvedRefSession = await resolveGuestAccessRef(firestore, ref, {
                            requiredScopes: ['customer_lookup'],
                            allowLegacy: true,
                            touch: true,
                        });
                    }

                    const normalizedPhone = normalizePhone(phone);
                    const matchedOrderDoc = legacyOrderSnap.docs.find((doc) => {
                        const orderData = doc.data() || {};
                        const orderSubjectId = String(orderData.userId || orderData.customerId || '').trim();
                        const orderPhone = normalizePhone(orderData.customerPhone || orderData.customer?.phone || '');
                        if (resolvedRefSession?.subjectId && orderSubjectId === resolvedRefSession.subjectId) {
                            return true;
                        }
                        if (normalizedPhone && orderPhone && normalizedPhone === orderPhone) {
                            return true;
                        }
                        return false;
                    });

                    if (matchedOrderDoc) {
                        const matchedOrderData = matchedOrderDoc.data() || {};
                        legacyOrderTokenFallback = {
                            orderId: matchedOrderDoc.id,
                            subjectId: String(matchedOrderData.userId || matchedOrderData.customerId || '').trim(),
                            subjectType: String(matchedOrderData.userId || matchedOrderData.customerId || '').trim().startsWith('g_') ? 'guest' : 'user',
                            phone: normalizePhone(matchedOrderData.customerPhone || matchedOrderData.customer?.phone || ''),
                            reason: tokenCheck.reason,
                        };
                        tokenData = {
                            ...matchedOrderData,
                            type: 'tracking',
                            userId: legacyOrderTokenFallback.subjectId || undefined,
                            guestId: legacyOrderTokenFallback.subjectId?.startsWith('g_') ? legacyOrderTokenFallback.subjectId : undefined,
                            phone: legacyOrderTokenFallback.phone || phone || '',
                        };
                    }
                }
            }

            if (!legacyOrderTokenFallback) {
                console.warn('[API verify-token] Token invalid:', tokenCheck.reason);
                return respond({ message: 'Invalid or expired session token.' }, 403, {
                    outcome: 'invalid_token',
                    reason: tokenCheck.reason,
                    hasRef: !!ref,
                });
            }
        }
        auditActorUid = String(tokenData.userId || tokenData.guestId || tokenData.uid || legacyOrderTokenFallback?.subjectId || '').trim() || null;

        // --- DINE-IN FLOW (Unchanged) ---
        if (tokenData.type === 'dine-in') {
            if (!tableId || tokenData.tableId !== tableId) {
                return respond({ message: 'Invalid table for this session.' }, 403, {
                    outcome: 'table_mismatch',
                    tokenType: tokenData.type,
                });
            }
            return respond({ message: 'Token is valid.', type: 'dine-in' }, 200, {
                outcome: 'verified',
                tokenType: tokenData.type,
            });
        }

        // --- GUEST IDENTITY FLOW (New) ---
        if (ref) {
            const refSession = legacyOrderTokenFallback?.subjectId
                ? {
                    subjectId: legacyOrderTokenFallback.subjectId,
                    subjectType: legacyOrderTokenFallback.subjectType,
                    sessionId: ref,
                }
                : await resolveGuestAccessRef(firestore, ref, {
                    requiredScopes: ['customer_lookup'],
                    allowLegacy: true,
                    touch: true,
                });
            if (!refSession?.subjectId) {
                console.error("[API verify-token] Failed to resolve ref.");
                return respond({ message: 'Invalid link format.' }, 400, {
                    outcome: 'invalid_ref',
                    tokenType: tokenData.type,
                });
            }

            const tokenUserId = tokenData.userId || tokenData.guestId;
            if (tokenUserId !== refSession.subjectId) {
                console.warn(`[API verify-token] Guest ID mismatch. Token: ${tokenUserId}, Ref: ${refSession.subjectId}`);
                return respond({ message: 'Invalid session link.' }, 403, {
                    outcome: 'ref_subject_mismatch',
                    tokenType: tokenData.type,
                });
            }

            setSignedGuestSessionCookie(cookies(), {
                subjectId: refSession.subjectId,
                subjectType: refSession.subjectType,
                sessionId: refSession.sessionId || ref,
                scopes: ['customer_lookup', 'active_orders', 'checkout', 'track_orders'],
                maxAgeSec: 7 * 24 * 60 * 60,
            });

            auditActorUid = refSession.subjectId;
            return respond({
                message: 'Token is valid.',
                type: 'guest',
                guestId: refSession.subjectId
            }, 200, {
                outcome: legacyOrderTokenFallback ? 'verified_legacy_order_token' : 'verified',
                tokenType: tokenData.type,
                sessionType: 'guest',
            });
        }

        // --- LEGACY PHONE FLOW & NEW USERID FLOW (Backward Compatibility) ---
        if (tokenData.type === 'whatsapp' || tokenData.type === 'tracking') {
            // Support both new userId field and legacy phone field
            const tokenPhone = normalizePhone(tokenData.phone);
            const normalizedRequestPhone = normalizePhone(phone);

            if (tokenPhone && (!normalizedRequestPhone || tokenPhone !== normalizedRequestPhone)) {
                console.warn(`[API verify-token] Phone mismatch for legacy token.`);
                return respond({ message: 'Invalid session.' }, 403, {
                    outcome: 'phone_mismatch',
                    tokenType: tokenData.type,
                });
            }
            return respond({ message: 'Token is valid.', type: 'legacy_phone' }, 200, {
                outcome: legacyOrderTokenFallback ? 'verified_legacy_order_token' : 'verified',
                tokenType: tokenData.type,
                sessionType: 'legacy_phone',
            });
        }

        return respond({ message: 'Unknown token type.' }, 400, {
            outcome: 'unknown_token_type',
            tokenType: tokenData.type || '',
        });

    } catch (error) {
        console.error('[API verify-token] Error:', error);
        return respond({ message: `Backend Error: ${error.message}` }, 500, {
            outcome: 'error',
            error: error?.message || 'unknown_error',
        });
    }
}
