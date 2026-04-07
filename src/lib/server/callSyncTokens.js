import { createHash } from 'crypto';

import { FieldValue } from '@/lib/firebase-admin';
import { getPermissionsForRole, PERMISSIONS } from '@/lib/permissions';

export const CALL_SYNC_TOKENS_COLLECTION = 'call_sync_tokens';
const CALL_SYNC_LISTENER_PERMISSIONS = [
    PERMISSIONS.CREATE_ORDER,
    PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING,
];

export function hashCallSyncToken(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return '';
    return createHash('sha256').update(normalized).digest('hex');
}

export function getCallSyncTokenDocRef(firestore, token) {
    const tokenHash = hashCallSyncToken(token);
    if (!tokenHash) return null;
    return firestore.collection(CALL_SYNC_TOKENS_COLLECTION).doc(tokenHash);
}

export function canReceiveCallSync(memberData = {}) {
    const explicitPermissions = Array.isArray(memberData?.permissions)
        ? memberData.permissions.filter(Boolean)
        : [];
    const customAllowedPages = Array.isArray(memberData?.customAllowedPages)
        ? memberData.customAllowedPages.map((page) => String(page || '').trim().toLowerCase()).filter(Boolean)
        : [];
    const effectivePermissions = explicitPermissions.length > 0
        ? explicitPermissions
        : getPermissionsForRole(memberData?.role);

    if (CALL_SYNC_LISTENER_PERMISSIONS.some((permission) => effectivePermissions.includes(permission))) {
        return true;
    }

    return customAllowedPages.includes('manual-order');
}

export async function resolveCallSyncRecipientsForBusinessRef(businessRef) {
    const businessSnap = await businessRef.get();
    if (!businessSnap.exists) {
        return {
            businessData: null,
            ownerId: '',
            recipients: [],
        };
    }

    const businessData = businessSnap.data() || {};
    const ownerId = String(businessData?.ownerId || '').trim();
    const recipients = new Set();

    if (ownerId) {
        recipients.add(ownerId);
    }

    const employeesSnap = await businessRef.collection('employees').get();
    for (const employeeDoc of employeesSnap.docs) {
        const employeeData = employeeDoc.data() || {};
        const status = String(employeeData?.status || 'active').trim().toLowerCase();
        if (status !== 'active') continue;

        const employeeUid = String(employeeDoc.id || employeeData?.userId || '').trim();
        if (!employeeUid) continue;
        if (!canReceiveCallSync(employeeData)) continue;
        recipients.add(employeeUid);
    }

    return {
        businessData,
        ownerId,
        recipients: Array.from(recipients),
    };
}

export async function upsertCallSyncTokenBindingForBusinessRef(firestore, {
    token,
    businessRef,
    collectionName,
    businessId,
}) {
    const tokenRef = getCallSyncTokenDocRef(firestore, token);
    if (!tokenRef) {
        throw new Error('Call sync token is required.');
    }

    const resolvedCollectionName = String(collectionName || businessRef?.parent?.id || '').trim();
    const resolvedBusinessId = String(businessId || businessRef?.id || '').trim();
    if (!resolvedCollectionName || !resolvedBusinessId || !businessRef) {
        throw new Error('Business reference is required for call sync binding.');
    }

    const { ownerId, recipients } = await resolveCallSyncRecipientsForBusinessRef(businessRef);

    await tokenRef.set({
        tokenHash: tokenRef.id,
        collectionName: resolvedCollectionName,
        businessId: resolvedBusinessId,
        ownerId: ownerId || '',
        recipients,
        recipientCount: recipients.length,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
        tokenHash: tokenRef.id,
        collectionName: resolvedCollectionName,
        businessId: resolvedBusinessId,
        ownerId: ownerId || '',
        recipients,
    };
}
