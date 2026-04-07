import { NextResponse } from 'next/server';

import { getDatabase, getFirestore } from '@/lib/firebase-admin';
import { buildActiveCallSyncPath, buildActiveCallSyncUserPath, normalizeIndianPhoneLoose } from '@/lib/call-sync';
import { getCallSyncTokenDocRef, upsertCallSyncTokenBindingForBusinessRef } from '@/lib/server/callSyncTokens';

const BUSINESS_COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];
const ACTIVE_STATES = new Set(['ringing', 'incoming', 'offhook', 'idle', 'ended']);

async function resolveBusinessByCallSyncTokenLegacy(firestore, token) {
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
                businessRef: snap.docs[0].ref,
            };
        }
    }

    return null;
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
        const tokenRef = getCallSyncTokenDocRef(firestore, token);
        let tokenSnap = tokenRef ? await tokenRef.get() : null;
        let target = tokenSnap?.exists ? (tokenSnap.data() || {}) : null;

        if ((!target?.businessId || !target?.collectionName) && tokenRef) {
            const legacyTarget = await resolveBusinessByCallSyncTokenLegacy(firestore, token);
            if (legacyTarget?.businessRef) {
                await upsertCallSyncTokenBindingForBusinessRef(firestore, {
                    token,
                    businessRef: legacyTarget.businessRef,
                    collectionName: legacyTarget.collectionName,
                    businessId: legacyTarget.businessId,
                });
                tokenSnap = await tokenRef.get();
                target = tokenSnap?.exists ? (tokenSnap.data() || {}) : null;
            }
        }

        if (!target?.businessId || !target?.collectionName) {
            return NextResponse.json({ message: 'Invalid call sync token.' }, { status: 404 });
        }

        const ownerId = String(target?.ownerId || '').trim();
        const recipients = Array.isArray(target?.recipients)
            ? target.recipients.map((uid) => String(uid || '').trim()).filter(Boolean)
            : (ownerId ? [ownerId] : []);
        if (recipients.length === 0) {
            return NextResponse.json({ message: 'Call sync token has no active recipients.' }, { status: 409 });
        }

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
            collectionName: String(target.collectionName),
            businessId: String(target.businessId),
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
