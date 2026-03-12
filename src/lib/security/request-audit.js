import crypto from 'crypto';

function getHeader(req, name) {
  if (!req?.headers) return '';
  if (typeof req.headers.get === 'function') {
    return String(req.headers.get(name) || '').trim();
  }
  return String(req.headers[String(name || '').toLowerCase()] || '').trim();
}

function getPath(req) {
  if (!req) return 'unknown';
  if (req.nextUrl?.pathname) return String(req.nextUrl.pathname);
  const rawUrl = req.url || getHeader(req, 'x-url') || '';
  if (!rawUrl) return 'unknown';
  try {
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return 'unknown';
  }
}

function getIp(req) {
  const forwardedFor = getHeader(req, 'x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return getHeader(req, 'x-real-ip') || 'unknown';
}

function getMethod(req) {
  return String(req?.method || 'GET').toUpperCase();
}

function getRequestId(req) {
  return getHeader(req, 'x-request-id') || getHeader(req, 'x-vercel-id') || null;
}

export function hashAuditValue(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function logRequestAudit({
  req,
  statusCode = 200,
  source = 'api',
  actorUid = null,
  tokenId = null,
  metadata = {},
} = {}) {
  if (process.env.ENABLE_REQUEST_AUDIT_LOGS === 'false') return;

  const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  const entry = {
    channel: 'request_audit',
    source: String(source || 'api').trim() || 'api',
    timestamp: new Date().toISOString(),
    method: getMethod(req),
    path: getPath(req),
    ipAddress: getIp(req),
    statusCode: Number(statusCode) || 0,
    actorUid: actorUid ? String(actorUid).trim() : null,
    tokenId: tokenId ? String(tokenId).trim() : null,
    requestId: getRequestId(req),
    metadata: safeMetadata,
  };

  if (entry.statusCode >= 500) {
    console.error(JSON.stringify(entry));
    return;
  }

  if (entry.statusCode >= 400) {
    console.warn(JSON.stringify(entry));
    return;
  }

  console.info(JSON.stringify(entry));
}
