import { FieldValue, getFirestore } from '@/lib/firebase-admin';

export const DERIVED_JOBS_COLLECTION = 'system_jobs';
export const FAILED_JOBS_COLLECTION = 'failed_jobs';

function sanitizeJobKey(jobKey) {
  return String(jobKey || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '_')
    .slice(0, 180);
}

function buildJobDocumentId(jobKey) {
  const safeKey = sanitizeJobKey(jobKey);
  if (!safeKey) {
    throw new Error('Job key is required.');
  }
  return safeKey;
}

export async function enqueueDerivedJob({
  type,
  jobKey,
  payload = {},
  maxAttempts = 5,
  availableAt = null,
} = {}) {
  const firestore = await getFirestore();
  const safeType = String(type || '').trim();
  if (!safeType) throw new Error('Job type is required.');

  const docId = buildJobDocumentId(jobKey || `${safeType}:${Date.now()}`);
  const jobRef = firestore.collection(DERIVED_JOBS_COLLECTION).doc(docId);

  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(jobRef);
    if (existing.exists) {
      const data = existing.data() || {};
      const status = String(data.status || '').toLowerCase();
      if (['queued', 'processing', 'retry'].includes(status)) {
        return;
      }
    }

    transaction.set(jobRef, {
      id: docId,
      type: safeType,
      jobKey: docId,
      payload,
      status: 'queued',
      attempts: 0,
      maxAttempts: Math.max(1, Number(maxAttempts) || 5),
      availableAt: availableAt || new Date(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { id: docId, type: safeType };
}

export async function listProcessableDerivedJobs(limit = 20) {
  const firestore = await getFirestore();
  const snap = await firestore
    .collection(DERIVED_JOBS_COLLECTION)
    .where('status', '==', 'queued')
    .limit(Math.max(1, Number(limit) || 20))
    .get();

  const now = Date.now();
  return snap.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, ...(doc.data() || {}) }))
    .filter((job) => {
      const availableAt = typeof job?.availableAt?.toDate === 'function'
        ? job.availableAt.toDate()
        : new Date(job?.availableAt || 0);
      return !availableAt || Number.isNaN(availableAt.getTime()) || availableAt.getTime() <= now;
    });
}

export async function markDerivedJobProcessing(jobRef) {
  await jobRef.set({
    status: 'processing',
    processingStartedAt: new Date(),
    updatedAt: new Date(),
  }, { merge: true });
}

export async function completeDerivedJob(jobRef, result = {}) {
  await jobRef.set({
    status: 'completed',
    completedAt: new Date(),
    updatedAt: new Date(),
    result,
  }, { merge: true });
}

export async function failDerivedJob(job, error) {
  const firestore = await getFirestore();
  const nextAttempts = Number(job?.attempts || 0) + 1;
  const maxAttempts = Math.max(1, Number(job?.maxAttempts) || 5);
  const errorMessage = String(error?.message || error || 'unknown_error').slice(0, 1000);

  if (nextAttempts >= maxAttempts) {
    const failedRef = firestore.collection(FAILED_JOBS_COLLECTION).doc(String(job.id));
    await failedRef.set({
      ...(job || {}),
      status: 'failed',
      attempts: nextAttempts,
      failedAt: new Date(),
      lastError: errorMessage,
      updatedAt: new Date(),
    }, { merge: true });
    await job.ref.delete();
    return;
  }

  const backoffMinutes = Math.min(30, Math.max(1, nextAttempts * 2));
  const nextAvailableAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
  await job.ref.set({
    status: 'queued',
    attempts: nextAttempts,
    availableAt: nextAvailableAt,
    lastError: errorMessage,
    updatedAt: new Date(),
  }, { merge: true });
}
