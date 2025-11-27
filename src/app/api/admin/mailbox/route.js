
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid, getAuth } from '@/lib/firebase-admin';

// Helper to verify if the user is an admin
async function verifyAdmin(req, auth) {
    const uid = await verifyAndGetUid(req); // Use the central helper first
    const userRecord = await auth.getUser(uid);
    
    if (userRecord.customClaims && userRecord.customClaims.isAdmin === true) {
        return uid;
    }
    
    // If the claim is not present, deny access.
    throw { message: 'Access Denied: You do not have admin privileges.', status: 403 };
}

// GET all reports for the admin
export async function GET(req) {
    try {
        const auth = await getAuth();
        await verifyAdmin(req, auth);
        
        const firestore = await getFirestore();
        const mailboxRef = firestore.collection('adminMailbox');
        const snapshot = await mailboxRef.orderBy('timestamp', 'desc').get();
        
        const reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
        const auth = await getAuth();
        await verifyAdmin(req, auth);
        
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
