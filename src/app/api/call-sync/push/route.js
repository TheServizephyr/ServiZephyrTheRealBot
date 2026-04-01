import { NextResponse } from 'next/server';

import { getDatabase, getFirestore } from '@/lib/firebase-admin';
import { buildActiveCallSyncPath, buildActiveCallSyncUserPath, normalizeIndianPhoneLoose } from '@/lib/call-sync';
import { getPermissionsForRole, PERMISSIONS } from '@/lib/permissions';

const BUSINESS_COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];
const ACTIVE_STATES = new Set(['ringing', 'incoming', 'offhook', 'idle', 'ended']);
const CALL_SYNC_LISTENER_PERMISSIONS = [
    PERMISSIONS.CREATE_ORDER,
    PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING,
];

async function resolveBusinessByCallSyncToken(firestore, token) {
    for (const collectionName of BUSINESS_COLLECTIONS) {
        const snap = await firestore
            .collection(collectionName)
            .where('callSyncToken', '==', token)
            .limit(1)
            .get();

        if (!snap.empty) {
            return {
                collectionName,
                businessId: snap.docs[0].id,
            };
        }
    }

    return null;
}

function canReceiveCallSync(memberData = {}) {
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

async function resolveCallSyncRecipients(firestore, target) {
    const businessRef = firestore.collection(target.collectionName).doc(target.businessId);
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

export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const token = String(body?.token || '').trim();
        const state = String(body?.state || 'ringing').trim().toLowerCase();
        const rawPhone = body?.phone;

        if (!token) {
            return NextResponse.json({ message: 'Call sync token is required.' }, { status: 400 });
        }

        if (!ACTIVE_STATES.has(state)) {
            return NextResponse.json({ message: 'Unsupported call state.' }, { status: 400 });
        }

        const normalizedPhone = normalizeIndianPhoneLoose(rawPhone);
        if (state === 'ringing' && normalizedPhone.length !== 10) {
            return NextResponse.json({ message: 'Valid caller phone is required for ringing state.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const target = await resolveBusinessByCallSyncToken(firestore, token);
        if (!target) {
            return NextResponse.json({ message: 'Invalid call sync token.' }, { status: 404 });
        }

        const { ownerId, recipients } = await resolveCallSyncRecipients(firestore, target);

        const rtdb = await getDatabase();
        const now = Date.now();
        const payload = {
            phone: normalizedPhone || '',
            state,
            timestampMs: now,
            updatedAt: now,
            deviceId: String(body?.deviceId || '').trim() || null,
            source: 'android_call_helper',
            businessId: target.businessId,
            collectionName: target.collectionName,
            ownerId: ownerId || null,
        };

        const updates = {
            [buildActiveCallSyncPath(target)]: payload,
        };

        for (const recipientUid of recipients) {
            updates[buildActiveCallSyncUserPath(recipientUid)] = payload;
        }

        await rtdb.ref().update(updates);
        console.log('[CallSyncPush] Fan-out recipients:', {
            businessId: target.businessId,
            collectionName: target.collectionName,
            ownerId: ownerId || null,
            recipients,
        });

        return NextResponse.json({
            ok: true,
            collectionName: target.collectionName,
            businessId: target.businessId,
            state,
            timestampMs: now,
            recipientCount: recipients.length,
            ...(process.env.NODE_ENV !== 'production' ? { recipients } : {}),
        });
    } catch (error) {
        console.error('[CallSyncPush] Failed to push call event:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to push call sync event.' },
            { status: 500 }
        );
    }
}
