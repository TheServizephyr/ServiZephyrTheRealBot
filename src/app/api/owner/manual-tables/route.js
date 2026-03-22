import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'manual_tables_list',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
        );

        const { businessId, collectionName } = context;
        const firestore = await getFirestore();

        const tablesRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('manual_tables');

        const snapshot = await tablesRef.orderBy('createdAt', 'desc').get();
        const tables = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            tables.push({
                id: doc.id,
                name: data.name || doc.id,
                status: data.status || 'available',
                currentOrder: data.currentOrder || null,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
            });
        });

        return NextResponse.json({ tables });
    } catch (error) {
        console.error('[Manual Tables][GET] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'manual_tables_create',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER, PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING]
        );

        const { businessId, collectionName } = context;
        const firestore = await getFirestore();
        const body = await req.json();

        const tableName = String(body?.name || '').trim();
        if (!tableName) {
            return NextResponse.json({ message: 'Table name is required.' }, { status: 400 });
        }

        const tablesRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('manual_tables');

        const allTablesSnap = await tablesRef.get();
        let exists = false;
        allTablesSnap.forEach(doc => {
            if (String(doc.data().name || '').toLowerCase() === tableName.toLowerCase()) {
                exists = true;
            }
        });

        if (exists) {
            return NextResponse.json({ message: 'Table with this name already exists.' }, { status: 400 });
        }

        const docRef = tablesRef.doc();
        const newTable = {
            name: tableName,
            status: 'available',
            currentOrder: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        await docRef.set(newTable);

        return NextResponse.json({
            message: 'Manual table created.',
            tableId: docRef.id,
        }, { status: 201 });
    } catch (error) {
        console.error('[Manual Tables][POST] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}
