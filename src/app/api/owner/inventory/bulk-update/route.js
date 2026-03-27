import { NextResponse } from 'next/server';
import { FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import {
    INVENTORY_COLLECTION,
    INVENTORY_LEDGER_COLLECTION,
    calculateAvailable,
    toFiniteNumber,
} from '@/lib/server/inventory';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'bulk_update_inventory',
            {},
            false,
            PERMISSIONS.EDIT_MENU
        );
        const { businessSnap, callerRole, uid, adminId } = context;
        const body = await req.json();
        const updates = Array.isArray(body?.updates) ? body.updates : [];

        if (updates.length === 0) {
            return NextResponse.json({ message: 'At least one bulk stock update is required.' }, { status: 400 });
        }

        const actorId = String(adminId || uid);
        const inventoryCollection = businessSnap.ref.collection(INVENTORY_COLLECTION);
        const ledgerCollection = businessSnap.ref.collection(INVENTORY_LEDGER_COLLECTION);

        const results = [];
        await businessSnap.ref.firestore.runTransaction(async (transaction) => {
            for (const update of updates) {
                const itemId = String(update?.itemId || '').trim();
                const stockOnHand = toFiniteNumber(update?.stockOnHand, NaN);
                if (!itemId || !Number.isFinite(stockOnHand) || stockOnHand < 0) {
                    throw { status: 400, message: 'Each bulk update needs a valid itemId and stockOnHand >= 0.' };
                }

                const inventoryRef = inventoryCollection.doc(itemId);
                const inventorySnap = await transaction.get(inventoryRef);
                if (!inventorySnap.exists) {
                    throw { status: 404, message: `Inventory item ${itemId} was not found.` };
                }

                const current = inventorySnap.data() || {};
                const reserved = toFiniteNumber(current.reserved, 0);
                const beforeOnHand = toFiniteNumber(current.stockOnHand, 0);
                const available = calculateAvailable(stockOnHand, reserved);
                const qtyDelta = stockOnHand - beforeOnHand;

                transaction.update(inventoryRef, {
                    stockOnHand,
                    available,
                    updatedAt: FieldValue.serverTimestamp(),
                    lastAdjustedAt: FieldValue.serverTimestamp(),
                    lastAdjustedBy: actorId,
                });

                transaction.set(ledgerCollection.doc(), {
                    itemId,
                    sku: current.sku || null,
                    name: current.name || null,
                    type: 'count_correction',
                    qtyDelta,
                    before: {
                        stockOnHand: beforeOnHand,
                        reserved,
                        available: toFiniteNumber(current.available, calculateAvailable(beforeOnHand, reserved)),
                    },
                    after: {
                        stockOnHand,
                        reserved,
                        available,
                    },
                    note: 'bulk_stock_update',
                    actorId,
                    actorRole: callerRole || 'owner',
                    createdAt: FieldValue.serverTimestamp(),
                });

                results.push({ itemId, stockOnHand, available });
            }
        });

        return NextResponse.json(
            { message: 'Bulk stock update completed.', updated: results.length, items: results },
            { status: 200 }
        );
    } catch (error) {
        console.error('[Inventory Bulk Update API] POST failed:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to run bulk stock update.' },
            { status: error.status || 500 }
        );
    }
}
