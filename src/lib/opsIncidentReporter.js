import { createHash } from 'crypto';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { sendOpsIncidentEmail } from '@/lib/opsAlertEmail';

const INCIDENTS_COLLECTION = 'ops_incidents';
const DEFAULT_EMAIL_COOLDOWN_MINUTES = 30;
const MAX_CONTEXT_DEPTH = 4;
const MAX_STRING_LENGTH = 2000;
const MAX_STACK_LENGTH = 6000;

const SECRET_KEY_PATTERNS = [
    /authorization/i,
    /cookie/i,
    /password/i,
    /secret/i,
    /token/i,
    /access[_-]?key/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /service[_-]?account/i,
    /credential/i,
];

const SEVERITY_RANK = {
    info: 0,
    warning: 1,
    error: 2,
    critical: 3,
};

function isIncidentReportingEnabled() {
    return process.env.OPS_INCIDENTS_ENABLED !== 'false';
}

function normalizeSeverity(value) {
    const raw = String(value || '').toLowerCase().trim();
    if (raw === 'warn') return 'warning';
    if (SEVERITY_RANK[raw] !== undefined) return raw;
    return 'error';
}

function minEmailSeverity() {
    return normalizeSeverity(process.env.OPS_ALERT_EMAIL_MIN_SEVERITY || 'error');
}

function shouldEmailSeverity(severity) {
    return SEVERITY_RANK[normalizeSeverity(severity)] >= SEVERITY_RANK[minEmailSeverity()];
}

function getEmailCooldownMs() {
    const minutes = Number(process.env.OPS_ALERT_EMAIL_COOLDOWN_MINUTES || DEFAULT_EMAIL_COOLDOWN_MINUTES);
    return Math.max(1, Number.isFinite(minutes) ? minutes : DEFAULT_EMAIL_COOLDOWN_MINUTES) * 60 * 1000;
}

function toDateMs(value) {
    if (!value) return 0;
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function isSensitiveKey(key) {
    return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(String(key || '')));
}

function truncateString(value, maxLength = MAX_STRING_LENGTH) {
    const text = String(value || '');
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}... [truncated]`;
}

function redactSensitiveUrlParams(text) {
    return String(text || '').replace(
        /([?&][^=]*(token|ref|auth|code|secret|session|api[_-]?key|password)[^=]*=)[^&#\s"]*/gi,
        '$1[redacted]'
    );
}

export function sanitizeOpsContext(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (depth > MAX_CONTEXT_DEPTH) return '[max_depth]';

    if (value instanceof Error) {
        return {
            name: value.name || 'Error',
            message: truncateString(value.message || String(value)),
            stack: truncateString(value.stack || '', MAX_STACK_LENGTH),
        };
    }

    if (typeof value === 'string') return truncateString(redactSensitiveUrlParams(value));
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) {
        return value.slice(0, 25).map((item) => sanitizeOpsContext(item, depth + 1));
    }

    if (typeof value === 'object') {
        const output = {};
        for (const [key, entry] of Object.entries(value).slice(0, 80)) {
            output[key] = isSensitiveKey(key) ? '[redacted]' : sanitizeOpsContext(entry, depth + 1);
        }
        return output;
    }

    return truncateString(value);
}

function normalizeError(errorLike = {}) {
    if (errorLike instanceof Error) {
        return {
            name: errorLike.name || 'Error',
            message: truncateString(errorLike.message || String(errorLike)),
            stack: truncateString(errorLike.stack || '', MAX_STACK_LENGTH),
        };
    }

    if (typeof errorLike === 'string') {
        return { name: 'Error', message: truncateString(errorLike), stack: '' };
    }

    return {
        name: truncateString(errorLike?.name || errorLike?.type || 'Error', 120),
        message: truncateString(errorLike?.message || errorLike?.errorMessage || errorLike?.reason || 'Unknown error'),
        stack: truncateString(errorLike?.stack || '', MAX_STACK_LENGTH),
    };
}

function firstStackFrame(stack) {
    return String(stack || '')
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line && !line.toLowerCase().includes('error:')) || '';
}

function hash(value, length = 28) {
    return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function buildFingerprint({ source, area, route, error, fingerprint }) {
    if (fingerprint) return hash(fingerprint);
    const seed = [
        source || 'unknown',
        area || 'general',
        route || '',
        error.name || 'Error',
        error.message || '',
        firstStackFrame(error.stack),
    ].join('|');
    return hash(seed);
}

function classifyStatus(existingStatus) {
    if (existingStatus === 'resolved') return 'reopened';
    if (existingStatus === 'muted') return 'muted';
    if (existingStatus === 'investigating') return 'investigating';
    return 'new';
}

function shouldSendEmail({ severity, existing = {}, nowMs }) {
    if (process.env.OPS_ALERT_EMAIL_ENABLED === 'false') return false;
    if (!shouldEmailSeverity(severity)) return false;
    if (existing.status === 'muted') return false;

    const lastEmailMs = toDateMs(existing.lastEmailAt || existing.lastEmailAttemptAt || existing.email?.lastAttemptAt);
    if (!lastEmailMs) return true;
    return nowMs - lastEmailMs >= getEmailCooldownMs();
}

function buildIncidentDoc({ id, input, error, severity, nowIso, count }) {
    const route = truncateString(input.route || input.path || input.endpoint || '', 240);
    const title = truncateString(
        input.title ||
        `${severity === 'critical' ? 'Critical' : 'Production'} issue${route ? ` at ${route}` : ''}`,
        180
    );
    const message = truncateString(input.message || error.message || 'Unknown error');

    return {
        id,
        fingerprint: id,
        title,
        message,
        severity,
        source: truncateString(input.source || 'server', 80),
        area: truncateString(input.area || 'general', 80),
        route,
        environment: truncateString(input.environment || process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'unknown', 80),
        deployment: truncateString(process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_DEPLOYMENT_VERSION || '', 120),
        errorName: error.name || 'Error',
        stack: error.stack || '',
        status: 'new',
        count,
        lastSeenAt: FieldValue.serverTimestamp(),
        lastSeenAtISO: nowIso,
        lastEvent: {
            at: nowIso,
            message,
            name: error.name || 'Error',
            stack: error.stack || '',
            path: route,
            user: sanitizeOpsContext(input.user || null),
            browser: sanitizeOpsContext(input.browser || null),
            request: sanitizeOpsContext(input.request || null),
            context: sanitizeOpsContext(input.context || null),
        },
        tags: sanitizeOpsContext(input.tags || {}),
        updatedAt: FieldValue.serverTimestamp(),
    };
}

export async function reportIncident(input = {}) {
    if (!isIncidentReportingEnabled()) {
        return { ok: false, skipped: true, reason: 'disabled' };
    }

    const error = normalizeError(input.error || input);
    const severity = normalizeSeverity(input.severity);
    const id = buildFingerprint({
        source: input.source,
        area: input.area,
        route: input.route || input.path || input.endpoint,
        error,
        fingerprint: input.fingerprint,
    });
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const firestore = await getFirestore();
    const incidentRef = firestore.collection(INCIDENTS_COLLECTION).doc(id);

    let shouldEmail = false;
    let emailIncidentPayload = null;
    let emailEventPayload = null;
    let persistedCount = 1;

    await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(incidentRef);
        const existing = snap.exists ? (snap.data() || {}) : {};
        persistedCount = Number(existing.count || 0) + 1;
        shouldEmail = shouldSendEmail({ severity, existing, nowMs });

        const incidentDoc = buildIncidentDoc({
            id,
            input,
            error,
            severity,
            nowIso,
            count: persistedCount,
        });
        const status = snap.exists ? classifyStatus(existing.status) : 'new';

        tx.set(incidentRef, {
            ...incidentDoc,
            status,
            firstSeenAt: snap.exists ? existing.firstSeenAt : FieldValue.serverTimestamp(),
            firstSeenAtISO: snap.exists ? existing.firstSeenAtISO : nowIso,
            count: FieldValue.increment(1),
            lastEmailAttemptAt: shouldEmail ? FieldValue.serverTimestamp() : existing.lastEmailAttemptAt || null,
            email: {
                ...(existing.email || {}),
                pending: shouldEmail,
                lastDecisionAt: nowIso,
                lastDecisionReason: shouldEmail ? 'eligible' : 'cooldown_or_severity',
            },
        }, { merge: true });

        emailIncidentPayload = {
            ...incidentDoc,
            id,
            status,
            count: persistedCount,
        };
        emailEventPayload = incidentDoc.lastEvent;
    });

    if (shouldEmail) {
        try {
            const emailResult = await sendOpsIncidentEmail({
                incident: emailIncidentPayload,
                event: emailEventPayload,
            });
            const emailUpdate = {
                lastEmailAttemptAt: FieldValue.serverTimestamp(),
                email: {
                    pending: false,
                    lastAttemptAt: FieldValue.serverTimestamp(),
                    lastAttemptAtISO: new Date().toISOString(),
                    lastStatus: emailResult.sent ? 'sent' : 'skipped',
                    lastReason: emailResult.reason || null,
                    provider: emailResult.provider || null,
                    providerMessageId: emailResult.providerMessageId || null,
                },
            };
            if (emailResult.sent) {
                emailUpdate.lastEmailAt = FieldValue.serverTimestamp();
            }
            await incidentRef.set(emailUpdate, { merge: true });
        } catch (emailError) {
            await incidentRef.set({
                email: {
                    pending: false,
                    lastAttemptAt: FieldValue.serverTimestamp(),
                    lastAttemptAtISO: new Date().toISOString(),
                    lastStatus: 'failed',
                    lastReason: truncateString(emailError?.message || String(emailError), 500),
                    provider: 'resend',
                },
            }, { merge: true }).catch(() => {});
        }
    }

    return {
        ok: true,
        id,
        severity,
        count: persistedCount,
        emailQueued: shouldEmail,
    };
}

export function buildConsoleIncidentPayload(args = []) {
    const text = args.map((arg) => {
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        if (typeof arg === 'string') return arg;
        try {
            return JSON.stringify(sanitizeOpsContext(arg));
        } catch {
            return String(arg);
        }
    }).join(' ');

    const errorArg = args.find((arg) => arg instanceof Error);
    const upperText = text.toUpperCase();
    const expectedAuthNoise =
        text.includes('Authorization token is missing') ||
        text.includes('Token verification failed') ||
        text.includes('Access Denied') ||
        text.includes('auth/id-token-expired') ||
        text.includes('auth/id-token-revoked');

    let severity = expectedAuthNoise ? 'warning' : 'error';
    if (
        upperText.includes('CRITICAL') ||
        upperText.includes('FATAL') ||
        upperText.includes('WEBHOOK') ||
        upperText.includes('PAYMENT') ||
        upperText.includes('FIREBASE ADMIN SDK')
    ) {
        severity = 'critical';
    }

    return {
        source: 'server_console',
        area: 'server',
        severity,
        title: text.slice(0, 180) || 'Server console error',
        message: text || 'Server console error',
        error: errorArg || { name: 'ConsoleError', message: text },
        context: {
            consoleArgs: args.map((arg) => sanitizeOpsContext(arg)),
        },
    };
}
