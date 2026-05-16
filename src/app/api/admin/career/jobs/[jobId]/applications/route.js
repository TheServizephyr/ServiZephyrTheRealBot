import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { CAREER_JOBS_COLLECTION, serializeApplication, serializeJob } from '@/lib/career';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    await verifyAdmin(req);

    const jobId = String(params?.jobId || '').trim();
    if (!jobId) {
      return NextResponse.json({ message: 'Job ID is required.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const jobRef = firestore.collection(CAREER_JOBS_COLLECTION).doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      return NextResponse.json({ message: 'Job not found.' }, { status: 404 });
    }

    const applicationsSnap = await jobRef
      .collection('applications')
      .orderBy('createdAt', 'desc')
      .get();

    return NextResponse.json({
      job: serializeJob(jobSnap),
      applications: applicationsSnap.docs.map((doc) => serializeApplication(doc)),
    }, { status: 200 });
  } catch (error) {
    console.error('GET /api/admin/career/jobs/[jobId]/applications ERROR:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to load applications.' },
      { status: error.status || 500 }
    );
  }
}
