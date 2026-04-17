import { NextResponse } from 'next/server';

import { getDatabase } from '@/lib/firebase-admin';
import { clearCallSyncVoiceDraft, readCallSyncVoiceDraft } from '@/lib/server/callSyncVoiceDraft';
import { PERMISSIONS } from '@/lib/permissions';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';

async function resolveOwnerDraftContext(req) {
    const context = await verifyOwnerWithAudit(
        req,
        'custom_bill_create_order',
        {},
        true,
        [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
    );

    return {
        context,
        target: {
            businessId: context.businessId,
            collectionName: context.collectionName,
        },
    };
}

export async function GET(req) {
    try {
        const { target } = await resolveOwnerDraftContext(req);
        const rtdb = await getDatabase();
        const draft = await readCallSyncVoiceDraft(rtdb, target, target);

        return NextResponse.json({
            ok: true,
            draft,
        });
    } catch (error) {
        console.error('[OwnerCompanionDraft][GET] Failed:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to read companion draft.' },
            { status: error?.status || 500 }
        );
    }
}

export async function DELETE(req) {
    try {
        const { target } = await resolveOwnerDraftContext(req);
        const rtdb = await getDatabase();
        await clearCallSyncVoiceDraft(rtdb, target);

        return NextResponse.json({
            ok: true,
            cleared: true,
        });
    } catch (error) {
        console.error('[OwnerCompanionDraft][DELETE] Failed:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to clear companion draft.' },
            { status: error?.status || 500 }
        );
    }
}
