import { NextResponse } from 'next/server';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(req, 'view_owner_status', {}, false);
        const businessData = context?.businessSnap?.data?.() || {};

        return NextResponse.json({
            status: String(businessData.approvalStatus || 'pending').trim() || 'pending',
            restrictedFeatures: toArray(businessData.restrictedFeatures),
            lockedFeatures: toArray(businessData.lockedFeatures),
            suspensionRemark: String(businessData.suspensionRemark || ''),
        }, { status: 200 });
    } catch (error) {
        console.error('GET /api/owner/status ERROR:', error);
        return NextResponse.json(
            { message: error.message || 'Internal Server Error' },
            { status: error.status || 500 }
        );
    }
}
