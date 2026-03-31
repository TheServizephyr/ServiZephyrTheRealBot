import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';

import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { FieldValue } from '@/lib/firebase-admin';
import { PERMISSIONS } from '@/lib/permissions';

const buildCallSyncToken = () => randomBytes(18).toString('base64url');

export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const rotate = body?.rotate === true;

        const context = await verifyOwnerWithAudit(
            req,
            'manage_call_sync_token',
            { rotate },
            true,
            [PERMISSIONS.MANAGE_SETTINGS, PERMISSIONS.MANAGE_OUTLET_SETTINGS]
        );

        const businessRef = context.businessSnap.ref;
        const businessData = context.businessSnap.data() || {};
        const existingToken = String(businessData.callSyncToken || '').trim();
        const nextToken = (!existingToken || rotate) ? buildCallSyncToken() : existingToken;

        if (nextToken !== existingToken) {
            await businessRef.set({
                callSyncToken: nextToken,
                callSyncTokenUpdatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
        }

        return NextResponse.json({
            ok: true,
            callSyncToken: nextToken,
            businessId: context.businessId,
            collectionName: context.collectionName,
            rotated: rotate && nextToken !== existingToken,
        });
    } catch (error) {
        console.error('[CallSyncToken] Failed to issue token:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to issue call sync token.' },
            { status: error?.status || 500 }
        );
    }
}
