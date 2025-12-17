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
export async function verifyOwnerWithAudit(req, action, metadata = {}) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const sessionExpiry = url.searchParams.get('session_expiry');

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    let isImpersonating = false;

    // --- ADMIN IMPERSONATION ---
    if (userRole === 'admin' && impersonatedOwnerId) {
        // Validate session expiry
        if (sessionExpiry && isSessionExpired(parseInt(sessionExpiry))) {
            throw { message: 'Impersonation session has expired. Please re-authenticate.', status: 401 };
        }

        targetOwnerId = impersonatedOwnerId;
        isImpersonating = true;

        // Log the impersonation action
        await logImpersonation({
            adminId: uid,
            adminEmail: userData.email,
            targetOwnerId: impersonatedOwnerId,
            action,
            metadata,
            ipAddress: getClientIP(req),
            userAgent: getUserAgent(req)
        });
    }
    // --- EMPLOYEE ACCESS (SECURE) ---
    else if (employeeOfOwnerId) {
        const accessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, userData);
        if (!accessResult.authorized) {
            console.warn(`[SECURITY] Blocked unauthorized employee_of access: ${uid} -> ${employeeOfOwnerId}`);
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        console.log(`[API Employee Access] ${uid} (${accessResult.employeeRole}) accessing ${employeeOfOwnerId}'s data for ${action}`);
        targetOwnerId = employeeOfOwnerId;
    }
    // --- OWNER ACCESS ---
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const querySnapshot = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!querySnapshot.empty) {
            const doc = querySnapshot.docs[0];
            return {
                uid: targetOwnerId,
                businessId: doc.id,
                businessSnap: doc,
                collectionName,
                isAdmin: userRole === 'admin',
                isImpersonating,
                adminId: isImpersonating ? uid : null,
                adminEmail: isImpersonating ? userData.email : null
            };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}
