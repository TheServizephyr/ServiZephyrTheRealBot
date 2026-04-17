import { NextResponse } from 'next/server';

import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { resolveManualOrderVoiceWithAi } from '@/lib/server/manualOrderVoiceAi';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        await verifyOwnerFeatureAccess(
            req,
            'manual-order',
            'manual_order_voice_parse',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
        );

        const body = await req.json();
        const result = await resolveManualOrderVoiceWithAi({
            transcript: body?.transcript,
            currentMode: body?.currentMode,
            activeTableId: body?.activeTableId,
            explicitMode: body?.explicitMode,
            requestedTableReference: body?.requestedTableReference,
            unresolvedItems: body?.unresolvedItems,
            tableOptions: body?.tableOptions,
        });

        if (!result.ok) {
            return NextResponse.json(
                {
                    message: result.message || 'Voice parsing failed.',
                    fallbackAvailable: result.fallbackAvailable !== false,
                },
                { status: result.status || 500 }
            );
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error('[Manual Order Voice Parse] Error:', error);
        return NextResponse.json(
            { message: error?.message || 'Voice parsing failed.' },
            { status: error?.status || 500 }
        );
    }
}
