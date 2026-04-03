import crypto from 'crypto';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { kv, isKvConfigured } from '@/lib/kv';

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
const SECURITY_ANOMALY_MEMORY_BUCKETS = globalThis.__servizephyrSecurityAnomalyBuckets || new Map();
globalThis.__servizephyrSecurityAnomalyBuckets = SECURITY_ANOMALY_MEMORY_BUCKETS;

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

function getSecurityAnomalyWindow(type, keyHash, windowSec) {
  const safeWindowSec = Math.max(1, Number(windowSec) || 1);
  const windowStart = Math.floor(Date.now() / (safeWindowSec * 1000));
  return {
    safeWindowSec,
    windowStart,
    bucketKey: `security:anomaly:${type}:${keyHash}:${windowStart}`,
    countKey: `security:anomaly:${type}:${keyHash}:${windowStart}:count`,
    flagKey: `security:anomaly:${type}:${keyHash}:${windowStart}:flag`,
  };
}

function recordSecurityAnomalyInMemory({ type, keyHash, threshold, windowSec }) {
  const { safeWindowSec, windowStart, bucketKey } = getSecurityAnomalyWindow(type, keyHash, windowSec);
  const now = Date.now();

  for (const [existingKey, entry] of SECURITY_ANOMALY_MEMORY_BUCKETS.entries()) {
    if (!entry?.expiresAt || entry.expiresAt <= now) {
      SECURITY_ANOMALY_MEMORY_BUCKETS.delete(existingKey);
    }
  }

  const existing = SECURITY_ANOMALY_MEMORY_BUCKETS.get(bucketKey) || {
    count: 0,
    flagged: false,
    expiresAt: now + (safeWindowSec * 1000),
    windowStart,
  };

  existing.count += 1;
  const shouldFlag = existing.count >= threshold && !existing.flagged;
  if (shouldFlag) {
    existing.flagged = true;
  }
  existing.expiresAt = now + (safeWindowSec * 1000);
  SECURITY_ANOMALY_MEMORY_BUCKETS.set(bucketKey, existing);

  return {
    count: existing.count,
    flagged: shouldFlag,
    source: 'memory',
    windowStart,
  };
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
  const keyHash = hashKey(safeKey);
  const safeThreshold = Math.max(1, Number(threshold) || 1);
  const safeWindowSec = Math.max(1, Number(windowSec) || 1);

  try {
    let result = null;

    if (isKvConfigured()) {
      const { countKey, flagKey, windowStart } = getSecurityAnomalyWindow(safeType, keyHash, safeWindowSec);
      const count = Number(await kv.incr(countKey)) || 0;
      if (count === 1) {
        await kv.expire(countKey, safeWindowSec);
      }

      let flagged = false;
      if (count >= safeThreshold) {
        const flagResult = await kv.set(flagKey, '1', { ex: safeWindowSec, nx: true });
        flagged = Boolean(flagResult);
      }

      result = {
        count,
        flagged,
        source: 'kv',
        windowStart,
      };
    } else {
      result = recordSecurityAnomalyInMemory({
        type: safeType,
        keyHash,
        threshold: safeThreshold,
        windowSec: safeWindowSec,
      });
    }

    if (result.flagged) {
      await logSecurityEvent({
        type: SECURITY_EVENT_TYPES.SECURITY_ANOMALY,
        severity: 'high',
        req,
        source,
        metadata: {
          anomalyType: safeType,
          keyHash,
          threshold: safeThreshold,
          count: result.count,
          storage: result.source,
          ...safeMetadata(metadata),
        },
      });
    }

    return result;
  } catch (error) {
    console.error('[SECURITY_ANOMALY_FAILED]', error?.message || error);
    return recordSecurityAnomalyInMemory({
      type: safeType,
      keyHash,
      threshold: safeThreshold,
      windowSec: safeWindowSec,
    });
  }
}
