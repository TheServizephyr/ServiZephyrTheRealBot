import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function PUT(req, { params }) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'manual_tables_update',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
        );

        const { businessId, collectionName } = context;
        const firestore = await getFirestore();
        const body = await req.json();
        const { tableId } = params;

        const action = String(body?.action || '').trim().toLowerCase();
        
        const tableRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('manual_tables')
            .doc(tableId);

        return await firestore.runTransaction(async (transaction) => {
            const tableSnap = await transaction.get(tableRef);
            if (!tableSnap.exists) {
                // If the user wants to return a NextResponse here, it must be thrown and caught or handled correctly.
                // runTransaction expects a promise return, we can return the response.
                return NextResponse.json({ message: 'Table not found.' }, { status: 404 });
            }

            const tableData = tableSnap.data();

            if (action === 'occupy') {
                const currentOrder = body?.currentOrder;
                if (!currentOrder) {
                    return NextResponse.json({ message: 'Order details required to occupy table.' }, { status: 400 });
                }

                transaction.update(tableRef, {
                    status: 'occupied',
                    currentOrder: currentOrder,
                    updatedAt: FieldValue.serverTimestamp()
                });

                return NextResponse.json({ message: 'Table occupied/updated successfully.' }, { status: 200 });

            } else if (action === 'finalize') {
                if (tableData.status !== 'occupied' || !tableData.currentOrder) {
                    return NextResponse.json({ message: 'Table must be occupied with an active order to finalize.' }, { status: 400 });
                }
                transaction.update(tableRef, {
                    'currentOrder.isFinalized': true,
                    'currentOrder.finalizedAt': new Date().toISOString(),
                    updatedAt: FieldValue.serverTimestamp()
                });
                return NextResponse.json({ message: 'Order finalized. Table is now locked for edits.' }, { status: 200 });

            } else if (action === 'free') {
                transaction.update(tableRef, {
                    status: 'available',
                    currentOrder: null,
                    updatedAt: FieldValue.serverTimestamp()
                });

                return NextResponse.json({ message: 'Table freed successfully.' }, { status: 200 });

            } else if (action === 'delete') {
                if (tableData.status === 'occupied') {
                    return NextResponse.json({ message: 'Cannot delete an occupied table.' }, { status: 400 });
                }
                transaction.delete(tableRef);
                return NextResponse.json({ message: 'Table deleted successfully.' }, { status: 200 });
            }

            return NextResponse.json({ message: 'Invalid action.' }, { status: 400 });
        });

    } catch (error) {
        console.error('[Manual Tables][PUT] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}
