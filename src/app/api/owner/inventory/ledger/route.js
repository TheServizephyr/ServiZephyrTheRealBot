import { NextResponse } from 'next/server';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { INVENTORY_LEDGER_COLLECTION } from '@/lib/server/inventory';

export const dynamic = 'force-dynamic';

const serializeTimestamp = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') {
        return value.toDate().toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'view_inventory_ledger',
            {},
            false,
            PERMISSIONS.VIEW_MENU
        );
        const { businessSnap } = context;

        const { searchParams } = new URL(req.url);
        const limitParam = Number(searchParams.get('limit') || 50);
        const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

        const snapshot = await businessSnap.ref
            .collection(INVENTORY_LEDGER_COLLECTION)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const entries = snapshot.docs.map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                ...data,
                createdAt: serializeTimestamp(data.createdAt),
            };
        });

        return NextResponse.json({ entries }, { status: 200 });
    } catch (error) {
        console.error('[Inventory Ledger API] GET failed:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to load inventory ledger.' },
            { status: error.status || 500 }
        );
    }
}
