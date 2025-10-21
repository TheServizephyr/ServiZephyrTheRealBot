
import { NextResponse } from 'next/server';
import { getFirestore, getAuth } from '@/lib/firebase-admin';

// Helper to verify admin role
async function verifyAdmin(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
        throw { message: 'Access Denied: You do not have admin privileges.', status: 403 };
    }
    return uid;
}

// POST: Save a new report
export async function POST(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const authHeader = req.headers.get('authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        
        const report = await req.json();

        // Basic validation
        if (!report || !report.errorTitle || !report.errorMessage || !report.pathname || !report.user) {
            return NextResponse.json({ message: 'Incomplete report data.' }, { status: 400 });
        }

        const newReportRef = firestore.collection('admin_mailbox').doc();
        await newReportRef.set({
            ...report,
            id: newReportRef.id,
            resolved: false, // Default status
            createdAt: new Date().toISOString(),
        });

        return NextResponse.json({ message: 'Report submitted successfully.', id: newReportRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST /api/admin/mailbox ERROR:", error);
        return NextResponse.json({ message: `Internal Server Error: ${error.message}` }, { status: 500 });
    }
}


// GET: Fetch all reports for the admin
export async function GET(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        await verifyAdmin(req, auth, firestore);

        const reportsSnap = await firestore.collection('admin_mailbox').orderBy('createdAt', 'desc').get();
        const reports = reportsSnap.docs.map(doc => doc.data());

        return NextResponse.json({ reports }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/mailbox ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}


// PATCH: Mark a report as resolved
export async function PATCH(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        await verifyAdmin(req, auth, firestore);

        const { reportId } = await req.json();
        if (!reportId) {
            return NextResponse.json({ message: 'Report ID is required.' }, { status: 400 });
        }

        const reportRef = firestore.collection('admin_mailbox').doc(reportId);
        await reportRef.update({ resolved: true });

        return NextResponse.json({ message: 'Report marked as resolved.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH /api/admin/mailbox ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

// DELETE: Delete a report
export async function DELETE(req) {
     try {
        const auth = getAuth();
        const firestore = getFirestore();
        await verifyAdmin(req, auth, firestore);

        const { reportId } = await req.json();
        if (!reportId) {
            return NextResponse.json({ message: 'Report ID is required.' }, { status: 400 });
        }

        const reportRef = firestore.collection('admin_mailbox').doc(reportId);
        await reportRef.delete();

        return NextResponse.json({ message: 'Report deleted successfully.' }, { status: 200 });

    } catch (error) {
        console.error("DELETE /api/admin/mailbox ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
