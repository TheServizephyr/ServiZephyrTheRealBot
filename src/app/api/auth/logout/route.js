import { NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/firebase-admin';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/public-auth';
import { logSecurityEvent, SECURITY_EVENT_TYPES } from '@/lib/security/security-events';

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
  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearCookie(response, AUTH_SESSION_COOKIE_NAME);
  clearCookie(response, GUEST_SESSION_COOKIE_NAME);
  response.headers.set('Cache-Control', 'no-store');

  void logSecurityEvent({
    type: SECURITY_EVENT_TYPES.AUTH_SESSION_CLEARED,
    severity: 'info',
    req: request,
    source: 'auth_logout',
  });

  return response;
}
