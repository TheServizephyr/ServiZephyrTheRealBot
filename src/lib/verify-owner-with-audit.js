/**
 * Common Helper for Admin Impersonation with Audit Logging
 * This helper can be imported and used across all owner API routes
 */

import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { logImpersonation, getClientIP, getUserAgent, isSessionExpired } from '@/lib/audit-logger';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';
import { PERMISSIONS, getPermissionsForRole, normalizeRole } from '@/lib/permissions';
import { getEphemeralCache, setEphemeralCache } from '@/lib/server/ephemeralCache';

const IMPERSONATION_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const isOwnerAuditDebugEnabled = process.env.DEBUG_OWNER_AUDIT === 'true';
const debugLog = (...args) => {
    if (isOwnerAuditDebugEnabled) {
        console.log(...args);
    }
};

const OWNER_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);
const DEFAULT_COLLECTION_ORDER = ['restaurants', 'shops', 'street_vendors'];
const ACTION_FEATURE_MAP = {
    view_dashboard_data: 'dashboard',
    view_menu: 'menu',
    manage_menu_post: 'menu',
    delete_menu_item: 'menu',
    update_menu_patch: 'menu',
    bulk_create_menu_items: 'menu',
    read_open_items: 'menu',
    create_open_item: 'menu',
    delete_open_item: 'menu',
    view_orders: 'live-orders',
    view_order_details: 'live-orders',
    update_orders_patch: 'live-orders',
    refund_order: 'live-orders',
    refund_order_post: 'live-orders',
    view_analytics: 'analytics',
    view_settings: 'settings',
    update_settings: 'settings',
    view_connections: 'connections',
    create_linked_account: 'connections',
    view_owner_locations: 'location',
    save_owner_location: 'location',
    view_delivery_settings: 'delivery',
    update_delivery_settings: 'delivery',
    view_employees: 'employees',
    invite_employee: 'employees',
    update_employee_permissions: 'employees',
    remove_employee: 'employees',
    view_customers: 'customers',
    update_customer: 'customers',
    view_coupons: 'coupons',
    create_coupon: 'coupons',
    update_coupon: 'coupons',
    delete_coupon: 'coupons',
    view_whatsapp_direct_customer_details: 'whatsapp-direct',
    upsert_whatsapp_direct_customer_details: 'whatsapp-direct',
    view_whatsapp_direct_conversations: 'whatsapp-direct',
    view_whatsapp_direct_messages: 'whatsapp-direct',
    send_whatsapp_direct_message: 'whatsapp-direct',
    upload_whatsapp_direct_media: 'whatsapp-direct',
    onboarding_whatsapp_direct: 'whatsapp-direct',
    custom_bill_create_order: 'manual-order',
    get_custom_bill_history: 'manual-order',
    get_custom_bill_history_analytics: 'manual-order',
    delete_custom_bill_history: 'manual-order',
    manual_tables_get: 'manual-order',
    manual_tables_create: 'manual-order',
    manual_tables_delete: 'manual-order',
    manual_tables_edit: 'manual-order',
    view_delivery_dashboard: 'delivery',
    assign_delivery_boy: 'delivery',
    create_delivery_boy: 'delivery',
    delete_delivery_boy: 'delivery',
    get_dine_in_tables: 'dine-in',
    update_dine_in_tables: 'dine-in',
    view_car_spots: 'dine-in',
    view_service_requests: 'dine-in',
    update_service_requests: 'dine-in',
    view_tables: 'dine-in',
    create_table: 'dine-in',
    update_table: 'dine-in',
    cleanup_stale_tabs: 'dine-in',
    view_dine_in_history: 'dine-in',
    owner_waitlist_get: 'bookings',
    owner_waitlist_post: 'bookings',
    view_waitlist_analytics: 'bookings',
    view_payouts: 'payouts',
    view_inventory: 'inventory',
    adjust_inventory: 'inventory',
    view_inventory_ledger: 'inventory',
    bulk_update_inventory: 'inventory',
    sync_inventory_from_menu: 'inventory',
};

function normalizeBusinessType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street-vendor' || normalized === 'restaurant') return normalized;
    return null;
}

function getBusinessTypeFromRole(role) {
    if (role === 'shop-owner') return 'store';
    if (role === 'street-vendor') return 'street-vendor';
    if (role === 'restaurant-owner' || role === 'owner') return 'restaurant';
    return null;
}

function getCollectionFromBusinessType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    if (normalized === 'store') return 'shops';
    if (normalized === 'shop') return 'shops';
    if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street_vendors';
    if (normalized === 'restaurant') return 'restaurants';
    return null;
}

function getPreferredCollections(userRole, userBusinessType) {
    const resolvedBusinessType = normalizeBusinessType(userBusinessType) || getBusinessTypeFromRole(userRole);
    const preferredCollection = getCollectionFromBusinessType(resolvedBusinessType);

    if (!preferredCollection) return DEFAULT_COLLECTION_ORDER;
    return [preferredCollection, ...DEFAULT_COLLECTION_ORDER.filter((name) => name !== preferredCollection)];
}

/**
 * Verify owner/admin and get business with audit logging support
 * This is a common helper that can be used across all owner API routes
 * 
 * @param {Request} req - Next.js request object
 * @param {string} action - Action being performed (e.g., 'view_orders', 'update_settings')
 * @param {Object} metadata - Additional metadata to log (optional)
 * @param {string|string[]|null} requiredPermissions - Required RBAC permission(s). Any one is enough.
 * @returns {Object} - { uid, businessId, businessSnap, collectionName, isAdmin, isImpersonating }
 */
/**
 * Verify owner/admin and get business with audit logging support
 * This is a common helper that can be used across all owner API routes
 * 
 * @param {Request} req - Next.js request object
 * @param {string} action - Action being performed (e.g., 'view_orders', 'update_settings')
 * @param {Object} metadata - Additional metadata to log (optional)
 * @param {string|string[]|null} requiredPermissions - Required RBAC permission(s). Any one is enough.
 * @returns {Object} - { uid, businessId, businessSnap, collectionName, isAdmin, isImpersonating }
 */
export async function verifyOwnerWithAudit(req, action, metadata = {}, checkRevoked = true, requiredPermissions = null) {
    // 1. REQUEST-LEVEL CACHING: Reuse context if already resolved in this request
    // We attach it to the 'req' object as it persists through the life of the API call.
    if (!req._ownerContextPromise) {
        req._ownerContextPromise = (async () => {
            const firestore = await getFirestore();
            const uid = await verifyAndGetUid(req, checkRevoked);

            const userDoc = await firestore.collection('users').doc(uid).get();
            if (!userDoc.exists) {
                throw { message: 'Access Denied: User profile not found.', status: 403 };
            }

            const userData = userDoc.data();
            const userRole = userData.role;

            // --- RESOLVE TARGET OWNER ID ---
            const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
            const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
            const employeeOfOwnerId = url.searchParams.get('employee_of');
            const sessionExpiry = url.searchParams.get('session_expiry');

            let employeeAccessResult = null;
            let targetOwnerId = uid;
            let isImpersonating = false;
            let targetOwnerRole = null;
            let targetOwnerBusinessType = null;

            debugLog(`[verifyOwnerWithAudit] Auth check for UID: ${uid}, Role: ${userRole}`);

            if (userRole === 'admin' && impersonatedOwnerId) {
                if (sessionExpiry && isSessionExpired(parseInt(sessionExpiry, 10))) {
                    console.warn(`[verifyOwnerWithAudit] Impersonation session expired for admin ${uid}`);
                    throw { message: 'Impersonation session has expired. Please re-authenticate.', status: 401 };
                }
                targetOwnerId = impersonatedOwnerId;
                isImpersonating = true;

                // ── EPHEMERAL CACHE: avoid re-reading owner doc + business query ──
                const impCacheKey = `admin_imp:${uid}:${targetOwnerId}`;
                const cachedImpContext = getEphemeralCache(impCacheKey);
                if (cachedImpContext) {
                    debugLog(`[verifyOwnerWithAudit] Impersonation cache HIT for ${impCacheKey}`);
                    // Re-attach live admin data (email etc.) from current request
                    return {
                        ...cachedImpContext,
                        userData,
                        adminEmail: userData.email,
                        _impCacheHit: true,
                    };
                }

                // Use target owner's profile to resolve the correct business collection.
                const targetOwnerDoc = await firestore.collection('users').doc(targetOwnerId).get();
                if (targetOwnerDoc.exists) {
                    const targetOwnerData = targetOwnerDoc.data() || {};
                    targetOwnerRole = targetOwnerData.role || null;
                    targetOwnerBusinessType =
                        normalizeBusinessType(targetOwnerData.businessType) ||
                        getBusinessTypeFromRole(targetOwnerRole);
                }

                debugLog(`[verifyOwnerWithAudit] Admin impersonating owner: ${targetOwnerId}`);
            } else if (employeeOfOwnerId) {
                employeeAccessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, userData);
                if (!employeeAccessResult.authorized) {
                    console.warn(`[verifyOwnerWithAudit] Employee access denied: ${uid} for owner ${employeeOfOwnerId}`);
                    throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
                }
                targetOwnerId = employeeOfOwnerId;
                debugLog(`[verifyOwnerWithAudit] Employee access granted: ${uid} for owner ${targetOwnerId}`);
            } else {
                // For direct owner access, we check role BUT we'll have a fallback later if business exists
                const isKnownOwnerRole = OWNER_ROLES.has(userRole);
                if (!isKnownOwnerRole) {
                    debugLog(`[verifyOwnerWithAudit] UID ${uid} has role '${userRole}', checking business association fallback...`);
                }
            }

            // --- RESOLVE BUSINESS ---
            let resolvedBusinessDoc = null;
            let resolvedCollectionName = null;

            // Employee flow: lock to exact outlet from linkedOutlets to avoid shop/restaurant mix-ups.
            if (employeeOfOwnerId && employeeAccessResult?.outletId && employeeAccessResult?.collectionName) {
                const exactDoc = await firestore
                    .collection(employeeAccessResult.collectionName)
                    .doc(employeeAccessResult.outletId)
                    .get();

                if (exactDoc.exists && exactDoc.data()?.ownerId === targetOwnerId) {
                    resolvedBusinessDoc = exactDoc;
                    resolvedCollectionName = employeeAccessResult.collectionName;
                } else {
                    console.warn(
                        `[verifyOwnerWithAudit] Employee outlet mismatch for ${uid}. Falling back to ownerId lookup.`
                    );
                }
            }

            if (!resolvedBusinessDoc) {
                const roleForLookup = isImpersonating ? targetOwnerRole : userRole;
                const businessTypeForLookup = isImpersonating ? targetOwnerBusinessType : userData.businessType;
                const collectionsToTry = getPreferredCollections(roleForLookup, businessTypeForLookup);
                for (const collectionName of collectionsToTry) {
                    const querySnapshot = await firestore
                        .collection(collectionName)
                        .where('ownerId', '==', targetOwnerId)
                        .limit(1)
                        .get();

                    if (!querySnapshot.empty) {
                        resolvedBusinessDoc = querySnapshot.docs[0];
                        resolvedCollectionName = collectionName;
                        break;
                    }
                }
            }

            if (resolvedBusinessDoc && resolvedCollectionName) {
                // Determine callerRole
                let effectiveCallerRole = userRole;
                let effectiveCallerPermissions = [];
                if (isImpersonating) {
                    // FIX: When impersonating, the admin acts AS the owner.
                    // Downstream APIs check if (role === 'owner'), so we must return 'owner'.
                    effectiveCallerRole = 'owner';
                    effectiveCallerPermissions = Object.values(PERMISSIONS);
                } else if (employeeOfOwnerId && employeeAccessResult) {
                    effectiveCallerRole = employeeAccessResult.employeeRole || userRole;
                    // Prefer explicit per-employee permissions stored in linkedOutlets.
                    // Fallback to role defaults for backward compatibility.
                    effectiveCallerPermissions = (employeeAccessResult.permissions && employeeAccessResult.permissions.length > 0)
                        ? employeeAccessResult.permissions
                        : getPermissionsForRole(effectiveCallerRole);
                } else {
                    // For direct owner access, use getPermissionsForRole to properly flatten nested permissions
                    effectiveCallerPermissions = getPermissionsForRole(effectiveCallerRole);
                }

                // Normalize legacy role aliases (shop-owner/restaurant-owner/etc.)
                // so downstream APIs that check exact role strings remain consistent.
                effectiveCallerRole = normalizeRole(effectiveCallerRole);

                const context = {
                    uid: targetOwnerId,
                    businessId: resolvedBusinessDoc.id,
                    businessSnap: resolvedBusinessDoc,
                    collectionName: resolvedCollectionName,
                    isAdmin: userRole === 'admin',
                    isImpersonating,
                    userData,
                    callerRole: effectiveCallerRole,
                    callerPermissions: effectiveCallerPermissions,
                    adminId: isImpersonating ? uid : null,
                    adminEmail: isImpersonating ? userData.email : null
                };

                // ── CACHE impersonation context so parallel requests reuse it ──
                if (isImpersonating) {
                    const impCacheKey = `admin_imp:${uid}:${targetOwnerId}`;
                    setEphemeralCache(impCacheKey, context, IMPERSONATION_CACHE_TTL_MS);
                    debugLog(`[verifyOwnerWithAudit] Impersonation context cached for ${impCacheKey}`);
                }

                return context;
            }

            // If we reached here, no business was found
            const isKnownOwnerRole = OWNER_ROLES.has(userRole);
            if (!isKnownOwnerRole && !isImpersonating && !employeeOfOwnerId) {
                console.warn(`[verifyOwnerWithAudit] Access Denied for UID ${uid} (Role: ${userRole}, No business found)`);
                throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
            }

            console.warn(`[verifyOwnerWithAudit] No business found for Owner ID: ${targetOwnerId}`);
            throw { message: 'No business associated with this owner.', status: 404 };
        })();
    }

    // 2. AWAIT RESOLUTION
    let context; try { context = await req._ownerContextPromise; } catch (e) { require('fs').appendFileSync('audit_error_log.txt', (e.stack || e.message || JSON.stringify(e)) + '\n'); throw e; }

    // 2.5 OPTIONAL PERMISSION ENFORCEMENT
    if (requiredPermissions) {
        const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
        const callerPermissions = context.callerPermissions || [];
        const hasRequiredPermission = required.some((permission) => callerPermissions.includes(permission));

        if (!hasRequiredPermission) {
            throw {
                message: `Access Denied: Missing required permission (${required.join(' OR ')}).`,
                status: 403
            };
        }
    }

    const inferredFeatureId = inferFeatureIdFromAction(action, req);
    if (inferredFeatureId) {
        assertFeatureUnlocked(context, inferredFeatureId);
    }

    // 3. AUDIT LOGGING (Always run per check if impersonating)
    if (context.isImpersonating && action && !context._impCacheHit) {
        await logImpersonation({
            adminId: context.adminId,
            adminEmail: context.adminEmail,
            targetOwnerId: context.uid,
            action,
            metadata,
            ipAddress: getClientIP(req),
            userAgent: getUserAgent(req)
        });
    }

    return context;
}

export function assertFeatureUnlocked(context, featureId) {
    const lockedFeatures = Array.isArray(context?.businessSnap?.data?.()?.lockedFeatures)
        ? context.businessSnap.data().lockedFeatures
        : Array.isArray(context?.businessData?.lockedFeatures)
            ? context.businessData.lockedFeatures
            : [];

    if (lockedFeatures.includes(featureId)) {
        throw {
            message: 'This feature is locked for your account. Please contact support for more information.',
            status: 423,
        };
    }
}

export async function verifyOwnerFeatureAccess(req, featureId, action, metadata = {}, checkRevoked = true, requiredPermissions = null) {
    const context = await verifyOwnerWithAudit(req, action, metadata, checkRevoked, requiredPermissions);
    assertFeatureUnlocked(context, featureId);
    return context;
}

function inferFeatureIdFromAction(action, req) {
    if (ACTION_FEATURE_MAP[action]) {
        return ACTION_FEATURE_MAP[action];
    }

    const pathname = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`).pathname;
    if (pathname.includes('/api/owner/inventory/')) return 'inventory';
    if (pathname.includes('/api/owner/inventory')) return 'inventory';
    if (pathname.includes('/api/owner/waitlist')) return 'bookings';
    if (pathname.includes('/api/owner/bookings')) return 'bookings';
    if (pathname.includes('/api/owner/dine-in-tables') || pathname.includes('/api/owner/car-spots')) return 'dine-in';
    if (pathname.includes('/api/owner/service-requests') || pathname.includes('/api/owner/tables') || pathname.includes('/api/owner/cleanup-stale-tabs') || pathname.includes('/api/owner/dine-in-history')) return 'dine-in';
    if (pathname.includes('/api/owner/manual-tables') || pathname.includes('/api/owner/custom-bill')) return 'manual-order';
    if (pathname.includes('/api/owner/menu') || pathname.includes('/api/owner/open-items')) return 'menu';
    if (pathname.includes('/api/owner/menu-bulk')) return 'menu';
    if (pathname.includes('/api/owner/orders') || pathname.includes('/api/owner/refund')) return 'live-orders';
    if (pathname.includes('/api/owner/analytics')) return 'analytics';
    if (pathname.includes('/api/owner/dashboard-data')) return 'dashboard';
    if (pathname.includes('/api/owner/delivery') || pathname.includes('/api/owner/delivery-settings')) return 'delivery';
    if (pathname.includes('/api/owner/employees')) return 'employees';
    if (pathname.includes('/api/owner/customers')) return 'customers';
    if (pathname.includes('/api/owner/coupons')) return 'coupons';
    if (pathname.includes('/api/owner/whatsapp-direct') || pathname.includes('/api/owner/whatsapp-onboarding')) return 'whatsapp-direct';
    if (pathname.includes('/api/owner/connections') || pathname.includes('/api/owner/create-linked-account')) return 'connections';
    if (pathname.includes('/api/owner/locations')) return 'location';
    if (pathname.includes('/api/owner/settings')) return 'settings';
    if (pathname.includes('/api/owner/payouts')) return 'payouts';
    return null;
}

