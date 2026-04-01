import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const AUTH_ROLE_CACHE_KEY = 'servizephyr_auth_role_cache_v1';
const AUTH_ROLE_LEGACY_KEY = 'servizephyr_auth_role_legacy_v1';

export function normalizeBusinessType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'shop') return 'store';
  return normalized;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readRawCache() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(AUTH_ROLE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeRawCache(payload) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(AUTH_ROLE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
}

function readLegacyRoleCache() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(AUTH_ROLE_LEGACY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLegacyRoleCache(payload) {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(AUTH_ROLE_LEGACY_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
}

function buildEmployeeRedirect(outlet = {}) {
  if (outlet.collectionName === 'street_vendors') {
    return '/street-vendor-dashboard';
  }
  return '/owner-dashboard/live-orders';
}

function buildResolvedProfile(role, businessType = null, extra = {}) {
  return {
    role: role || '',
    businessType: normalizeBusinessType(businessType),
    ...extra,
  };
}

export function persistResolvedAuthProfile(user, data = {}) {
  if (!user || !data) return;
  const payload = {
    uid: String(user.uid || '').trim(),
    email: String(user.email || '').trim().toLowerCase(),
    role: data.role || '',
    businessType: normalizeBusinessType(data.businessType),
    redirectTo: data.redirectTo || '',
    hasMultipleRoles: !!data.hasMultipleRoles,
    updatedAt: new Date().toISOString(),
  };
  writeRawCache(payload);
  writeLegacyRoleCache(payload);
}

export function readResolvedAuthProfile(user) {
  const cached = readRawCache();
  const legacyCached = readLegacyRoleCache();
  const candidate = cached || legacyCached;
  if (!candidate || !user) return null;

  const sameUid = candidate.uid && user.uid && String(candidate.uid) === String(user.uid);
  const sameEmail =
    candidate.email &&
    user.email &&
    String(candidate.email).toLowerCase() === String(user.email).toLowerCase();

  if (!sameUid && !sameEmail) return null;
  return candidate;
}

export function applyRoleContext(role, businessType = null) {
  if (!canUseStorage()) return;
  localStorage.setItem('role', role || 'customer');
  const normalizedBusinessType = normalizeBusinessType(businessType);
  if (normalizedBusinessType) {
    localStorage.setItem('businessType', normalizedBusinessType);
  } else {
    localStorage.removeItem('businessType');
  }
}

export function resolveRedirectForAuthData(data = {}) {
  if (data?.hasMultipleRoles) return '/select-role';
  if (data?.redirectTo) return data.redirectTo;

  const role = String(data?.role || '').trim().toLowerCase();
  if (role === 'owner' || role === 'restaurant-owner' || role === 'shop-owner') return '/owner-dashboard';
  if (role === 'street-vendor') return '/street-vendor-dashboard';
  if (role === 'admin') return '/admin-dashboard';
  if (role === 'rider' || role === 'delivery-boy') return '/rider-dashboard';
  if (role === 'employee') return '/employee-dashboard';
  if (role === 'customer') return '/customer-dashboard';
  return '';
}

export function hydrateAndResolveCachedAuth(user) {
  const cached = readResolvedAuthProfile(user);
  if (!cached) return null;

  if (cached.hasMultipleRoles) {
    applyRoleContext(cached.role || 'customer', cached.businessType);
    return '/select-role';
  }

  if (cached.redirectTo) {
    applyRoleContext(cached.role || 'employee', cached.businessType);
    return cached.redirectTo;
  }

  const redirectPath = resolveRedirectForAuthData(cached);
  if (!redirectPath) return null;

  applyRoleContext(cached.role || 'customer', cached.businessType);
  return redirectPath;
}

function mapClientUserDocToProfile(userData = {}) {
  const role = String(userData?.role || '').trim().toLowerCase();
  const businessType = normalizeBusinessType(userData?.businessType);
  const linkedOutlets = Array.isArray(userData?.linkedOutlets)
    ? userData.linkedOutlets.filter((outlet) => outlet?.status === 'active')
    : [];

  const hasEmployeeRole = linkedOutlets.length > 0;
  const isOwnerOrVendor = ['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(role);

  if (hasEmployeeRole && (isOwnerOrVendor || role === 'customer' || role === 'admin')) {
    return buildResolvedProfile(role, businessType, {
      hasMultipleRoles: true,
      linkedOutlets,
    });
  }

  if (hasEmployeeRole && (!role || role === 'customer' || role === 'employee')) {
    const outlet = linkedOutlets.find((entry) => entry?.isActive) || linkedOutlets[0];
    if (outlet) {
      return buildResolvedProfile('employee', null, {
        redirectTo: buildEmployeeRedirect(outlet),
        employeeRole: outlet.employeeRole || '',
        linkedOutlets,
      });
    }
  }

  if (role) {
    return buildResolvedProfile(role, businessType, { linkedOutlets });
  }

  return null;
}

export async function resolveAuthProfileFromClient(user) {
  if (!user?.uid) return null;

  const userDoc = await getDoc(doc(db, 'users', user.uid));
  if (userDoc.exists()) {
    const payload = mapClientUserDocToProfile(userDoc.data() || {});
    if (payload) return payload;
  }

  const driverDoc = await getDoc(doc(db, 'drivers', user.uid));
  if (driverDoc.exists()) {
    return buildResolvedProfile('rider', null);
  }

  return null;
}

export async function resolveBestEffortAuthRedirect(user) {
  const cachedRedirect = hydrateAndResolveCachedAuth(user);
  if (cachedRedirect) return cachedRedirect;

  try {
    const resolvedProfile = await resolveAuthProfileFromClient(user);
    if (!resolvedProfile) return null;

    persistResolvedAuthProfile(user, resolvedProfile);
    applyRoleContext(resolvedProfile.role || 'customer', resolvedProfile.businessType);

    if (resolvedProfile.hasMultipleRoles) return '/select-role';
    if (resolvedProfile.redirectTo) return resolvedProfile.redirectTo;
    return resolveRedirectForAuthData(resolvedProfile);
  } catch {
    return null;
  }
}
