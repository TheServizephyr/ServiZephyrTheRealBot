import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

const STATE = globalThis.__servizephyrRequestShieldState || {
  buckets: new Map(),
  lastCleanupAt: 0,
};
globalThis.__servizephyrRequestShieldState = STATE;

const WINDOW_MS = 10 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

function hashValue(input = '') {
  let hash = 2166136261;
  const value = String(input || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return request.headers.get('x-real-ip') || 'unknown';
}

function isDesktopLocalRequest(request) {
  if (process.env.NEXT_PUBLIC_IS_DESKTOP_APP !== '1') return false;
  const hostHeader = String(request.headers.get('host') || '').toLowerCase();
  return hostHeader.includes('localhost') || hostHeader.includes('127.0.0.1');
}

function getVisitorId(request, ipAddress) {
  const authSession = request.cookies.get('auth_session')?.value;
  if (authSession) return `auth:${hashValue(authSession)}`;

  const guestSession = request.cookies.get('auth_guest_session')?.value;
  if (guestSession) return `guest:${hashValue(guestSession)}`;

  const authHeader = request.headers.get('authorization');
  if (authHeader) return `bearer:${hashValue(authHeader)}`;

  const ref = request.nextUrl.searchParams.get('ref');
  if (ref) return `ref:${hashValue(ref)}`;

  const userAgent = request.headers.get('user-agent') || '';
  return `anon:${hashValue(`${ipAddress}:${userAgent}`)}`;
}

function classifyRequest(pathname) {
  if (
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/healthz') ||
    pathname.startsWith('/readyz')
  ) {
    return null;
  }

  if (
    pathname.startsWith('/api/order/status') ||
    pathname.startsWith('/api/order/active') ||
    pathname.startsWith('/api/customer/lookup') ||
    pathname.startsWith('/api/auth/verify-token')
  ) {
    return { kind: 'api', bucket: 'sensitive-public-api', actorLimit: 30, ipLimit: 90 };
  }

  if (pathname.startsWith('/api/auth')) {
    return { kind: 'api', bucket: 'auth-api', actorLimit: 20, ipLimit: 60 };
  }

  if (pathname.startsWith('/api/')) {
    return { kind: 'api', bucket: 'api', actorLimit: 80, ipLimit: 240 };
  }

  if (
    pathname.startsWith('/owner-dashboard') ||
    pathname.startsWith('/customer-dashboard') ||
    pathname.startsWith('/employee-dashboard') ||
    pathname.startsWith('/rider-dashboard') ||
    pathname.startsWith('/admin-dashboard')
  ) {
    return { kind: 'page', bucket: 'dashboard-page', actorLimit: 90, ipLimit: 300 };
  }

  if (
    pathname.startsWith('/order/') ||
    pathname.startsWith('/track/') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/join/')
  ) {
    return { kind: 'page', bucket: 'public-page', actorLimit: 60, ipLimit: 180 };
  }

  return { kind: 'page', bucket: 'general-page', actorLimit: 120, ipLimit: 360 };
}

function cleanupBuckets(now) {
  if (now - STATE.lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  STATE.lastCleanupAt = now;

  for (const [key, bucket] of STATE.buckets.entries()) {
    if (!bucket || bucket.resetAt <= now) {
      STATE.buckets.delete(key);
    }
  }
}

function consumeMemoryBucket(key, limit, now) {
  const existing = STATE.buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    STATE.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (existing.count >= limit) {
    return false;
  }

  existing.count += 1;
  return true;
}

function isKvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function buildWindowKey(key, now) {
  return `request-shield:${key}:${Math.floor(now / WINDOW_MS)}`;
}

async function consumeBucket(key, limit, now) {
  if (!isKvConfigured()) {
    return consumeMemoryBucket(key, limit, now);
  }

  try {
    const windowKey = buildWindowKey(key, now);
    const count = await kv.incr(windowKey);
    if (count === 1) {
      await kv.expire(windowKey, Math.ceil(WINDOW_MS / 1000) + 5);
    }
    return count <= limit;
  } catch (kvError) {
    // Redis unavailable or limit exceeded — fall back to in-memory rate limiting
    // so the site stays up even when Upstash quota is exhausted.
    console.warn('[middleware] KV error, falling back to memory bucket:', kvError?.message || kvError);
    return consumeMemoryBucket(key, limit, now);
  }
}

function tooManyResponse(kind) {
  console.warn(JSON.stringify({
    channel: 'request_audit',
    source: 'request_shield',
    timestamp: new Date().toISOString(),
    kind,
    statusCode: 429,
  }));
  if (kind === 'api') {
    return NextResponse.json(
      { message: 'Too many requests. Please slow down and try again shortly.' },
      {
        status: 429,
        headers: { 'Retry-After': '10' },
      }
    );
  }

  return new NextResponse('Too many requests. Please wait a moment and try again.', {
    status: 429,
    headers: { 'Retry-After': '10' },
  });
}

export async function middleware(request) {
  if (request.method === 'OPTIONS' || request.method === 'HEAD') {
    return NextResponse.next();
  }

  if (isDesktopLocalRequest(request)) {
    return NextResponse.next();
  }

  const policy = classifyRequest(request.nextUrl.pathname);
  if (!policy) {
    return NextResponse.next();
  }

  const now = Date.now();
  cleanupBuckets(now);

  const ipAddress = getClientIp(request);
  const visitorId = getVisitorId(request, ipAddress);

  const actorKey = `actor:${policy.bucket}:${visitorId}`;
  const ipKey = `ip:${policy.bucket}:${ipAddress}`;

  const actorAllowed = await consumeBucket(actorKey, policy.actorLimit, now);
  const ipAllowed = await consumeBucket(ipKey, policy.ipLimit, now);
  if (!actorAllowed || !ipAllowed) {
    return tooManyResponse(policy.kind);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff|woff2)$).*)',
  ],
};
