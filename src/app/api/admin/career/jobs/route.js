import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import {
  CAREER_JOBS_COLLECTION,
  sanitizeJobPayload,
  serializeJob,
  validateJobPayload,
} from '@/lib/career';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    await verifyAdmin(req);

    const firestore = await getFirestore();
    const snapshot = await firestore
      .collection(CAREER_JOBS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .get();

    const jobs = snapshot.docs.map((doc) => serializeJob(doc));
    return NextResponse.json({ jobs }, { status: 200 });
  } catch (error) {
    console.error('GET /api/admin/career/jobs ERROR:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to load jobs.' },
      { status: error.status || 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const adminContext = await verifyAdmin(req);

    const payload = sanitizeJobPayload(await req.json());
    const errors = validateJobPayload(payload);
    if (errors.length > 0) {
      return NextResponse.json({ message: errors.join(' ') }, { status: 400 });
    }

    const firestore = await getFirestore();
    const docRef = await firestore.collection(CAREER_JOBS_COLLECTION).add({
      ...payload,
      applicationCount: 0,
      createdBy: adminContext.uid,
      updatedBy: adminContext.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const saved = await docRef.get();
    return NextResponse.json({ job: serializeJob(saved) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/admin/career/jobs ERROR:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to create job.' },
      { status: error.status || 500 }
    );
  }
}
