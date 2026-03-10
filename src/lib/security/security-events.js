import crypto from 'crypto';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';

export const SECURITY_EVENT_TYPES = {
  AUTH_SESSION_ISSUED: 'AUTH_SESSION_ISSUED',
  AUTH_SESSION_CLEARED: 'AUTH_SESSION_CLEARED',
  TOKEN_SCOPE_REJECTED: 'TOKEN_SCOPE_REJECTED',
  TOKEN_SCOPE_LEGACY_ACCEPTED: 'TOKEN_SCOPE_LEGACY_ACCEPTED',
  APP_CHECK_REJECTED: 'APP_CHECK_REJECTED',
  APP_CHECK_MISSING: 'APP_CHECK_MISSING',
  RATE_LIMIT_TRIGGERED: 'RATE_LIMIT_TRIGGERED',
  SECURITY_ANOMALY: 'SECURITY_ANOMALY',
};

const MAX_METADATA_SIZE = 6000;

function getHeader(req, name) {
  if (!req?.headers) return '';
  if (typeof req.headers.get === 'function') {
    return String(req.headers.get(name) || '').trim();
  }
  return String(req.headers[String(name || '').toLowerCase()] || '').trim();
}

function getIp(req) {
  const forwardedFor = getHeader(req, 'x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return getHeader(req, 'x-real-ip') || 'unknown';
}

function getUserAgent(req) {
  return getHeader(req, 'user-agent') || 'unknown';
}

function getPath(req) {
  if (!req) return 'unknown';
  if (req.nextUrl?.pathname) return String(req.nextUrl.pathname);
  const rawUrl = getHeader(req, 'x-url') || req.url || '';
  if (!rawUrl) return 'unknown';
  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return 'unknown';
  }
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  try {
    const encoded = JSON.stringify(metadata);
    if (encoded.length <= MAX_METADATA_SIZE) return metadata;
    return {
      truncated: true,
      originalSize: encoded.length,
    };
  } catch {
    return { truncated: true, reason: 'serialization_failed' };
  }
}

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

export async function logSecurityEvent({
  type,
  severity = 'warning',
  actorUid = null,
  req = null,
  source = 'security',
  metadata = {},
} = {}) {
  try {
    const firestore = await getFirestore();
    await firestore.collection('security_events').add({
      type: String(type || 'UNKNOWN').trim() || 'UNKNOWN',
      severity: String(severity || 'warning').trim() || 'warning',
      actorUid: actorUid ? String(actorUid).trim() : null,
      source: String(source || 'security').trim() || 'security',
      path: getPath(req),
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
      metadata: safeMetadata(metadata),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('[SECURITY_EVENT_LOG_FAILED]', error?.message || error);
  }
}

export async function recordSecurityAnomaly({
  type,
  key,
  threshold = 5,
  windowSec = 300,
  req = null,
  metadata = {},
  source = 'security',
} = {}) {
  const safeType = String(type || 'ANOMALY').trim() || 'ANOMALY';
  const safeKey = String(key || '').trim();
  if (!safeKey) return { count: 0, flagged: false };

  try {
    const firestore = await getFirestore();
    const windowStart = Math.floor(Date.now() / (Math.max(1, Number(windowSec) || 1) * 1000));
    const docId = `${safeType}:${hashKey(safeKey)}:${windowStart}`;
    const ref = firestore.collection('security_anomaly_windows').doc(docId);

    const result = await firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = snap.exists ? Number(snap.data()?.count || 0) : 0;
      const next = current + 1;
      const alreadyFlagged = Boolean(snap.data()?.flaggedAt);
      const shouldFlag = next >= threshold && !alreadyFlagged;

      const payload = {
        type: safeType,
        source: String(source || 'security').trim() || 'security',
        count: next,
        threshold,
        keyHash: hashKey(safeKey),
        windowStart,
        windowSec: Math.max(1, Number(windowSec) || 1),
        lastPath: getPath(req),
        lastIpAddress: getIp(req),
        lastUserAgent: getUserAgent(req),
        lastSeenAt: FieldValue.serverTimestamp(),
      };

      if (!snap.exists) {
        payload.createdAt = FieldValue.serverTimestamp();
      }
      if (shouldFlag) {
        payload.flaggedAt = FieldValue.serverTimestamp();
      }

      transaction.set(ref, payload, { merge: true });
      return { count: next, flagged: shouldFlag };
    });

    if (result.flagged) {
      await logSecurityEvent({
        type: SECURITY_EVENT_TYPES.SECURITY_ANOMALY,
        severity: 'high',
        req,
        source,
        metadata: {
          anomalyType: safeType,
          keyHash: hashKey(safeKey),
          threshold,
          count: result.count,
          ...safeMetadata(metadata),
        },
      });
    }

    return result;
  } catch (error) {
    console.error('[SECURITY_ANOMALY_FAILED]', error?.message || error);
    return { count: 0, flagged: false };
  }
}
