import { NextResponse } from 'next/server';

import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { listProcessableDerivedJobs, markDerivedJobProcessing, completeDerivedJob, failDerivedJob, enqueueDerivedJob } from '@/lib/server/derivedJobs';
import { rebuildMenuSnapshot } from '@/lib/server/menuSnapshot';
import { rebuildDashboardStats } from '@/lib/server/dashboardStats';
import { findBusinessById } from '@/services/business/businessService';
import { getFirestore } from '@/lib/firebase-admin';
import { getBusinessRuntime, resolveScopedFeatureFlagValue } from '@/lib/server/businessRuntime';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function isAuthorizedCronRequest(req) {
  const configuredSecret = String(process.env.CRON_SECRET || '').trim();
  if (!configuredSecret) return true;
  const provided = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return provided && provided === configuredSecret;
}

async function ensureStatsReconcileJobs(firestore) {
  if (!FEATURE_FLAGS.USE_DASHBOARD_STATS_RECONCILE) return 0;
  const collections = ['restaurants', 'shops', 'street_vendors'];
  let enqueued = 0;

  for (const collectionName of collections) {
    const businessesSnap = await firestore.collection(collectionName).limit(50).get();
    for (const doc of businessesSnap.docs) {
      const businessData = doc.data() || {};
      const runtimeData = await getBusinessRuntime(doc.ref);
      const enabled = resolveScopedFeatureFlagValue('stats_reconcile_enabled', {
        businessData,
        runtimeData,
        envDefault: FEATURE_FLAGS.USE_DASHBOARD_STATS_RECONCILE,
      });
      if (!enabled) continue;
      await enqueueDerivedJob({
        type: 'dashboard_stats_reconcile',
        jobKey: `dashboard_stats_reconcile:${doc.id}`,
        payload: {
          businessId: doc.id,
          collectionName,
        },
      });
      enqueued += 1;
    }
  }

  return enqueued;
}

export async function GET(req) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const firestore = await getFirestore();
  const autoEnqueued = await ensureStatsReconcileJobs(firestore);
  const jobs = await listProcessableDerivedJobs(25);
  const results = [];

  for (const job of jobs) {
    try {
      await markDerivedJobProcessing(job.ref);

      if (job.type === 'snapshot_rebuild') {
        const result = await rebuildMenuSnapshot({
          firestore,
          businessId: job?.payload?.businessId,
          collectionNameHint: job?.payload?.collectionName,
        });
        await completeDerivedJob(job.ref, {
          menuVersion: Number(result?.menuVersion || 0),
        });
        results.push({ id: job.id, type: job.type, status: 'completed' });
        continue;
      }

      if (job.type === 'dashboard_stats_reconcile') {
        const result = await rebuildDashboardStats({
          firestore,
          businessId: job?.payload?.businessId,
          collectionNameHint: job?.payload?.collectionName,
        });
        await completeDerivedJob(job.ref, {
          statsVersion: Number(result?.version || 0),
        });
        results.push({ id: job.id, type: job.type, status: 'completed' });
        continue;
      }

      if (job.type === 'dashboard_stats_update') {
        const targetBusinessId = String(job?.payload?.businessId || '').trim();
        if (!targetBusinessId) throw new Error('Missing businessId for dashboard_stats_update job.');
        const business = await findBusinessById(firestore, targetBusinessId, {
          collectionNameHint: job?.payload?.collectionName || null,
          includeDeliverySettings: false,
        });
        if (!business?.ref) throw new Error(`Business not found for stats update: ${targetBusinessId}`);
        const result = await rebuildDashboardStats({
          firestore,
          businessId: targetBusinessId,
          collectionNameHint: business.collection,
          businessRef: business.ref,
        });
        await completeDerivedJob(job.ref, {
          statsVersion: Number(result?.version || 0),
        });
        results.push({ id: job.id, type: job.type, status: 'completed' });
        continue;
      }

      await completeDerivedJob(job.ref, { ignored: true });
      results.push({ id: job.id, type: job.type, status: 'ignored' });
    } catch (error) {
      await failDerivedJob(job, error);
      results.push({
        id: job.id,
        type: job.type,
        status: 'failed',
        error: error?.message || 'unknown_error',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    autoEnqueued,
    processed: results.length,
    results,
  }, { status: 200 });
}
