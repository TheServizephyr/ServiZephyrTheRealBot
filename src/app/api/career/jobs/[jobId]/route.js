import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { CAREER_JOBS_COLLECTION, serializeJob } from '@/lib/career';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  try {
    const jobId = String(params?.jobId || '').trim();
    if (!jobId) {
      return NextResponse.json({ message: 'Job ID is required.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const jobSnap = await firestore.collection(CAREER_JOBS_COLLECTION).doc(jobId).get();
    if (!jobSnap.exists) {
      return NextResponse.json({ message: 'Job not found.' }, { status: 404 });
    }

    return NextResponse.json({
      job: serializeJob(jobSnap, { publicOnly: true }),
    }, { status: 200 });
  } catch (error) {
    console.error('GET /api/career/jobs/[jobId] ERROR:', error);
    return NextResponse.json(
      { message: 'Failed to load career job.', error: error.message },
      { status: 500 }
    );
  }
}
