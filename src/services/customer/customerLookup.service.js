import { getOrCreateGuestProfile } from '@/lib/guest-utils';
import { resolveGuestAccessRef } from '@/lib/public-auth';

const DEFAULT_ROUTE_GUEST_SCOPES = ['customer_lookup', 'active_orders', 'checkout', 'track_orders'];

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

const normalizeScopes = (scopes = []) => [...new Set((Array.isArray(scopes) ? scopes : [scopes]).map((value) => String(value || '').trim()).filter(Boolean))];

const toDate = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

async function resolveGuestAccessRefForService(firestore, ref, requiredScopes = []) {
    const resolved = await resolveGuestAccessRef(firestore, ref, {
        requiredScopes,
        allowLegacy: true,
        touch: true,
    });
    if (resolved) return resolved;

    const safeRef = String(ref || '').trim();
    if (!safeRef) return null;

    const sessionDoc = await firestore.collection('guest_sessions').doc(safeRef).get();
    if (!sessionDoc.exists) {
        return null;
    }

    const sessionData = sessionDoc.data() || {};
    const expiresAt = toDate(sessionData.expiresAt);
    const expired = !expiresAt || Date.now() >= expiresAt.getTime();
    const revoked = String(sessionData.status || '').toLowerCase() === 'revoked';
    const effectiveScopes = normalizeScopes(
        Array.isArray(sessionData.scopes) && sessionData.scopes.length > 0
            ? sessionData.scopes
            : DEFAULT_ROUTE_GUEST_SCOPES
    );
    const missingScopes = normalizeScopes(requiredScopes).filter((scope) => !effectiveScopes.includes(scope));

    if (expired || revoked || missingScopes.length > 0) {
        return null;
    }

    return {
        subjectId: String(sessionData.subjectId || '').trim(),
        subjectType: String(sessionData.subjectType || 'guest').trim() || 'guest',
        phone: String(sessionData.phone || '').trim(),
        businessId: String(sessionData.businessId || '').trim(),
        scopes: effectiveScopes,
        sessionId: sessionDoc.id,
        source: 'session_ref_fallback',
        legacy: false,
    };
}

const normalizeAddressKey = (address = {}) => {
    const id = String(address?.id || '').trim();
    if (id) return `id:${id}`;

    const full = String(address?.full || '').trim().toLowerCase();
    const phone = normalizePhone(address?.phone || '');
    const lat = Number(address?.latitude ?? address?.lat);
    const lng = Number(address?.longitude ?? address?.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    if (hasCoords) {
        return `coords:${lat.toFixed(5)}:${lng.toFixed(5)}:${phone}`;
    }

    return `text:${full}:${phone}`;
};

const mergeAddresses = (...groups) => {
    const merged = [];
    const seen = new Set();

    for (const group of groups) {
        for (const address of Array.isArray(group) ? group : []) {
            const key = normalizeAddressKey(address);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(address);
        }
    }

    return merged;
};

async function findProfileByPhone(firestore, collectionName, phone, excludeDocId = '') {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return null;

    const snap = await firestore
        .collection(collectionName)
        .where('phone', '==', normalizedPhone)
        .limit(2)
        .get();

    if (snap.empty) return null;

    const preferredDoc = snap.docs.find((doc) => doc.id !== excludeDocId) || snap.docs[0];
    if (!preferredDoc) return null;

    return {
        id: preferredDoc.id,
        data: preferredDoc.data() || {},
        collection: collectionName,
    };
}

async function enrichProfileWithCrossAddresses(firestore, {
    profileId,
    profileType,
    profileData,
    phoneFallback = '',
}) {
    const ownAddresses = Array.isArray(profileData?.addresses) ? profileData.addresses : [];
    const profilePhone = pickPhone(profileData, phoneFallback);
    if (!profilePhone) {
        return {
            profileData,
            addresses: ownAddresses,
        };
    }

    const counterpartCollection = profileType === 'guest' ? 'users' : 'guest_profiles';
    const counterpart = await findProfileByPhone(
        firestore,
        counterpartCollection,
        profilePhone,
        profileType === 'guest' ? '' : profileId
    );

    const counterpartAddresses = Array.isArray(counterpart?.data?.addresses) ? counterpart.data.addresses : [];

    return {
        profileData,
        addresses: mergeAddresses(ownAddresses, counterpartAddresses),
        counterpart,
    };
}

export async function resolveCustomerLookupProfile(firestore, {
    phone,
    explicitGuestId,
    ref,
    cookieGuestId,
    loggedInUid,
}) {
    const guestId = typeof explicitGuestId === 'string' ? explicitGuestId.trim() : explicitGuestId;

    let refId = null;
    let refPhone = '';
    if (ref) {
        const refSession = await resolveGuestAccessRefForService(firestore, ref, ['customer_lookup']);
        refId = refSession?.subjectId || null;
        refPhone = normalizePhone(refSession?.phone || '');
    }

    const targetUserId = refId || guestId || cookieGuestId || loggedInUid;

    if (targetUserId) {
        const source = refId
            ? 'ref'
            : (guestId ? 'payload_guestId' : (cookieGuestId ? 'cookie_guestId' : 'auth'));

        const guestDoc = await firestore.collection('guest_profiles').doc(targetUserId).get();
        if (guestDoc.exists) {
            const guestData = guestDoc.data() || {};
            const enriched = await enrichProfileWithCrossAddresses(firestore, {
                profileId: targetUserId,
                profileType: 'guest',
                profileData: guestData,
                phoneFallback: refPhone,
            });
            return {
                found: true,
                actorUid: targetUserId,
                response: {
                    name: guestData.name || 'Guest',
                    phone: pickPhone(guestData, refPhone),
                    addresses: enriched.addresses || [],
                    isVerified: false,
                    isGuest: true,
                },
                metadata: {
                    outcome: 'resolved',
                    source,
                    profileType: 'guest',
                },
            };
        }

        const userDoc = await firestore.collection('users').doc(targetUserId).get();
        if (userDoc.exists) {
            const userData = userDoc.data() || {};
            const enriched = await enrichProfileWithCrossAddresses(firestore, {
                profileId: targetUserId,
                profileType: 'user',
                profileData: userData,
                phoneFallback: refPhone,
            });
            return {
                found: true,
                actorUid: targetUserId,
                response: {
                    name: userData.name || 'User',
                    phone: pickPhone(userData, refPhone),
                    addresses: enriched.addresses || [],
                    isVerified: true,
                    isGuest: false,
                },
                metadata: {
                    outcome: 'resolved',
                    source,
                    profileType: 'user',
                },
            };
        }

        if (refPhone) {
            const profileResult = await getOrCreateGuestProfile(firestore, refPhone);
            const resolvedProfileId = profileResult?.userId || '';

            if (resolvedProfileId) {
                const collectionName = profileResult.isGuest ? 'guest_profiles' : 'users';
                const profileDoc = await firestore.collection(collectionName).doc(resolvedProfileId).get();
                if (profileDoc.exists) {
                    const profileData = profileDoc.data() || {};
                    const enriched = await enrichProfileWithCrossAddresses(firestore, {
                        profileId: resolvedProfileId,
                        profileType: profileResult.isGuest ? 'guest' : 'user',
                        profileData,
                        phoneFallback: refPhone,
                    });
                    return {
                        found: true,
                        actorUid: resolvedProfileId,
                        response: {
                            name: profileData.name || (profileResult.isGuest ? 'Guest' : 'User'),
                            phone: pickPhone(profileData, refPhone),
                            addresses: enriched.addresses || [],
                            isVerified: !profileResult.isGuest,
                            isGuest: profileResult.isGuest,
                        },
                        metadata: {
                            outcome: 'resolved',
                            source,
                            profileType: profileResult.isGuest ? 'guest' : 'user',
                            fallback: 'ref_phone',
                        },
                    };
                }
            }
        }

        return {
            found: false,
            status: 404,
            payload: { message: 'User not found.' },
            actorUid: targetUserId,
            metadata: {
                outcome: 'not_found',
                source,
            },
        };
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
        return {
            found: false,
            status: 400,
            payload: { message: 'No user identifier provided (no guestId and no phone)' },
            metadata: {
                outcome: 'missing_identifier',
            },
        };
    }

    const profileResult = await getOrCreateGuestProfile(firestore, normalizedPhone);
    const profileId = profileResult?.userId || '';
    if (!profileId) {
        return {
            found: false,
            status: 404,
            payload: { message: 'User not found.' },
            metadata: {
                outcome: 'not_found',
                source: 'phone',
            },
        };
    }

    const collectionName = profileResult.isGuest ? 'guest_profiles' : 'users';
    const profileDoc = await firestore.collection(collectionName).doc(profileId).get();
    const profileData = profileDoc.exists ? (profileDoc.data() || {}) : {};
    const enriched = await enrichProfileWithCrossAddresses(firestore, {
        profileId,
        profileType: profileResult.isGuest ? 'guest' : 'user',
        profileData,
        phoneFallback: normalizedPhone,
    });

    return {
        found: true,
        actorUid: profileId,
        response: {
            name: profileData.name || (profileResult.isGuest ? 'Guest' : 'User'),
            phone: pickPhone(profileData, normalizedPhone),
            addresses: enriched.addresses || [],
            isVerified: !profileResult.isGuest,
            isGuest: profileResult.isGuest,
        },
        metadata: {
            outcome: 'resolved',
            source: 'phone',
            profileType: profileResult.isGuest ? 'guest' : 'user',
        },
    };
}
