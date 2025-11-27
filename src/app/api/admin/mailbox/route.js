import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// GET all reports for the admin
export async function GET(req) {
    try {
        const firestore = await getFirestore();
        const mailboxRef = firestore.collection('adminMailbox');
        const snapshot = await mailboxRef.orderBy('timestamp', 'desc').get();

        const reports = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                timestamp: data.timestamp?.toDate?.()?.toISOString() || null
            };
        });

        return NextResponse.json({ reports }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/mailbox ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

// POST a new error report
export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { errorTitle, errorMessage, pathname, user } = await req.json();

        if (!errorTitle || !errorMessage || !pathname || !user) {
            return NextResponse.json({ message: 'Missing required report data.' }, { status: 400 });
        }

        const newReportRef = firestore.collection('adminMailbox').doc();

        const newReportData = {
            id: newReportRef.id,
            title: errorTitle,
            message: errorMessage,
            path: pathname,
            user: {
                uid: user.uid || 'N/A',
                email: user.email || 'N/A',
                name: user.displayName || 'N/A',
            },
            timestamp: FieldValue.serverTimestamp(),
            status: 'new', // new, in_progress, resolved
        };

        await newReportRef.set(newReportData);

        return NextResponse.json({ message: 'Error report sent successfully!', id: newReportRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST /api/admin/mailbox ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

// PATCH to update a report's status
export async function PATCH(req) {
    try {
        const { reportId, status } = await req.json();

        if (!reportId || !status) {
            return NextResponse.json({ message: 'Report ID and status are required.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const reportRef = firestore.collection('adminMailbox').doc(reportId);

        await reportRef.update({ status: status });

        return NextResponse.json({ message: 'Report status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH /api/admin/mailbox ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
