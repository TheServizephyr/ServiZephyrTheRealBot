import { NextResponse } from 'next/server';
import { getClientIP } from '@/lib/audit-logger';
import { checkIpRateLimit } from '@/lib/rateLimiter';
import { reportIncident } from '@/lib/opsIncidentReporter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRequestMetadata(req) {
    return {
        ip: getClientIP(req),
        userAgent: req.headers.get('user-agent') || '',
        referer: req.headers.get('referer') || '',
    };
}

function sanitizeOpsUrl(value) {
    const raw = String(value || '');
    if (!raw) return '';

    try {
        const url = new URL(raw, 'https://servizephyr.com');
        for (const key of Array.from(url.searchParams.keys())) {
            if (/(token|^ref$|auth|code|secret|session|api[_-]?key|password)/i.test(key)) {
                url.searchParams.set(key, '[redacted]');
            }
        }
        return /^https?:\/\//i.test(raw) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return raw.replace(/([?&][^=]*(token|ref|auth|code|secret|session|api[_-]?key|password)[^=]*=)[^&#]*/gi, '$1[redacted]');
    }
}

function isLocalReport(payload = {}) {
    const candidates = [payload.url, payload.referrer, payload.path].filter(Boolean);
    return candidates.some((candidate) => {
        const raw = String(candidate || '');
        if (!/^https?:\/\//i.test(raw)) return false;
        try {
            const url = new URL(raw);
            return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
        } catch {
            return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(raw);
        }
    });
}

export async function POST(req) {
    try {
        const ip = getClientIP(req) || 'unknown';
        const rateLimit = await checkIpRateLimit(ip, 12);
        if (!rateLimit.allowed) {
            return NextResponse.json({ ok: true, throttled: true }, { status: 202 });
        }

        const payload = await req.json();
        if (isLocalReport(payload) && process.env.OPS_REPORT_LOCAL !== 'true') {
            return NextResponse.json({ ok: true, skipped: true, reason: 'local_report' }, { status: 202 });
        }

        const requestMetadata = getRequestMetadata(req);
        const route = sanitizeOpsUrl(payload?.path || payload?.url || '').slice(0, 240);

        await reportIncident({
            source: payload?.source || 'client_report',
            area: payload?.area || 'browser',
            severity: payload?.severity || 'error',
            title: payload?.title || payload?.message || 'Client incident',
            message: payload?.message || payload?.error?.message || 'Client incident',
            route,
            error: payload?.error || payload?.message,
            user: payload?.user || null,
            browser: payload?.browser || null,
            request: requestMetadata,
            context: {
                url: sanitizeOpsUrl(payload?.url || ''),
                referrer: sanitizeOpsUrl(payload?.referrer || requestMetadata.referer || ''),
                screen: payload?.screen || null,
                clientContext: payload?.context || null,
                clientAt: payload?.at || null,
            },
        });

        return NextResponse.json({ ok: true }, { status: 202 });
    } catch {
        return NextResponse.json({ ok: true }, { status: 202 });
    }
}
