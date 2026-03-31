import { NextResponse } from 'next/server';

import { getDatabase } from '@/lib/firebase-admin';
import { buildActiveCallSyncPath } from '@/lib/call-sync';
import { PERMISSIONS } from '@/lib/permissions';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_create_order',
            {},
            true,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
        );

        const rtdb = await getDatabase();
        const path = buildActiveCallSyncPath({
            businessId: context.businessId,
            collectionName: context.collectionName,
        });

        const snapshot = await rtdb.ref(path).get();
        const payload = snapshot.exists() ? snapshot.val() : null;

        return NextResponse.json({
            ok: true,
            callSyncTarget: {
                businessId: context.businessId,
                collectionName: context.collectionName,
            },
            activeCall: payload,
        });
    } catch (error) {
        console.error('[OwnerCallSyncActive] Failed to read active call:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to load active call state.' },
            { status: error?.status || 500 }
        );
    }
}
