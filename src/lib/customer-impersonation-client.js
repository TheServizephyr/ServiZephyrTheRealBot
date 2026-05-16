'use client';

export function getCustomerImpersonationParams() {
  if (typeof window === 'undefined') return null;

  const currentParams = new URLSearchParams(window.location.search);
  const targetUserId = currentParams.get('impersonate_user_id');
  if (!targetUserId) return null;

  const params = new URLSearchParams();
  params.set('impersonate_user_id', targetUserId);

  const sessionExpiry = currentParams.get('session_expiry');
  if (sessionExpiry) {
    params.set('session_expiry', sessionExpiry);
  }

  return params;
}

export function getCustomerImpersonationQuery() {
  const params = getCustomerImpersonationParams();
  return params ? params.toString() : '';
}

export function withCustomerImpersonation(path) {
  const query = getCustomerImpersonationQuery();
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

export function isCustomerImpersonating() {
  return Boolean(getCustomerImpersonationParams());
}

export function getCustomerImpersonationCacheKey(prefix, fallbackUid) {
  const params = getCustomerImpersonationParams();
  if (!params) return `${prefix}:${fallbackUid || 'self'}`;
  return `${prefix}:impersonating:${params.get('impersonate_user_id') || 'unknown'}`;
}
