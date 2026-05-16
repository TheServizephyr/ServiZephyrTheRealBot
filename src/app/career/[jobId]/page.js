import { notFound } from 'next/navigation';
import { getFirestore } from '@/lib/firebase-admin';
import { CAREER_JOBS_COLLECTION, serializeJob } from '@/lib/career';
import JobDetailClient from './JobDetailClient';

export const dynamic = 'force-dynamic';

async function getPublicJob(jobId) {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) return null;

  const firestore = await getFirestore();
  const jobSnap = await firestore.collection(CAREER_JOBS_COLLECTION).doc(normalizedJobId).get();
  if (!jobSnap.exists) return null;

  return serializeJob(jobSnap, { publicOnly: true });
}

export async function generateMetadata({ params }) {
  const job = await getPublicJob(params?.jobId);
  if (!job) {
    return {
      title: 'Career Job | ServiZephyr',
    };
  }

  return {
    title: `${job.title} | ServiZephyr Careers`,
    description: job.summary || job.description || `Apply for ${job.title} at ServiZephyr.`,
  };
}

export default async function CareerJobPage({ params }) {
  const job = await getPublicJob(params?.jobId);
  if (!job) notFound();

  return <JobDetailClient job={job} />;
}
