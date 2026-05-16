

import { NextResponse } from 'next/server';
import {
    AUTH_SESSION_COOKIE_NAME,
    AUTH_SESSION_MAX_AGE_MS,
    createAuthSessionCookie,
    extractBearerTokenFromRequest,
    getAuth,
    getFirestore,
    verifyAndGetUid,
} from '@/lib/firebase-admin';
import { logSecurityEvent, SECURITY_EVENT_TYPES } from '@/lib/security/security-events';
import { hashAuditValue, logRequestAudit } from '@/lib/security/request-audit';
import { appendDashboardScope, getDefaultOwnerDashboardPathForAccess } from '@/lib/ownerDashboardAccess';
import { SALES_PARTNERS_COLLECTION } from '@/lib/sales-operations';

const OWNER_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);
const normalizePhoneForLookup = (value) => String(value || '').replace(/\D/g, '').slice(-10);

function getBusinessTypeFromRole(role) {
    if (role === 'shop-owner') return 'store';
    if (role === 'street-vendor') return 'street-vendor';
    if (role === 'restaurant-owner') return 'restaurant';
    return null;
}

async function resolveBusinessType(firestore, uid, role, currentBusinessType) {
    if (currentBusinessType) {
        const normalized = String(currentBusinessType).trim().toLowerCase();
        if (normalized === 'street_vendor') return 'street-vendor';
        if (normalized === 'shop') return 'store';
        return normalized;
    }

    const roleMappedType = getBusinessTypeFromRole(role);
    if (roleMappedType) return roleMappedType;

    if (!OWNER_ROLES.has(role)) return null;

    const checks = [
        { collection: 'restaurants', type: 'restaurant' },
        { collection: 'shops', type: 'store' },
        { collection: 'street_vendors', type: 'street-vendor' },
    ];

    for (const check of checks) {
        const snap = await firestore
            .collection(check.collection)
            .where('ownerId', '==', uid)
            .limit(1)
            .get();
        if (!snap.empty) return check.type;
    }

    return null;
}

function getBusinessTypeFromCollectionName(collectionName) {
    if (collectionName === 'shops') return 'store';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
}

function serializeLinkedOutlet(outlet = {}) {
    return {
        outletId: outlet.outletId,
        outletName: outlet.outletName,
        employeeRole: outlet.employeeRole,
        collectionName: outlet.collectionName,
        ownerId: outlet.ownerId,
        permissions: Array.isArray(outlet.permissions) ? outlet.permissions : [],
        customAllowedPages: Array.isArray(outlet.customAllowedPages) ? outlet.customAllowedPages : null,
    };
}

async function findUnlinkedSalesPartnerForAuth(firestore, uid) {
    try {
        const auth = await getAuth();
        const authUser = await auth.getUser(uid);
        const email = String(authUser?.email || '').trim().toLowerCase();
        const phone = normalizePhoneForLookup(authUser?.phoneNumber);
        const partnersRef = firestore.collection(SALES_PARTNERS_COLLECTION);

        let partnerDoc = null;
        if (email) {
            const byEmail = await partnersRef.where('email', '==', email).limit(1).get();
            if (!byEmail.empty) partnerDoc = byEmail.docs[0];
        }

        if (!partnerDoc && phone) {
            const byPhone = await partnersRef.where('phone', '==', phone).limit(1).get();
            if (!byPhone.empty) partnerDoc = byPhone.docs[0];
        }

        if (!partnerDoc) return null;
        const partner = partnerDoc.data() || {};
        if (partner.status === 'inactive') return null;
        if (partner.userId && partner.userId !== uid) return null;
        return partnerDoc;
    } catch (error) {
        console.warn('[DEBUG] /api/auth/check-role: Sales partner lookup skipped:', error?.message || error);
        return null;
    }
}

function buildEmployeeRedirect(outlet = {}) {
    if (outlet.collectionName === 'street_vendors') {
        return appendDashboardScope('/street-vendor-dashboard', { employeeOfOwnerId: outlet.ownerId });
    }

    const businessType = getBusinessTypeFromCollectionName(outlet.collectionName);
    const defaultPath = getDefaultOwnerDashboardPathForAccess({
        role: outlet.employeeRole,
        customAllowedPages: outlet.customAllowedPages,
        businessType,
    });

    return appendDashboardScope(defaultPath, { employeeOfOwnerId: outlet.ownerId });
}

export async function POST(req) {
    console.log("[DEBUG] /api/auth/check-role: Received a request.");
    const auditTokenId = hashAuditValue(extractBearerTokenFromRequest(req) || req.cookies?.get?.(AUTH_SESSION_COOKIE_NAME)?.value || '');
    try {
        const idToken = extractBearerTokenFromRequest(req);
        const uid = await verifyAndGetUid(req); // Use the new helper
        const firestore = await getFirestore();
        console.log(`[DEBUG] /api/auth/check-role: Token verified for UID: ${uid}`);
        const sessionCookie = idToken ? await createAuthSessionCookie(idToken, AUTH_SESSION_MAX_AGE_MS) : '';
        const finalize = (payload, status = 200, metadata = {}) => {
            const response = NextResponse.json(payload, { status });
            response.headers.set('Cache-Control', 'no-store');
            if (sessionCookie) {
                response.cookies.set({
                    name: AUTH_SESSION_COOKIE_NAME,
                    value: sessionCookie,
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/',
                    maxAge: Math.floor(AUTH_SESSION_MAX_AGE_MS / 1000),
                });
                void logSecurityEvent({
                    type: SECURITY_EVENT_TYPES.AUTH_SESSION_ISSUED,
                    severity: 'info',
                    actorUid: uid,
                    req,
                    source: 'auth_check_role',
                    metadata: { status },
                });
            }
            logRequestAudit({
                req,
                statusCode: status,
                source: 'auth_check_role',
                actorUid: uid,
                tokenId: auditTokenId,
                metadata,
            });
            return response;
        };

        // 1. Check the 'users' collection first (for customers, owners, admins, street vendors)
        const userRef = firestore.collection('users').doc(uid);
        const userDoc = await userRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore 'users' document fetched. Exists: ${userDoc.exists}`);

        if (userDoc.exists) {
            const userData = userDoc.data();
            console.log("[DEBUG] /api/auth/check-role: User document data:", userData);
            const role = userData.role;
            const businessType = await resolveBusinessType(firestore, uid, role, userData.businessType || null);
            const linkedOutlets = userData.linkedOutlets || [];

            console.log(`[DEBUG] /api/auth/check-role: Role: ${role}, LinkedOutlets count: ${linkedOutlets.length}`);
            console.log("[DEBUG] /api/auth/check-role: LinkedOutlets:", JSON.stringify(linkedOutlets));

            // Check for multiple roles (user is both owner/customer AND employee somewhere)
            const hasEmployeeRole = linkedOutlets.some(o => o.status === 'active');
            const isOwnerOrVendor = role === 'owner' || role === 'street-vendor' || role === 'restaurant-owner' || role === 'shop-owner';

            console.log(`[DEBUG] /api/auth/check-role: hasEmployeeRole: ${hasEmployeeRole}, isOwnerOrVendor: ${isOwnerOrVendor}, role: ${role}`);

            // If user has multiple roles, redirect to select-role page
            // Include admin, owner, vendor, and customer - anyone with a primary role + employee roles
            if (hasEmployeeRole && (isOwnerOrVendor || role === 'customer' || role === 'admin')) {
                console.log(`[DEBUG] /api/auth/check-role: User has MULTIPLE ROLES! Returning hasMultipleRoles: true`);
                return finalize({
                    role,
                    businessType,
                    hasMultipleRoles: true,
                    linkedOutlets: linkedOutlets.filter(o => o.status === 'active').map(serializeLinkedOutlet),
                }, 200, { outcome: 'resolved', role, hasMultipleRoles: true });
            }

            // If user is ONLY an employee (no owner role)
            if (hasEmployeeRole && (!role || role === 'customer' || role === 'employee')) {
                const primaryOutlet = linkedOutlets.find(o => o.status === 'active' && o.isActive);
                const firstActiveOutlet = linkedOutlets.find(o => o.status === 'active');
                const outlet = primaryOutlet || firstActiveOutlet;

                if (outlet) {
                    console.log(`[DEBUG] /api/auth/check-role: User is employee only. Redirecting to outlet dashboard.`);
                    const redirectTo = buildEmployeeRedirect(outlet);

                    return finalize({
                        role: 'employee',
                        employeeRole: outlet.employeeRole,
                        businessType: getBusinessTypeFromCollectionName(outlet.collectionName),
                        redirectTo,
                        outletName: outlet.outletName,
                        outlet: serializeLinkedOutlet(outlet),
                    }, 200, { outcome: 'resolved', role: 'employee', redirectTo });
                }
            }

            // This custom claim logic can be simplified, but let's keep it for now
            const auth = await getAuth();
            const { customClaims } = await auth.getUser(uid);

            if (role === 'admin' && !customClaims?.isAdmin) {
                await auth.setCustomUserClaims(uid, { isAdmin: true });
                console.log(`[DEBUG] /api/auth/check-role: Custom claim 'isAdmin: true' set for UID: ${uid}.`);
            } else if (role !== 'admin' && customClaims?.isAdmin) {
                await auth.setCustomUserClaims(uid, { isAdmin: null });
                console.log(`[DEBUG] /api/auth/check-role: User is no longer admin, removing custom claim for UID: ${uid}.`);
            }

            if (role) {
                console.log(`[DEBUG] /api/auth/check-role: Role found in 'users': '${role}'. Returning 200.`);
                if (role === 'sales-partner' || role === 'growth-partner') {
                    return finalize({ role: 'sales-partner', businessType: null, redirectTo: '/sales-dashboard' }, 200, { outcome: 'resolved', role: 'sales-partner' });
                }
                return finalize({ role, businessType }, 200, { outcome: 'resolved', role });
            }
        }

        const unlinkedSalesPartner = await findUnlinkedSalesPartnerForAuth(firestore, uid);
        if (unlinkedSalesPartner) {
            console.log(`[DEBUG] /api/auth/check-role: Unlinked sales partner found for UID ${uid}. Redirecting to activation.`);
            return finalize({
                role: 'sales-partner',
                businessType: null,
                redirectTo: '/sales-dashboard',
                activationRequired: true,
            }, 200, { outcome: 'sales_activation_required', role: 'sales-partner' });
        }

        console.log(`[DEBUG] /api/auth/check-role: User not in 'users' or has no role. Checking 'drivers' collection.`);
        const driverRef = firestore.collection('drivers').doc(uid);
        const driverDoc = await driverRef.get();
        console.log(`[DEBUG] /api/auth/check-role: Firestore 'drivers' document fetched. Exists: ${driverDoc.exists}`);

        if (driverDoc.exists) {
            console.log(`[DEBUG] /api/auth/check-role: Role found in 'drivers': 'rider'. Returning 200.`);
            return finalize({ role: 'rider', businessType: null }, 200, { outcome: 'resolved', role: 'rider' });
        }

        console.log(`[DEBUG] /api/auth/check-role: User not found in any collection for UID: ${uid}. Returning 404.`);
        return finalize({ message: 'User profile not found.' }, 404, { outcome: 'not_found' });

    } catch (error) {
        console.error('[DEBUG] /api/auth/check-role: CRITICAL ERROR:', error);
        if (error.code === 'auth/id-token-expired') {
            logRequestAudit({
                req,
                statusCode: 401,
                source: 'auth_check_role',
                actorUid: null,
                tokenId: auditTokenId,
                metadata: { outcome: 'expired_token' },
            });
            return NextResponse.json({ message: 'Login token has expired. Please log in again.' }, { status: 401 });
        }
        // Handle custom errors from our helper
        if (error.status) {
            logRequestAudit({
                req,
                statusCode: error.status,
                source: 'auth_check_role',
                actorUid: null,
                tokenId: auditTokenId,
                metadata: { outcome: 'auth_error', error: error.message },
            });
            return NextResponse.json({ message: error.message }, { status: error.status });
        }
        logRequestAudit({
            req,
            statusCode: 500,
            source: 'auth_check_role',
            actorUid: null,
            tokenId: auditTokenId,
            metadata: { outcome: 'error', error: error?.message || 'unknown_error' },
        });
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

