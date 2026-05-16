import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { CAREER_JOBS_COLLECTION, serializeJob } from '@/lib/career';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const firestore = await getFirestore();
    const snapshot = await firestore
      .collection(CAREER_JOBS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .get();

    const now = new Date();
    const jobs = snapshot.docs.map((doc) => serializeJob(doc, { publicOnly: true, now }));

    return NextResponse.json({
      jobs,
      categories: Array.from(new Set(jobs.map((job) => job.category).filter(Boolean))).sort(),
      educationTags: Array.from(new Set(jobs.flatMap((job) => job.educationTags || []))).sort(),
      skillTags: Array.from(new Set(jobs.flatMap((job) => job.skillTags || []))).sort(),
    }, { status: 200 });
  } catch (error) {
    console.error('GET /api/career/jobs ERROR:', error);
    return NextResponse.json(
      { message: 'Failed to load career jobs.', error: error.message },
      { status: 500 }
    );
  }
}
