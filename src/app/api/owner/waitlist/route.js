
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'view_waitlist',
            {},
            false,
            PERMISSIONS.VIEW_DINE_IN // Assuming same permission level as dine-in
        );
        const { businessId } = context;
        const firestore = await getFirestore();
        const url = new URL(req.url);
        const isHistory = url.searchParams.get('history') === 'true';

        // Fetch waitlist entries for this restaurant
        // Structured as sub-collection for scalability and isolation
        let queryRef = firestore.collection('restaurants').doc(businessId).collection('waitlist');

        if (isHistory) {
            queryRef = queryRef.where('status', 'in', ['seated', 'cancelled']);
        } else {
            queryRef = queryRef.where('status', 'in', ['pending', 'notified']);
        }

        const waitlistSnap = await queryRef.get();

        const entries = waitlistSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().toISOString() : doc.data().createdAt
        }));

        // Sort in memory to avoid needing a composite index
        entries.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateA - dateB;
        });

        return NextResponse.json({ entries }, { status: 200 });

    } catch (error) {
        console.error("GET OWNER WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'update_waitlist_entry',
            {},
            false,
            PERMISSIONS.MANAGE_DINE_IN
        );
        const { businessId } = context;
        const firestore = await getFirestore();
        const { entryId, status } = await req.json();

        if (!entryId || !status) {
            return NextResponse.json({ message: 'Entry ID and status are required.' }, { status: 400 });
        }

        const allowedStatuses = ['pending', 'notified', 'seated', 'cancelled'];
        if (!allowedStatuses.includes(status)) {
            return NextResponse.json({ message: 'Invalid status.' }, { status: 400 });
        }

        const entryRef = firestore.collection('restaurants').doc(businessId).collection('waitlist').doc(entryId);
        const entrySnap = await entryRef.get();

        if (!entrySnap.exists) {
            return NextResponse.json({ message: 'Waitlist entry not found.' }, { status: 404 });
        }

        await entryRef.update({
            status,
            updatedAt: FieldValue.serverTimestamp()
        });

        return NextResponse.json({ message: `Status updated to ${status}` }, { status: 200 });

    } catch (error) {
        console.error("PATCH OWNER WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
