import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import {
  CAREER_JOBS_COLLECTION,
  sanitizeJobPayload,
  serializeJob,
  validateJobPayload,
} from '@/lib/career';

export const dynamic = 'force-dynamic';

export async function PATCH(req, { params }) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const adminContext = await verifyAdmin(req);

    const jobId = String(params?.jobId || '').trim();
    if (!jobId) {
      return NextResponse.json({ message: 'Job ID is required.' }, { status: 400 });
    }

    const payload = sanitizeJobPayload(await req.json());
    const errors = validateJobPayload(payload);
    if (errors.length > 0) {
      return NextResponse.json({ message: errors.join(' ') }, { status: 400 });
    }

    const firestore = await getFirestore();
    const jobRef = firestore.collection(CAREER_JOBS_COLLECTION).doc(jobId);
    const current = await jobRef.get();
    if (!current.exists) {
      return NextResponse.json({ message: 'Job not found.' }, { status: 404 });
    }

    await jobRef.set({
      ...payload,
      updatedBy: adminContext.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const saved = await jobRef.get();
    return NextResponse.json({ job: serializeJob(saved) }, { status: 200 });
  } catch (error) {
    console.error('PATCH /api/admin/career/jobs/[jobId] ERROR:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to update job.' },
      { status: error.status || 500 }
    );
  }
}

export async function DELETE(req, { params }) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const adminContext = await verifyAdmin(req);

    const jobId = String(params?.jobId || '').trim();
    if (!jobId) {
      return NextResponse.json({ message: 'Job ID is required.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const jobRef = firestore.collection(CAREER_JOBS_COLLECTION).doc(jobId);
    const current = await jobRef.get();
    if (!current.exists) {
      return NextResponse.json({ message: 'Job not found.' }, { status: 404 });
    }

    await jobRef.delete();

    return NextResponse.json({
      success: true,
      deletedBy: adminContext.uid,
    }, { status: 200 });
  } catch (error) {
    console.error('DELETE /api/admin/career/jobs/[jobId] ERROR:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to delete job.' },
      { status: error.status || 500 }
    );
  }
}
