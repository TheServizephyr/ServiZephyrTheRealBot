import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { FieldValue, getAppCheck } from '@/lib/firebase-admin';
import { kv, isKvConfigured } from '@/lib/kv';
import { deobfuscateGuestId } from '@/lib/guest-utils';
import { logSecurityEvent, recordSecurityAnomaly, SECURITY_EVENT_TYPES } from '@/lib/security/security-events';

export const GUEST_SESSION_COOKIE_NAME = 'auth_guest_session';
const DEFAULT_GUEST_SCOPES = ['customer_lookup', 'active_orders', 'checkout', 'track_orders'];
const DEFAULT_GUEST_SESSION_MAX_AGE_SEC = 24 * 60 * 60;
const DEFAULT_GUEST_SESSION_TTL_MS = DEFAULT_GUEST_SESSION_MAX_AGE_SEC * 1000;
export const WHATSAPP_GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WHATSAPP_GUEST_SESSION_RENEW_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MEMORY_BUCKETS = globalThis.__servizephyrRateLimitBuckets || new Map();
globalThis.__servizephyrRateLimitBuckets = RATE_LIMIT_MEMORY_BUCKETS;

function base64UrlEncode(input) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input) {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function getSigningSecret() {
  const configuredSecret =
    process.env.GUEST_SESSION_SECRET ||
    process.env.PUBLIC_SESSION_SECRET ||
    process.env.SESSION_SIGNING_SECRET ||
    '';

  if (configuredSecret) return configuredSecret;

  const fallbackSeed =
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.FIREBASE_CLIENT_EMAIL ||
    'servizephyr-guest-session-fallback';

  return crypto.createHash('sha256').update(String(fallbackSeed)).digest('hex');
}

function signPayload(encodedPayload) {
  return crypto.createHmac('sha256', getSigningSecret()).update(encodedPayload).digest('base64url');
}

function createCookieValue(payload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseCookieValue(cookieValue) {
  const [encodedPayload, providedSignature] = String(cookieValue || '').split('.');
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = signPayload(encodedPayload);
  const safeProvided = Buffer.from(providedSignature);
  const safeExpected = Buffer.from(expectedSignature);
  if (safeProvided.length !== safeExpected.length) return null;
  if (!crypto.timingSafeEqual(safeProvided, safeExpected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload?.exp || Date.now() >= Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function normalizeScopes(scopes = []) {
  return [...new Set((Array.isArray(scopes) ? scopes : [scopes]).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function setSignedGuestSessionCookie(cookieStore, {
  subjectId,
  subjectType = 'guest',
  sessionId = '',
  scopes = DEFAULT_GUEST_SCOPES,
  maxAgeSec = DEFAULT_GUEST_SESSION_MAX_AGE_SEC,
} = {}) {
  const safeSubjectId = String(subjectId || '').trim();
  if (!safeSubjectId) {
    throw new Error('Guest session subject is required.');
  }

  const payload = {
    v: 1,
    sub: safeSubjectId,
    typ: String(subjectType || 'guest').trim() || 'guest',
    sid: String(sessionId || '').trim(),
    scp: normalizeScopes(scopes),
    exp: Date.now() + (Number(maxAgeSec) * 1000),
  };

  cookieStore.set({
    name: GUEST_SESSION_COOKIE_NAME,
    value: createCookieValue(payload),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Number(maxAgeSec),
  });

  return payload;
}

export function clearSignedGuestSessionCookie(cookieStore) {
  cookieStore.set({
    name: GUEST_SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function readSignedGuestSessionCookie(cookieStore, requiredScopes = []) {
  const cookieValue = cookieStore.get(GUEST_SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) return null;

  const payload = parseCookieValue(cookieValue);
  if (!payload) return null;

  const required = normalizeScopes(requiredScopes);
  if (required.length > 0) {
    const scopes = normalizeScopes(payload.scp);
    const hasAllScopes = required.every((scope) => scopes.includes(scope));
    if (!hasAllScopes) return null;
  }

  return {
    subjectId: String(payload.sub || '').trim(),
    subjectType: String(payload.typ || 'guest').trim() || 'guest',
    sessionId: String(payload.sid || '').trim(),
    scopes: normalizeScopes(payload.scp),
    expiresAtMs: Number(payload.exp || 0),
  };
}

function scopesSatisfied(sessionScopes = [], requiredScopes = []) {
  const required = normalizeScopes(requiredScopes);
  if (required.length === 0) return true;
  const scopes = normalizeScopes(sessionScopes);
  return required.every((scope) => scopes.includes(scope));
}

function buildRateLimitMetadata(bucket, key) {
  const parts = String(key || '').split(':');
  return {
    bucket: String(bucket || 'public_api_limits').trim() || 'public_api_limits',
    scope: String(parts[0] || bucket || 'unknown').trim() || 'unknown',
    ipAddress: String(parts[1] || '').trim(),
    subjectKey: parts.slice(2).join(':').slice(0, 120),
    keyHash: crypto.createHash('sha256').update(String(key || '')).digest('hex').slice(0, 24),
  };
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function consumeInMemoryRateLimit(key, limit, windowSec) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowSec = Math.max(1, Number(windowSec) || 1);
  const windowStart = Math.floor(Date.now() / (safeWindowSec * 1000));
  const bucketKey = `${String(key || '')}:${windowStart}`;
  const current = RATE_LIMIT_MEMORY_BUCKETS.get(bucketKey) || 0;

  for (const existingKey of RATE_LIMIT_MEMORY_BUCKETS.keys()) {
    if (!existingKey.endsWith(`:${windowStart}`)) {
      RATE_LIMIT_MEMORY_BUCKETS.delete(existingKey);
    }
  }

  if (current >= safeLimit) {
    return { allowed: false, retryAfterSec: safeWindowSec, windowStart, source: 'memory' };
  }

  RATE_LIMIT_MEMORY_BUCKETS.set(bucketKey, current + 1);
  return { allowed: true, retryAfterSec: 0, windowStart, source: 'memory' };
}

async function consumeKvRateLimit(bucket, key, limit, windowSec) {
  if (!isKvConfigured()) return null;

  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowSec = Math.max(1, Number(windowSec) || 1);
  const windowStart = Math.floor(Date.now() / (safeWindowSec * 1000));
  const bucketKey = `rate_limit:${String(bucket || 'public_api_limits').trim() || 'public_api_limits'}:${String(key || '').trim()}:${windowStart}`;
  const currentCount = Number(await kv.incr(bucketKey)) || 0;
  if (currentCount === 1) {
    await kv.expire(bucketKey, safeWindowSec);
  }

  return {
    allowed: currentCount <= safeLimit,
    retryAfterSec: currentCount <= safeLimit ? 0 : safeWindowSec,
    windowStart,
    source: 'kv',
  };
}

export async function issueGuestAccessRef(firestore, {
  subjectId,
  subjectType = 'guest',
  phone = '',
  scopes = DEFAULT_GUEST_SCOPES,
  ttlMs = DEFAULT_GUEST_SESSION_TTL_MS,
  businessId = '',
  channel = 'whatsapp',
  metadata = {},
} = {}) {
  const safeSubjectId = String(subjectId || '').trim();
  if (!safeSubjectId) {
    throw new Error('Guest ref subject is required.');
  }

  const safeChannel = String(channel || 'whatsapp').trim() || 'whatsapp';
  const requestedTtlMs = Number(ttlMs);
  const effectiveTtlMs = requestedTtlMs > 0
    ? requestedTtlMs
    : (safeChannel === 'whatsapp' ? WHATSAPP_GUEST_SESSION_TTL_MS : DEFAULT_GUEST_SESSION_TTL_MS);
  const ref = nanoid(32);
  const expiresAt = new Date(Date.now() + Math.max(60_000, effectiveTtlMs));
  await firestore.collection('guest_sessions').doc(ref).set({
    subjectId: safeSubjectId,
    subjectType: String(subjectType || 'guest').trim() || 'guest',
    phone: String(phone || '').trim(),
    businessId: String(businessId || '').trim(),
    channel: safeChannel,
    scopes: normalizeScopes(scopes),
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: FieldValue.serverTimestamp(),
    expiresAt,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });

  return { ref, expiresAt };
}

export async function resolveGuestAccessRef(firestore, ref, {
  requiredScopes = [],
  allowLegacy = true,
  touch = false,
} = {}) {
  const safeRef = String(ref || '').trim();
  if (!safeRef) return null;

  const sessionDoc = await firestore.collection('guest_sessions').doc(safeRef).get();
  if (sessionDoc.exists) {
    const sessionData = sessionDoc.data() || {};
    const expiresAt = toDate(sessionData.expiresAt);
    const expired = !expiresAt || Date.now() >= expiresAt.getTime();
    const revoked = String(sessionData.status || '').toLowerCase() === 'revoked';
    const safeChannel = String(sessionData.channel || '').trim().toLowerCase();
    const effectiveScopes = normalizeScopes(
      Array.isArray(sessionData.scopes) && sessionData.scopes.length > 0
        ? sessionData.scopes
        : DEFAULT_GUEST_SCOPES
    );

    if (!expired && !revoked && scopesSatisfied(effectiveScopes, requiredScopes)) {
      if (touch) {
        void sessionDoc.ref.set({ lastUsedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return {
        subjectId: String(sessionData.subjectId || '').trim(),
        subjectType: String(sessionData.subjectType || 'guest').trim() || 'guest',
        phone: String(sessionData.phone || '').trim(),
        businessId: String(sessionData.businessId || '').trim(),
        scopes: effectiveScopes,
        sessionId: sessionDoc.id,
        source: 'session_ref',
        legacy: false,
      };
    }

    const renewableWhatsappSession =
      expired
      && !revoked
      && safeChannel === 'whatsapp'
      && expiresAt
      && (Date.now() - expiresAt.getTime()) <= WHATSAPP_GUEST_SESSION_RENEW_GRACE_MS
      && scopesSatisfied(effectiveScopes, requiredScopes);

    if (renewableWhatsappSession) {
      const renewedExpiresAt = new Date(Date.now() + WHATSAPP_GUEST_SESSION_TTL_MS);
      await sessionDoc.ref.set({
        expiresAt: renewedExpiresAt,
        lastUsedAt: FieldValue.serverTimestamp(),
        status: 'active',
      }, { merge: true });

      return {
        subjectId: String(sessionData.subjectId || '').trim(),
        subjectType: String(sessionData.subjectType || 'guest').trim() || 'guest',
        phone: String(sessionData.phone || '').trim(),
        businessId: String(sessionData.businessId || '').trim(),
        scopes: effectiveScopes,
        sessionId: sessionDoc.id,
        source: 'renewed_session_ref',
        legacy: false,
      };
    }
    return null;
  }

  if (!allowLegacy) return null;

  const legacySubjectId = deobfuscateGuestId(safeRef);
  if (!legacySubjectId) return null;

  return {
    subjectId: legacySubjectId,
    subjectType: String(legacySubjectId).startsWith('g_') ? 'guest' : 'user',
    phone: '',
    businessId: '',
    scopes: ['legacy_ref'],
    sessionId: '',
    source: 'legacy_ref',
    legacy: true,
  };
}

export async function verifyScopedAuthToken(firestore, token, {
  allowedTypes = ['tracking'],
  requiredScopes = [],
  subjectId = '',
  orderId = '',
  req = null,
  auditContext = 'public_auth',
} = {}) {
  const safeToken = String(token || '').trim();
  const tokenHash = safeToken
    ? crypto.createHash('sha256').update(safeToken).digest('hex').slice(0, 16)
    : 'missing';
  const reject = (reason, tokenData = null) => {
    void logSecurityEvent({
      type: SECURITY_EVENT_TYPES.TOKEN_SCOPE_REJECTED,
      severity: 'warning',
      req,
      source: auditContext,
      metadata: {
        reason,
        tokenHash,
        allowedTypes,
        requiredScopes,
        subjectId: String(subjectId || '').trim(),
        orderId: String(orderId || '').trim(),
        tokenType: tokenData?.type || '',
      },
    });
    void recordSecurityAnomaly({
      type: `token_scope_${reason}`,
      key: `${tokenHash}:${String(subjectId || '').trim()}:${String(orderId || '').trim()}`,
      threshold: 5,
      windowSec: 300,
      req,
      source: auditContext,
      metadata: { reason },
    });
    return { valid: false, reason, tokenData };
  };

  if (!safeToken) return reject('missing_token');

  const tokenDoc = await firestore.collection('auth_tokens').doc(safeToken).get();
  if (!tokenDoc.exists) return reject('not_found');

  const tokenData = tokenDoc.data() || {};
  const expiresAt = toDate(tokenData.expiresAt);
  if (!expiresAt || Date.now() >= expiresAt.getTime()) {
    void tokenDoc.ref.delete().catch(() => {});
    return reject('expired');
  }

  const type = String(tokenData.type || '').trim();
  if (allowedTypes.length > 0 && !allowedTypes.includes(type)) {
    return reject('type_mismatch', tokenData);
  }

  const tokenScopes = normalizeScopes(tokenData.scopes || tokenData.scope || []);
  if (requiredScopes.length > 0 && tokenScopes.length > 0 && !scopesSatisfied(tokenScopes, requiredScopes)) {
    return reject('scope_mismatch', tokenData);
  }

  const safeSubjectId = String(subjectId || '').trim();
  if (safeSubjectId) {
    const tokenSubjects = [
      tokenData.userId,
      tokenData.guestId,
      tokenData.uid,
      tokenData.subjectId,
      tokenData.phone,
    ].map((value) => String(value || '').trim()).filter(Boolean);

    if (!tokenSubjects.includes(safeSubjectId)) {
      return reject('subject_mismatch', tokenData);
    }
  }

  const safeOrderId = String(orderId || '').trim();
  if (safeOrderId && tokenData.orderId && String(tokenData.orderId).trim() !== safeOrderId) {
    return reject('order_mismatch', tokenData);
  }

  if (tokenScopes.length === 0) {
    void logSecurityEvent({
      type: SECURITY_EVENT_TYPES.TOKEN_SCOPE_LEGACY_ACCEPTED,
      severity: 'info',
      req,
      source: auditContext,
      metadata: {
        tokenHash,
        allowedTypes,
        subjectId: String(subjectId || '').trim(),
        orderId: safeOrderId,
      },
    });
  }

  return {
    valid: true,
    tokenData,
    scopes: tokenScopes,
    legacy: tokenScopes.length === 0,
  };
}

export async function enforceRateLimit(_firestore, {
  bucket = 'public_api_limits',
  key,
  limit = 30,
  windowSec = 60,
  req = null,
  auditContext = 'public_api_limits',
} = {}) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return { allowed: true };

  let result = null;
  try {
    result = await consumeKvRateLimit(bucket, safeKey, limit, windowSec);
  } catch (error) {
    console.warn('[public-auth] Rate-limit storage degraded to memory fallback:', error?.message || error);
  }

  if (!result) {
    result = consumeInMemoryRateLimit(`${bucket}:${safeKey}`, limit, windowSec);
  }

  if (!result.allowed) {
    void recordSecurityAnomaly({
      type: 'rate_limit_triggered',
      key: `${bucket}:${safeKey}`,
      threshold: 3,
      windowSec: Math.max(60, windowSec),
      req,
      source: auditContext,
      metadata: {
        bucket,
        limit,
        windowSec,
        layer: result.source || 'memory',
        ...buildRateLimitMetadata(bucket, safeKey),
      },
    });
  }

  return result;
}

export async function verifyAppCheckToken(req, { required = false } = {}) {
  const explicit = process.env.ENFORCE_FIREBASE_APP_CHECK;
  const hasAppCheckConfig = Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY ||
    process.env.FIREBASE_APPCHECK_SITE_KEY
  );
  const enforce = required
    || explicit === 'true'
    || (process.env.NODE_ENV === 'production' && explicit !== 'false' && hasAppCheckConfig);
  const appCheckToken =
    req.headers.get('x-firebase-appcheck') ||
    req.headers.get('x-firebase-app-check') ||
    '';

  if (!appCheckToken) {
    if (enforce) {
      void logSecurityEvent({
        type: SECURITY_EVENT_TYPES.APP_CHECK_MISSING,
        severity: 'warning',
        req,
        source: 'app_check',
        metadata: { required: enforce },
      });
      void recordSecurityAnomaly({
        type: 'app_check_missing',
        key: `${req?.nextUrl?.pathname || 'unknown'}:${req?.headers?.get?.('x-forwarded-for') || 'unknown'}`,
        threshold: 5,
        windowSec: 300,
        req,
        source: 'app_check',
      });
    }
    if (enforce) {
      throw { message: 'App integrity check required.', status: 401, code: 'APP_CHECK_MISSING' };
    }
    return { verified: false, skipped: true };
  }

  try {
    const appCheck = await getAppCheck();
    await appCheck.verifyToken(appCheckToken);
    return { verified: true, skipped: false };
  } catch (error) {
    void logSecurityEvent({
      type: SECURITY_EVENT_TYPES.APP_CHECK_REJECTED,
      severity: 'warning',
      req,
      source: 'app_check',
      metadata: { code: error?.code || 'APP_CHECK_FAILED' },
    });
    void recordSecurityAnomaly({
      type: 'app_check_rejected',
      key: `${req?.nextUrl?.pathname || 'unknown'}:${req?.headers?.get?.('x-forwarded-for') || 'unknown'}`,
      threshold: 5,
      windowSec: 300,
      req,
      source: 'app_check',
      metadata: { code: error?.code || 'APP_CHECK_FAILED' },
    });
    throw {
      message: 'App integrity verification failed.',
      status: 401,
      code: error?.code || 'APP_CHECK_FAILED',
    };
  }
}
