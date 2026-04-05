import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAYS_TO_KEEP = 7;
const PUBLIC_API_LIMITS_DAYS = 1;
const SECURITY_EVENTS_DAYS = 14;
const SECURITY_ANOMALY_DAYS = 14;
const CLEANUP_QUERY_LIMIT = 200;
const CLEANUP_MAX_DELETES_PER_COLLECTION = 1000;

async function deleteByRefs(firestore, refs) {
    if (!refs.length) return 0;
    const chunkSize = 450;
    let deleted = 0;

    for (let i = 0; i < refs.length; i += chunkSize) {
        const chunk = refs.slice(i, i + chunkSize);
        const batch = firestore.batch();
        for (const ref of chunk) {
            batch.delete(ref);
        }
        await batch.commit();
        deleted += chunk.length;
    }

    return deleted;
}

async function cleanupCollectionByFields(
    firestore,
    {
        collectionName,
        fields,
        cutoffDate,
        queryLimit = CLEANUP_QUERY_LIMIT,
        maxDeletes = CLEANUP_MAX_DELETES_PER_COLLECTION,
    }
) {
    const safeFields = [...new Set((fields || []).filter(Boolean))];
    let deleted = 0;
    let scannedByQuery = 0;

    for (const field of safeFields) {
        while (deleted < maxDeletes) {
            const remainingDeletes = maxDeletes - deleted;
            const limit = Math.min(queryLimit, remainingDeletes);
            const snapshot = await firestore
                .collection(collectionName)
                .where(field, '<', cutoffDate)
                .limit(limit)
                .get();

            scannedByQuery += snapshot.size;

            if (snapshot.empty) {
                break;
            }

            deleted += await deleteByRefs(firestore, snapshot.docs.map((doc) => doc.ref));

            if (snapshot.size < limit) {
                break;
            }
        }

        if (deleted >= maxDeletes) {
            break;
        }
    }

    return {
        scannedByQuery,
        deleted,
        hitDeleteCap: deleted >= maxDeletes,
        fieldsUsed: safeFields,
    };
}

export async function GET(req) {
    try {
        const secret = process.env.CRON_SECRET;
        const auth = req.headers.get('authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

        if (!secret || token !== secret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const firestore = await getFirestore();
        const cutoffMs = Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000;
        const cutoffDate = new Date(cutoffMs);
        const publicLimitCutoffMs = Date.now() - PUBLIC_API_LIMITS_DAYS * 24 * 60 * 60 * 1000;
        const publicLimitCutoffDate = new Date(publicLimitCutoffMs);
        const securityEventsCutoffDate = new Date(Date.now() - SECURITY_EVENTS_DAYS * 24 * 60 * 60 * 1000);
        const securityAnomalyCutoffDate = new Date(Date.now() - SECURITY_ANOMALY_DAYS * 24 * 60 * 60 * 1000);

        // 1) rate_limits cleanup by createdAt
        const rateLimits = await cleanupCollectionByFields(firestore, {
            collectionName: 'rate_limits',
            fields: ['createdAt'],
            cutoffDate,
        });

        // 1b) public_api_limits cleanup by expiresAt/updatedAt/createdAt
        const publicApiLimits = await cleanupCollectionByFields(firestore, {
            collectionName: 'public_api_limits',
            fields: ['expiresAt', 'updatedAt', 'createdAt'],
            cutoffDate: publicLimitCutoffDate,
        });

        // 2) idempotency_keys cleanup by completedAt/failedAt/createdAt
        const idempotencyKeys = await cleanupCollectionByFields(firestore, {
            collectionName: 'idempotency_keys',
            fields: ['completedAt', 'failedAt', 'createdAt'],
            cutoffDate,
        });

        // 3) auth_tokens cleanup by expiresAt (fallback createdAt)
        const authTokens = await cleanupCollectionByFields(firestore, {
            collectionName: 'auth_tokens',
            fields: ['expiresAt', 'createdAt'],
            cutoffDate,
        });

        // 4) audit_logs cleanup by createdAt (fallback timestamp)
        const auditLogs = await cleanupCollectionByFields(firestore, {
            collectionName: 'audit_logs',
            fields: ['createdAt', 'timestamp'],
            cutoffDate,
        });

        // 5) security_events cleanup
        const securityEvents = await cleanupCollectionByFields(firestore, {
            collectionName: 'security_events',
            fields: ['createdAt'],
            cutoffDate: securityEventsCutoffDate,
        });

        // 6) security_anomaly_windows cleanup
        const securityAnomalyWindows = await cleanupCollectionByFields(firestore, {
            collectionName: 'security_anomaly_windows',
            fields: ['lastSeenAt', 'flaggedAt', 'createdAt'],
            cutoffDate: securityAnomalyCutoffDate,
        });

        return NextResponse.json({
            success: true,
            retentionDays: DAYS_TO_KEEP,
            publicApiLimitsRetentionDays: PUBLIC_API_LIMITS_DAYS,
            securityEventsRetentionDays: SECURITY_EVENTS_DAYS,
            securityAnomalyRetentionDays: SECURITY_ANOMALY_DAYS,
            cleanupQueryLimit: CLEANUP_QUERY_LIMIT,
            cleanupMaxDeletesPerCollection: CLEANUP_MAX_DELETES_PER_COLLECTION,
            rateLimits: {
                scannedByQuery: rateLimits.scannedByQuery,
                deleted: rateLimits.deleted,
                hitDeleteCap: rateLimits.hitDeleteCap,
            },
            publicApiLimits: {
                scannedByQuery: publicApiLimits.scannedByQuery,
                deleted: publicApiLimits.deleted,
                hitDeleteCap: publicApiLimits.hitDeleteCap,
            },
            idempotencyKeys: {
                scannedByQuery: idempotencyKeys.scannedByQuery,
                deleted: idempotencyKeys.deleted,
                hitDeleteCap: idempotencyKeys.hitDeleteCap,
            },
            authTokens: {
                scannedByQuery: authTokens.scannedByQuery,
                deleted: authTokens.deleted,
                hitDeleteCap: authTokens.hitDeleteCap,
            },
            auditLogs: {
                scannedByQuery: auditLogs.scannedByQuery,
                deleted: auditLogs.deleted,
                hitDeleteCap: auditLogs.hitDeleteCap,
            },
            securityEvents: {
                scannedByQuery: securityEvents.scannedByQuery,
                deleted: securityEvents.deleted,
                hitDeleteCap: securityEvents.hitDeleteCap,
            },
            securityAnomalyWindows: {
                scannedByQuery: securityAnomalyWindows.scannedByQuery,
                deleted: securityAnomalyWindows.deleted,
                hitDeleteCap: securityAnomalyWindows.hitDeleteCap,
            },
        });
    } catch (error) {
        console.error('[Cron cleanup-retention] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Cleanup failed',
            },
            { status: 500 }
        );
    }
}
