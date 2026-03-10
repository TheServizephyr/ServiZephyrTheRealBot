import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAYS_TO_KEEP = 7;
const PUBLIC_API_LIMITS_DAYS = 1;
const SECURITY_EVENTS_DAYS = 14;
const SECURITY_ANOMALY_DAYS = 14;

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

function toMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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
        const securityEventsCutoffMs = Date.now() - SECURITY_EVENTS_DAYS * 24 * 60 * 60 * 1000;
        const securityAnomalyCutoffMs = Date.now() - SECURITY_ANOMALY_DAYS * 24 * 60 * 60 * 1000;

        // 1) rate_limits cleanup by createdAt
        const rateSnap = await firestore
            .collection('rate_limits')
            .where('createdAt', '<', cutoffDate)
            .get();
        const rateDeleted = await deleteByRefs(firestore, rateSnap.docs.map((d) => d.ref));

        // 1b) public_api_limits cleanup by expiresAt (fallback createdAt)
        const publicLimitSnap = await firestore.collection('public_api_limits').get();
        const publicLimitRefsToDelete = [];
        for (const doc of publicLimitSnap.docs) {
            const data = doc.data() || {};
            const ts = toMillis(data.expiresAt) ?? toMillis(data.updatedAt) ?? toMillis(data.createdAt);
            if (ts && ts < publicLimitCutoffMs) {
                publicLimitRefsToDelete.push(doc.ref);
            }
        }
        const publicApiLimitsDeleted = await deleteByRefs(firestore, publicLimitRefsToDelete);

        // 2) idempotency_keys cleanup by completedAt/failedAt/createdAt
        const idemSnap = await firestore.collection('idempotency_keys').get();
        const idemRefsToDelete = [];
        for (const doc of idemSnap.docs) {
            const data = doc.data() || {};
            const ts =
                toMillis(data.completedAt) ??
                toMillis(data.failedAt) ??
                toMillis(data.createdAt);

            if (ts && ts < cutoffMs) {
                idemRefsToDelete.push(doc.ref);
            }
        }
        const idempotencyDeleted = await deleteByRefs(firestore, idemRefsToDelete);

        // 3) auth_tokens cleanup by expiresAt (fallback createdAt)
        const authTokenSnap = await firestore.collection('auth_tokens').get();
        const authTokenRefsToDelete = [];
        for (const doc of authTokenSnap.docs) {
            const data = doc.data() || {};
            const ts = toMillis(data.expiresAt) ?? toMillis(data.createdAt);
            if (ts && ts < cutoffMs) {
                authTokenRefsToDelete.push(doc.ref);
            }
        }
        const authTokensDeleted = await deleteByRefs(firestore, authTokenRefsToDelete);

        // 4) audit_logs cleanup by createdAt (fallback timestamp)
        const auditSnap = await firestore.collection('audit_logs').get();
        const auditRefsToDelete = [];
        for (const doc of auditSnap.docs) {
            const data = doc.data() || {};
            const ts = toMillis(data.createdAt) ?? toMillis(data.timestamp);
            if (ts && ts < cutoffMs) {
                auditRefsToDelete.push(doc.ref);
            }
        }
        const auditLogsDeleted = await deleteByRefs(firestore, auditRefsToDelete);

        // 5) security_events cleanup
        const securityEventSnap = await firestore.collection('security_events').get();
        const securityEventRefsToDelete = [];
        for (const doc of securityEventSnap.docs) {
            const data = doc.data() || {};
            const ts = toMillis(data.createdAt);
            if (ts && ts < securityEventsCutoffMs) {
                securityEventRefsToDelete.push(doc.ref);
            }
        }
        const securityEventsDeleted = await deleteByRefs(firestore, securityEventRefsToDelete);

        // 6) security_anomaly_windows cleanup
        const securityAnomalySnap = await firestore.collection('security_anomaly_windows').get();
        const securityAnomalyRefsToDelete = [];
        for (const doc of securityAnomalySnap.docs) {
            const data = doc.data() || {};
            const ts = toMillis(data.lastSeenAt) ?? toMillis(data.flaggedAt) ?? toMillis(data.createdAt);
            if (ts && ts < securityAnomalyCutoffMs) {
                securityAnomalyRefsToDelete.push(doc.ref);
            }
        }
        const securityAnomaliesDeleted = await deleteByRefs(firestore, securityAnomalyRefsToDelete);

        return NextResponse.json({
            success: true,
            retentionDays: DAYS_TO_KEEP,
            publicApiLimitsRetentionDays: PUBLIC_API_LIMITS_DAYS,
            securityEventsRetentionDays: SECURITY_EVENTS_DAYS,
            securityAnomalyRetentionDays: SECURITY_ANOMALY_DAYS,
            rateLimits: {
                scannedByQuery: rateSnap.size,
                deleted: rateDeleted,
            },
            publicApiLimits: {
                scanned: publicLimitSnap.size,
                deleted: publicApiLimitsDeleted,
            },
            idempotencyKeys: {
                scanned: idemSnap.size,
                deleted: idempotencyDeleted,
            },
            authTokens: {
                scanned: authTokenSnap.size,
                deleted: authTokensDeleted,
            },
            auditLogs: {
                scanned: auditSnap.size,
                deleted: auditLogsDeleted,
            },
            securityEvents: {
                scanned: securityEventSnap.size,
                deleted: securityEventsDeleted,
            },
            securityAnomalyWindows: {
                scanned: securityAnomalySnap.size,
                deleted: securityAnomaliesDeleted,
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
