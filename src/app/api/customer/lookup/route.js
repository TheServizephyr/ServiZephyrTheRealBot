

import { NextResponse } from 'next/server';
import { getDecodedAuthContext, getFirestore } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { getOrCreateGuestProfile } from '@/lib/guest-utils';
import {
    enforceRateLimit,
    readSignedGuestSessionCookie,
    resolveGuestAccessRef,
    verifyAppCheckToken,
} from '@/lib/public-auth';
import { hashAuditValue, logRequestAudit } from '@/lib/security/request-audit';

const getClientIp = (req) => {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
};

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.slice(-10);
};

const pickPhone = (profileData = {}, fallback = '') => {
    const candidates = [
        profileData?.phone,
        profileData?.phoneNumber,
        profileData?.whatsappNumber,
        profileData?.addresses?.[0]?.phone,
        fallback,
    ];

    for (const candidate of candidates) {
        const normalized = normalizePhone(candidate);
        if (normalized.length === 10) return normalized;
    }

    return normalizePhone(fallback);
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
        const guestId = typeof explicitGuestId === 'string' ? explicitGuestId.trim() : explicitGuestId;
        const cookieStore = cookies();
        const guestSession = readSignedGuestSessionCookie(cookieStore, ['customer_lookup']);
        const cookieGuestId = guestSession?.subjectId || null;

        // CRITICAL CHANGE: If ref is provided, prioritize it over logged-in UID
        // This ensures WhatsApp capability URLs work correctly even when user is logged in
        let refId = null;
        if (ref) {
            console.log(`[API /customer/lookup] Resolving guest access ref...`);
            const refSession = await resolveGuestAccessRef(firestore, ref, {
                requiredScopes: ['customer_lookup'],
                allowLegacy: true,
                touch: true,
            });
            refId = refSession?.subjectId || null;
            if (refId) {
                console.log(`[API /customer/lookup] ✅ Resolved ref to userId: ${refId}`);
                auditActorUid = refId;
            } else {
                console.warn(`[API /customer/lookup] ⚠️ Failed to resolve ref: ${ref}`);
            }
        }

        // CRITICAL: UID-FIRST PRIORITY (only if NO ref provided)
        // Check if user is logged in via Authorization header
        let loggedInUid = null;

        try {
            const decodedToken = await getDecodedAuthContext(req, { checkRevoked: false, allowSessionCookie: true });
            loggedInUid = decodedToken.uid;
            console.log(`[API /customer/lookup] ✅ Logged-in user detected: ${loggedInUid}`);
        } catch (e) {
            console.warn(`[API /customer/lookup] No authenticated user context:`, e.message);
        }

        // PRIORITY LOGIC:
        // 1. If ref provided → use refId (WhatsApp capability URL)
        // 2. Else if logged in → use loggedInUid
        const targetUserId = refId || guestId || cookieGuestId || loggedInUid;

        if (targetUserId) {
            const source = refId
                ? 'ref'
                : (guestId ? 'payload_guestId' : (cookieGuestId ? 'cookie_guestId' : 'auth'));
            console.log(`[API /customer/lookup] Target User: ${targetUserId} (source: ${source})`);

            // Try guest_profiles first
            const guestDoc = await firestore.collection('guest_profiles').doc(targetUserId).get();
            if (guestDoc.exists) {
                const guestData = guestDoc.data();
                console.log(`[API /customer/lookup] ✅ Guest profile found with ${guestData.addresses?.length || 0} addresses`);
                auditActorUid = targetUserId;
                return respond({
                    name: guestData.name || 'Guest',
                    phone: pickPhone(guestData),
                    addresses: guestData.addresses || [],
                    isVerified: false,
                    isGuest: true
                }, 200, {
                    outcome: 'resolved',
                    source: source,
                    profileType: 'guest',
                });
            }

            // Fallback to users collection
            const userDoc = await firestore.collection('users').doc(targetUserId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                console.log(`[API /customer/lookup] ✅ User found. Addresses: ${userData.addresses?.length || 0}`);
                auditActorUid = targetUserId;
                return respond({
                    name: userData.name || 'User',
                    phone: pickPhone(userData),
                    addresses: userData.addresses || [],
                    isVerified: true,
                    isGuest: false
                }, 200, {
                    outcome: 'resolved',
                    source: source,
                    profileType: 'user',
                });
            }

            console.warn(`[API /customer/lookup] ❌ Profile not found: ${targetUserId}`);
            return respond({ message: 'User not found.' }, 404, {
                outcome: 'not_found',
                source,
            });
        }

        console.log(`[API /customer/lookup] 📊 State: GuestID=${guestId ? 'Yes' : 'No'}, Phone=${phone ? 'Yes' : 'No'}, Ref=${ref ? 'Yes' : 'No'}`);

        // --- GUEST PROFILE LOOKUP ---
        if (guestId) {
            console.log(`[API /customer/lookup] 🔍 Looking up by guestId: ${guestId}`);
            console.log(`[API /customer/lookup] Fetching Guest Profile: ${guestId}`);
            const guestDoc = await firestore.collection('guest_profiles').doc(guestId).get();

            if (guestDoc.exists) {
                const guestData = guestDoc.data();
                console.log(`[API /customer/lookup] ✅ Guest profile found with ${guestData.addresses?.length || 0} addresses`);
                auditActorUid = guestId;
                return respond({
                    name: guestData.name || 'Guest',
                    phone: pickPhone(guestData),
                    addresses: guestData.addresses || [],
                    isVerified: false,
                    isGuest: true
                }, 200, {
                    outcome: 'resolved',
                    source: 'payload_guestId',
                    profileType: 'guest',
                });
            } else {
                console.warn(`[API /customer/lookup] ⚠️ Guest Profile not found: ${guestId}. Checking 'users' collection (Migration Fallback)...`);

                // FALLBACK: Check if this ID is actually a UID (migrated user)
                const userDoc = await firestore.collection('users').doc(guestId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    console.log(`[API /customer/lookup] ✅ Found migrated user profile via ref: ${guestId} with ${userData.addresses?.length || 0} addresses`);
                    auditActorUid = guestId;
                    return respond({
                        name: userData.name || 'User',
                        phone: pickPhone(userData),
                        addresses: userData.addresses || [],
                        isVerified: true,
                        isGuest: false
                    }, 200, {
                        outcome: 'resolved',
                        source: 'payload_guestId',
                        profileType: 'user',
                    });
                }

                console.error(`[API /customer/lookup] ❌ Profile not found in guest_profiles OR users with ID: ${guestId}`);
                return respond({ message: 'Guest profile not found.' }, 404, {
                    outcome: 'not_found',
                    source: 'payload_guestId',
                });
            }
        }

        // --- LEGACY PHONE LOOKUP ---
        if (!phone) {
            console.error(`[API /customer/lookup] ❌ No user identifier provided (no guestId and no phone)`);
            return respond({ message: 'User identifier required.' }, 400, {
                outcome: 'missing_identifier',
            });
        }

        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        console.log(`[API /customer/lookup] 📞 Phone Lookup (UID-first): ${normalizedPhone}`);

        // CRITICAL: Use UID-first priority via getOrCreateGuestProfile
        const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
        const userId = profileResult.userId;

        let userData;
        if (profileResult.isGuest) {
            // Guest profile
            const guestDoc = await firestore.collection('guest_profiles').doc(userId).get();
            if (guestDoc.exists) {
                userData = guestDoc.data();
                auditActorUid = userId;
                return respond({
                    name: userData.name || 'Guest',
                    phone: pickPhone(userData, normalizedPhone),
                    addresses: userData.addresses || [],
                    isVerified: false,
                    isGuest: true
                }, 200, {
                    outcome: 'resolved',
                    source: 'phone_lookup',
                    profileType: 'guest',
                });
            }
        } else {
            // Logged-in user (UID)
            const userDoc = await firestore.collection('users').doc(userId).get();
            if (userDoc.exists) {
                userData = userDoc.data();
                auditActorUid = userId;
                return respond({
                    name: userData.name,
                    phone: pickPhone(userData, normalizedPhone),
                    addresses: userData.addresses || [],
                    isVerified: true,
                    isGuest: false
                }, 200, {
                    outcome: 'resolved',
                    source: 'phone_lookup',
                    profileType: 'user',
                });
            }
        }

        return respond({ message: 'User not found.' }, 404, {
            outcome: 'not_found',
            source: 'phone_lookup',
        });

    } catch (error) {
        console.error('CUSTOMER LOOKUP API ERROR:', error);
        return respond({ message: `Backend Error: ${error.message}` }, 500, {
            outcome: 'error',
            error: error?.message || 'unknown_error',
        });
    }
}
