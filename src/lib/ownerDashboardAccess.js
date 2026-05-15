import { ROLES, canAccessPage, normalizeBusinessType } from '@/lib/permissions';

const OWNER_DASHBOARD_FEATURE_PATHS = {
  'manual-order': '/owner-dashboard/manual-order',
  'live-orders': '/owner-dashboard/live-orders',
  menu: '/owner-dashboard/menu',
  inventory: '/owner-dashboard/inventory',
  'dine-in': '/owner-dashboard/dine-in',
  bookings: '/owner-dashboard/bookings',
  employees: '/owner-dashboard/employees',
  customers: '/owner-dashboard/customers',
  borrowers: '/owner-dashboard/borrowers',
  'whatsapp-direct': '/owner-dashboard/whatsapp-direct',
  analytics: '/owner-dashboard/analytics',
  delivery: '/owner-dashboard/delivery',
  coupons: '/owner-dashboard/coupons',
  'my-profile': '/owner-dashboard/my-profile',
  profile: '/owner-dashboard/my-profile',
  settings: '/owner-dashboard/settings',
  connections: '/owner-dashboard/connections',
  location: '/owner-dashboard/location',
  'payout-settings': '/owner-dashboard/payout-settings',
  payouts: '/owner-dashboard/payouts',
};

const DEFAULT_OWNER_DASHBOARD_FEATURE_ORDER = [
  'live-orders',
  'manual-order',
  'bookings',
  'dine-in',
  'menu',
  'inventory',
  'customers',
  'borrowers',
  'whatsapp-direct',
  'analytics',
  'delivery',
  'coupons',
  'employees',
  'my-profile',
  'settings',
];

const PENDING_STATUS_ENABLED_FEATURES = new Set([
  'menu',
  'settings',
  'connections',
  'payout-settings',
  'whatsapp-direct',
  'location',
  'my-profile',
  'profile',
]);

const HISTORY_FEATURE_MAP = {
  'order-history': 'live-orders',
  'manual-order-history': 'manual-order',
  'dine-in-history': 'dine-in',
  'dine-in-waiter': 'dine-in',
  'custom-bill-history': 'custom-bill',
};

export function getOwnerDashboardPathForFeature(featureId) {
  return OWNER_DASHBOARD_FEATURE_PATHS[String(featureId || '').trim()] || '';
}

export function resolveOwnerDashboardFeatureIdFromPath(pathname) {
  const segments = String(pathname || '').split('/').filter(Boolean);
  if (segments[0] !== 'owner-dashboard') return segments[segments.length - 1] || '';
  if (segments.length === 1) return 'dashboard';

  const section = segments[1] || 'dashboard';
  if (section === 'settings' && segments[2] === 'connections') return 'connections';
  if (section === 'settings' && segments[2] === 'location') return 'location';
  return HISTORY_FEATURE_MAP[section] || section;
}

export function appendDashboardScope(path, { impersonatedOwnerId = '', employeeOfOwnerId = '' } = {}) {
  const basePath = path || '/owner-dashboard/live-orders';
  const params = new URLSearchParams();
  if (impersonatedOwnerId) params.set('impersonate_owner_id', String(impersonatedOwnerId));
  else if (employeeOfOwnerId) params.set('employee_of', String(employeeOfOwnerId));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function isDisabledByBusinessType(featureId, businessType) {
  const normalizedBusinessType = normalizeBusinessType(businessType) || 'restaurant';
  if (normalizedBusinessType === 'store') {
    return featureId === 'dine-in' || featureId === 'bookings';
  }
  return false;
}

function isDisabledByAccountStatus(featureId, status, restrictedFeatures = [], lockedFeatures = [], businessType = 'restaurant') {
  if (lockedFeatures?.includes?.(featureId)) return true;
  if (status === 'suspended' && restrictedFeatures?.includes?.(featureId)) return true;
  if (status !== 'pending' && status !== 'rejected') return false;

  const pendingAllowed = new Set(PENDING_STATUS_ENABLED_FEATURES);
  if ((normalizeBusinessType(businessType) || 'restaurant') === 'restaurant') {
    pendingAllowed.add('dine-in');
    pendingAllowed.add('bookings');
  }
  return !pendingAllowed.has(featureId);
}

export function canAccessOwnerDashboardFeature({
  role = ROLES.OWNER,
  featureId,
  customAllowedPages = null,
  businessType = 'restaurant',
  status = 'approved',
  restrictedFeatures = [],
  lockedFeatures = [],
} = {}) {
  if (!featureId || featureId === 'dashboard') return true;
  if (isDisabledByBusinessType(featureId, businessType)) return false;
  if (isDisabledByAccountStatus(featureId, status, restrictedFeatures, lockedFeatures, businessType)) return false;
  return canAccessPage(role || ROLES.OWNER, featureId, customAllowedPages, businessType);
}

export function getDefaultOwnerDashboardPathForAccess({
  role = ROLES.OWNER,
  customAllowedPages = null,
  businessType = 'restaurant',
  status = 'approved',
  restrictedFeatures = [],
  lockedFeatures = [],
} = {}) {
  const effectiveRole = role || ROLES.OWNER;

  for (const featureId of DEFAULT_OWNER_DASHBOARD_FEATURE_ORDER) {
    if (
      canAccessOwnerDashboardFeature({
        role: effectiveRole,
        featureId,
        customAllowedPages,
        businessType,
        status,
        restrictedFeatures,
        lockedFeatures,
      })
    ) {
      return getOwnerDashboardPathForFeature(featureId);
    }
  }

  if (canAccessPage(effectiveRole, 'my-profile', customAllowedPages, businessType)) {
    return '/owner-dashboard/my-profile';
  }

  return '/select-role';
}
