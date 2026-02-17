import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import { getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export async function GET(req) {
    try {
        const { businessSnap } = await verifyOwnerWithAudit(
            req,
            'read_open_items',
            { resource: 'manual_billing' },
            false,
            PERMISSIONS.MANUAL_BILLING.READ
        );

        if (!businessSnap?.exists) {
            return NextResponse.json({ error: 'Business not found' }, { status: 404 });
        }

        const openItems = businessSnap.data()?.openItems || [];
        return NextResponse.json({ items: openItems });
    } catch (error) {
        console.error('[GET /api/owner/open-items]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch open items' },
            { status: error.status || 500 }
        );
    }
}

export async function POST(req) {
    try {
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'create_open_item',
            { resource: 'manual_billing' },
            false,
            PERMISSIONS.MANUAL_BILLING.WRITE
        );

        const body = await req.json();
        const { name, price } = body;

        if (!name?.trim()) {
            return NextResponse.json(
                { error: 'Item name is required' },
                { status: 400 }
            );
        }

        const itemPrice = parseFloat(price);
        if (!Number.isFinite(itemPrice) || itemPrice <= 0) {
            return NextResponse.json(
                { error: 'Price must be a positive number' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();
        const newItem = {
            id: `open-item-${Date.now()}`,
            name: name.trim(),
            price: itemPrice,
            createdAt: new Date(),
        };

        const businessRef = firestore.collection(collectionName).doc(businessId);
        const businessSnap = await businessRef.get();
        if (!businessSnap.exists) {
            return NextResponse.json({ error: 'Business not found' }, { status: 404 });
        }

        await businessRef.update({
            openItems: admin.firestore.FieldValue.arrayUnion(newItem),
        });

        return NextResponse.json({ item: newItem }, { status: 201 });
    } catch (error) {
        console.error('[POST /api/owner/open-items]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create open item' },
            { status: error.status || 500 }
        );
    }
}

export async function DELETE(req) {
    try {
        const { businessId, collectionName } = await verifyOwnerWithAudit(
            req,
            'delete_open_item',
            { resource: 'manual_billing' },
            false,
            PERMISSIONS.MANUAL_BILLING.WRITE
        );

        const body = await req.json();
        const { itemId } = body;

        if (!itemId) {
            return NextResponse.json(
                { error: 'Item ID is required' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();
        const businessRef = firestore.collection(collectionName).doc(businessId);
        const businessSnap = await businessRef.get();
        if (!businessSnap.exists) {
            return NextResponse.json({ error: 'Business not found' }, { status: 404 });
        }

        const openItems = businessSnap.data()?.openItems || [];
        const itemToDelete = openItems.find(item => item.id === itemId);

        if (!itemToDelete) {
            return NextResponse.json(
                { error: 'Item not found' },
                { status: 404 }
            );
        }

        await businessRef.update({
            openItems: admin.firestore.FieldValue.arrayRemove(itemToDelete),
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[DELETE /api/owner/open-items]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete open item' },
            { status: error.status || 500 }
        );
    }
}
