/**
 * Common Helper for Admin Impersonation with Audit Logging
 * This helper can be imported and used across all owner API routes
 */

import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { logImpersonation, getClientIP, getUserAgent, isSessionExpired } from '@/lib/audit-logger';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';

/**
 * Verify owner/admin and get business with audit logging support
 * This is a common helper that can be used across all owner API routes
 * 
 * @param {Request} req - Next.js request object
 * @param {string} action - Action being performed (e.g., 'view_orders', 'update_settings')
 * @param {Object} metadata - Additional metadata to log (optional)
 * @returns {Object} - { uid, businessId, businessSnap, collectionName, isAdmin, isImpersonating }
 */
/**
 * Verify owner/admin and get business with audit logging support
 * This is a common helper that can be used across all owner API routes
 * 
 * @param {Request} req - Next.js request object
 * @param {string} action - Action being performed (e.g., 'view_orders', 'update_settings')
 * @param {Object} metadata - Additional metadata to log (optional)
 * @returns {Object} - { uid, businessId, businessSnap, collectionName, isAdmin, isImpersonating }
 */
export async function verifyOwnerWithAudit(req, action, metadata = {}, checkRevoked = false) {
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

            console.log(`[verifyOwnerWithAudit] Auth check for UID: ${uid}, Role: ${userRole}`);

            if (userRole === 'admin' && impersonatedOwnerId) {
                if (sessionExpiry && isSessionExpired(parseInt(sessionExpiry))) {
                    console.warn(`[verifyOwnerWithAudit] Impersonation session expired for admin ${uid}`);
                    throw { message: 'Impersonation session has expired. Please re-authenticate.', status: 401 };
                }
                targetOwnerId = impersonatedOwnerId;
                isImpersonating = true;
                console.log(`[verifyOwnerWithAudit] Admin impersonating owner: ${targetOwnerId}`);
            } else if (employeeOfOwnerId) {
                employeeAccessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, userData);
                if (!employeeAccessResult.authorized) {
                    console.warn(`[verifyOwnerWithAudit] Employee access denied: ${uid} for owner ${employeeOfOwnerId}`);
                    throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
                }
                targetOwnerId = employeeOfOwnerId;
                console.log(`[verifyOwnerWithAudit] Employee access granted: ${uid} for owner ${targetOwnerId}`);
            } else {
                // For direct owner access, we check role BUT we'll have a fallback later if business exists
                const isKnownOwnerRole = ['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole);
                if (!isKnownOwnerRole) {
                    console.log(`[verifyOwnerWithAudit] UID ${uid} has role '${userRole}', checking business association fallback...`);
                }
            }

            // --- RESOLVE BUSINESS ---
            const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
            for (const collectionName of collectionsToTry) {
                const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
                if (!querySnapshot.empty) {
                    const doc = querySnapshot.docs[0];

                    // Determine callerRole
                    let effectiveCallerRole = userRole;
                    if (isImpersonating) {
                        // FIX: When impersonating, the admin acts AS the owner.
                        // Downstream APIs check if (role === 'owner'), so we must return 'owner'.
                        effectiveCallerRole = 'owner';
                    } else if (employeeOfOwnerId && employeeAccessResult) {
                        effectiveCallerRole = employeeAccessResult.employeeRole || userRole;
                    }

                    return {
                        uid: targetOwnerId,
                        businessId: doc.id,
                        businessSnap: doc,
                        collectionName,
                        isAdmin: userRole === 'admin',
                        isImpersonating,
                        userData,
                        callerRole: effectiveCallerRole,
                        adminId: isImpersonating ? uid : null,
                        adminEmail: isImpersonating ? userData.email : null
                    };
                }
            }

            // If we reached here, no business was found
            const isKnownOwnerRole = ['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole);
            if (!isKnownOwnerRole && !isImpersonating && !employeeOfOwnerId) {
                console.warn(`[verifyOwnerWithAudit] Access Denied for UID ${uid} (Role: ${userRole}, No business found)`);
                throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
            }

            console.warn(`[verifyOwnerWithAudit] No business found for Owner ID: ${targetOwnerId}`);
            throw { message: 'No business associated with this owner.', status: 404 };
        })();
    }

    // 2. AWAIT RESOLUTION
    const context = await req._ownerContextPromise;

    // 3. AUDIT LOGGING (Always run per check if impersonating)
    if (context.isImpersonating && action) {
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
