import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

/**
 * Verify if the request is from an authenticated Admin.
 * 
 * @param {Request} req - Next.js Request object
 * @returns {Promise<Object>} - The user document data if admin, throws error otherwise.
 */
export async function verifyAdmin(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();

    // STRICT ACCOUNT STATUS CHECK - blocked or deleted accounts can never access admin
    if (userData.status === 'Blocked' || userData.blocked === true || userData.isDeleted === true) {
        throw { message: 'Access Denied: Account is blocked or deactivated.', status: 403 };
    }

    // STRICT ADMIN CHECK
    if (userData.role !== 'admin' && userData.isAdmin !== true) {
        throw { message: 'Access Denied: Admins only.', status: 403 };
    }

    // Check against configured admin whitelist if configured
    try {
        const adminConfigSnap = await firestore.collection('admins').doc('servizephyr').get();
        if (adminConfigSnap.exists) {
            const adminConfig = adminConfigSnap.data() || {};
            const configuredAdminIds = Array.isArray(adminConfig.adminUserIds)
                ? adminConfig.adminUserIds.map((id) => String(id || '').trim()).filter(Boolean)
                : [];

            if (configuredAdminIds.length > 0 && !configuredAdminIds.includes(uid)) {
                throw { message: 'Access Denied: UID not in authorized admin registry.', status: 403 };
            }
        }
    } catch (configErr) {
        if (configErr.status === 403) throw configErr;
        // If firestore read fails for config, rely on strict user doc check above
    }

    return { uid, userData };
}
