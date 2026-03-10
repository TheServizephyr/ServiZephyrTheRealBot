import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { FieldValue, getAppCheck } from '@/lib/firebase-admin';
import { deobfuscateGuestId } from '@/lib/guest-utils';

export const GUEST_SESSION_COOKIE_NAME = 'auth_guest_session';
const DEFAULT_GUEST_SCOPES = ['customer_lookup', 'active_orders', 'checkout', 'track_orders'];

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
  maxAgeSec = 7 * 24 * 60 * 60,
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

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function issueGuestAccessRef(firestore, {
  subjectId,
  subjectType = 'guest',
  phone = '',
  scopes = DEFAULT_GUEST_SCOPES,
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  businessId = '',
  channel = 'whatsapp',
  metadata = {},
} = {}) {
  const safeSubjectId = String(subjectId || '').trim();
  if (!safeSubjectId) {
    throw new Error('Guest ref subject is required.');
  }

  const ref = nanoid(32);
  const expiresAt = new Date(Date.now() + Math.max(60_000, Number(ttlMs) || 0));
  await firestore.collection('guest_sessions').doc(ref).set({
    subjectId: safeSubjectId,
    subjectType: String(subjectType || 'guest').trim() || 'guest',
    phone: String(phone || '').trim(),
    businessId: String(businessId || '').trim(),
    channel: String(channel || 'whatsapp').trim() || 'whatsapp',
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

    if (!expired && !revoked && scopesSatisfied(sessionData.scopes || [], requiredScopes)) {
      if (touch) {
        void sessionDoc.ref.set({ lastUsedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return {
        subjectId: String(sessionData.subjectId || '').trim(),
        subjectType: String(sessionData.subjectType || 'guest').trim() || 'guest',
        scopes: normalizeScopes(sessionData.scopes || []),
        sessionId: sessionDoc.id,
        source: 'session_ref',
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
} = {}) {
  const safeToken = String(token || '').trim();
  if (!safeToken) return { valid: false, reason: 'missing_token' };

  const tokenDoc = await firestore.collection('auth_tokens').doc(safeToken).get();
  if (!tokenDoc.exists) return { valid: false, reason: 'not_found' };

  const tokenData = tokenDoc.data() || {};
  const expiresAt = toDate(tokenData.expiresAt);
  if (!expiresAt || Date.now() >= expiresAt.getTime()) {
    void tokenDoc.ref.delete().catch(() => {});
    return { valid: false, reason: 'expired' };
  }

  const type = String(tokenData.type || '').trim();
  if (allowedTypes.length > 0 && !allowedTypes.includes(type)) {
    return { valid: false, reason: 'type_mismatch', tokenData };
  }

  const tokenScopes = normalizeScopes(tokenData.scopes || tokenData.scope || []);
  if (requiredScopes.length > 0 && tokenScopes.length > 0 && !scopesSatisfied(tokenScopes, requiredScopes)) {
    return { valid: false, reason: 'scope_mismatch', tokenData };
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
      return { valid: false, reason: 'subject_mismatch', tokenData };
    }
  }

  const safeOrderId = String(orderId || '').trim();
  if (safeOrderId && tokenData.orderId && String(tokenData.orderId).trim() !== safeOrderId) {
    return { valid: false, reason: 'order_mismatch', tokenData };
  }

  return {
    valid: true,
    tokenData,
    scopes: tokenScopes,
    legacy: tokenScopes.length === 0,
  };
}

export async function enforceRateLimit(firestore, {
  bucket = 'public_api_limits',
  key,
  limit = 30,
  windowSec = 60,
} = {}) {
  const safeKey = String(key || '').trim();
  if (!safeKey) return { allowed: true };

  const windowStart = Math.floor(Date.now() / (windowSec * 1000));
  const docId = `${safeKey}:${windowStart}`;
  const ref = firestore.collection(bucket).doc(docId);

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const currentCount = snap.exists ? Number(snap.data()?.count || 0) : 0;

    if (currentCount >= limit) {
      return { allowed: false, retryAfterSec: windowSec };
    }

    if (!snap.exists) {
      transaction.set(ref, {
        key: safeKey,
        count: 1,
        windowStart,
        expiresAt: new Date(Date.now() + windowSec * 1000),
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      transaction.update(ref, {
        count: FieldValue.increment(1),
      });
    }

    return { allowed: true, retryAfterSec: 0 };
  });
}

export async function verifyAppCheckToken(req, { required = false } = {}) {
  const enforce = required || process.env.ENFORCE_FIREBASE_APP_CHECK === 'true';
  const appCheckToken =
    req.headers.get('x-firebase-appcheck') ||
    req.headers.get('x-firebase-app-check') ||
    '';

  if (!appCheckToken) {
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
    throw {
      message: 'App integrity verification failed.',
      status: 401,
      code: error?.code || 'APP_CHECK_FAILED',
    };
  }
}
