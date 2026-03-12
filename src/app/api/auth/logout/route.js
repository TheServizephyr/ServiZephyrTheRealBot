import { NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE_NAME, revokeAuthSessionsForRequest } from '@/lib/firebase-admin';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/public-auth';
import { logSecurityEvent, SECURITY_EVENT_TYPES } from '@/lib/security/security-events';
import { hashAuditValue, logRequestAudit } from '@/lib/security/request-audit';

function clearCookie(response, name) {
  response.cookies.set({
    name,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function POST(request) {
  const auditTokenId = hashAuditValue(
    request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value
    || request.headers.get('authorization')
    || request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value
    || ''
  );
  const response = NextResponse.json({ ok: true }, { status: 200 });
  const revoked = await revokeAuthSessionsForRequest(request);
  clearCookie(response, AUTH_SESSION_COOKIE_NAME);
  clearCookie(response, GUEST_SESSION_COOKIE_NAME);
  response.headers.set('Cache-Control', 'no-store');

  void logSecurityEvent({
    type: SECURITY_EVENT_TYPES.AUTH_SESSION_CLEARED,
    severity: 'info',
    req: request,
    source: 'auth_logout',
    metadata: { revoked },
  });
  logRequestAudit({
    req: request,
    statusCode: 200,
    source: 'auth_logout',
    actorUid: null,
    tokenId: auditTokenId,
    metadata: {
      outcome: 'session_cleared',
      revoked,
    },
  });

  return response;
}
