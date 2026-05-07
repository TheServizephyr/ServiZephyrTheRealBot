import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { verifyAdmin } from '@/lib/verify-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INCIDENTS_COLLECTION = 'ops_incidents';
const ALLOWED_STATUSES = new Set(['new', 'reopened', 'investigating', 'resolved', 'muted']);
const ALLOWED_SEVERITIES = new Set(['critical', 'error', 'warning', 'info']);

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function serializeValue(value) {
    if (!value) return value;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(serializeValue);
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)]));
    }
    return value;
}

function matchesFilter(incident, { status, severity, source, q }) {
    if (status && status !== 'all' && incident.status !== status) return false;
    if (severity && severity !== 'all' && incident.severity !== severity) return false;
    if (source && source !== 'all' && incident.source !== source) return false;

    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return true;

    const haystack = [
        incident.title,
        incident.message,
        incident.route,
        incident.source,
        incident.area,
        incident.errorName,
        incident.id,
    ].join(' ').toLowerCase();

    return haystack.includes(needle);
}

function buildStats(incidents) {
    return incidents.reduce((acc, incident) => {
        acc.total += 1;
        acc.byStatus[incident.status || 'new'] = (acc.byStatus[incident.status || 'new'] || 0) + 1;
        acc.bySeverity[incident.severity || 'error'] = (acc.bySeverity[incident.severity || 'error'] || 0) + 1;
        if (incident.email?.lastStatus === 'failed') acc.emailFailures += 1;
        return acc;
    }, {
        total: 0,
        byStatus: {},
        bySeverity: {},
        emailFailures: 0,
    });
}

export async function GET(req) {
    try {
        await verifyAdmin(req);

        const { searchParams } = new URL(req.url);
        const limit = clamp(searchParams.get('limit') || 80, 20, 150);
        const status = String(searchParams.get('status') || 'all').trim();
        const severity = String(searchParams.get('severity') || 'all').trim();
        const source = String(searchParams.get('source') || 'all').trim();
        const q = String(searchParams.get('q') || '').trim();
        const pinnedIncidentId = String(searchParams.get('incident') || '').trim();
        const fetchLimit = Math.min(500, Math.max(limit * 4, 160));

        const firestore = await getFirestore();
        const snapshot = await firestore
            .collection(INCIDENTS_COLLECTION)
            .orderBy('lastSeenAt', 'desc')
            .limit(fetchLimit)
            .get();

        let incidents = snapshot.docs.map((doc) => serializeValue({ id: doc.id, ...doc.data() }));
        const sourceOptions = Array.from(new Set(incidents.map((incident) => incident.source).filter(Boolean))).sort();
        const stats = buildStats(incidents);

        incidents = incidents
            .filter((incident) => matchesFilter(incident, { status, severity, source, q }))
            .slice(0, limit);

        if (pinnedIncidentId && !incidents.some((incident) => incident.id === pinnedIncidentId)) {
            const pinnedSnap = await firestore.collection(INCIDENTS_COLLECTION).doc(pinnedIncidentId).get();
            if (pinnedSnap.exists) {
                incidents = [serializeValue({ id: pinnedSnap.id, ...pinnedSnap.data(), pinned: true }), ...incidents].slice(0, limit);
            }
        }

        return NextResponse.json({
            incidents,
            stats,
            sourceOptions,
            filters: { status, severity, source, q, limit },
            generatedAt: new Date().toISOString(),
        }, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            { message: error.message || 'Failed to load ops incidents' },
            { status: error.status || 500 }
        );
    }
}

export async function PATCH(req) {
    try {
        const admin = await verifyAdmin(req);
        const body = await req.json();
        const incidentId = String(body.incidentId || body.id || '').trim();
        const status = String(body.status || '').trim();
        const note = String(body.note || '').trim();

        if (!incidentId) {
            return NextResponse.json({ message: 'incidentId is required' }, { status: 400 });
        }
        if (!ALLOWED_STATUSES.has(status)) {
            return NextResponse.json({ message: 'Invalid status' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const update = {
            status,
            updatedAt: FieldValue.serverTimestamp(),
            lastStatusChangeAt: FieldValue.serverTimestamp(),
            lastStatusChangeAtISO: new Date().toISOString(),
            lastStatusChangedBy: {
                uid: admin.uid,
                email: admin.userData?.email || null,
            },
        };

        if (note) {
            update.adminNote = note.slice(0, 2000);
        }
        if (status === 'resolved') {
            update.resolvedAt = FieldValue.serverTimestamp();
            update.resolvedAtISO = new Date().toISOString();
        }
        if (status === 'muted') {
            update.mutedAt = FieldValue.serverTimestamp();
            update.mutedAtISO = new Date().toISOString();
        }

        await firestore.collection(INCIDENTS_COLLECTION).doc(incidentId).set(update, { merge: true });

        return NextResponse.json({ ok: true }, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            { message: error.message || 'Failed to update incident' },
            { status: error.status || 500 }
        );
    }
}
