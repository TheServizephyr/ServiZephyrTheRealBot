import { NextResponse } from 'next/server';

import { getDatabase, getFirestore } from '@/lib/firebase-admin';
import { buildActiveCallSyncPath, normalizeIndianPhoneLoose } from '@/lib/call-sync';

const BUSINESS_COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];
const ACTIVE_STATES = new Set(['ringing', 'incoming', 'offhook', 'idle', 'ended']);

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

        const rtdb = await getDatabase();
        const path = buildActiveCallSyncPath(target);
        const now = Date.now();

        await rtdb.ref(path).set({
            phone: normalizedPhone || '',
            state,
            timestampMs: now,
            updatedAt: now,
            deviceId: String(body?.deviceId || '').trim() || null,
            source: 'android_call_helper',
        });

        return NextResponse.json({
            ok: true,
            collectionName: target.collectionName,
            businessId: target.businessId,
            state,
            timestampMs: now,
        });
    } catch (error) {
        console.error('[CallSyncPush] Failed to push call event:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to push call sync event.' },
            { status: 500 }
        );
    }
}
