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

export async function POST(req) {
    try {
        const ip = getClientIP(req) || 'unknown';
        const rateLimit = await checkIpRateLimit(ip, 12);
        if (!rateLimit.allowed) {
            return NextResponse.json({ ok: true, throttled: true }, { status: 202 });
        }

        const payload = await req.json();
        const requestMetadata = getRequestMetadata(req);
        const route = String(payload?.path || payload?.url || '').slice(0, 240);

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
                url: payload?.url || '',
                referrer: payload?.referrer || requestMetadata.referer || '',
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
