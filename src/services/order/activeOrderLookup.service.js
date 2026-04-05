import { getOrCreateGuestProfile } from '@/lib/guest-utils';
import { resolveGuestAccessRef } from '@/lib/public-auth';

const DEFAULT_ROUTE_GUEST_SCOPES = ['customer_lookup', 'active_orders', 'checkout', 'track_orders'];

const ACTIVE_STATUSES = ['pending', 'placed', 'accepted', 'confirmed', 'preparing', 'prepared', 'ready', 'ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived'];

const normalizeScopes = (scopes = []) => [...new Set((Array.isArray(scopes) ? scopes : [scopes]).map((value) => String(value || '').trim()).filter(Boolean))];

const toDate = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

async function resolveGuestAccessRefForRoute(firestore, ref, requiredScopes = []) {
  const resolved = await resolveGuestAccessRef(firestore, ref, {
    requiredScopes,
    allowLegacy: true,
    touch: true,
  });
  if (resolved) return resolved;

  const safeRef = String(ref || '').trim();
  if (!safeRef) return null;

  const sessionDoc = await firestore.collection('guest_sessions').doc(safeRef).get();
  if (!sessionDoc.exists) return null;

  const sessionData = sessionDoc.data() || {};
  const expiresAt = toDate(sessionData.expiresAt);
  const expired = !expiresAt || Date.now() >= expiresAt.getTime();
  const revoked = String(sessionData.status || '').toLowerCase() === 'revoked';
  const effectiveScopes = normalizeScopes(
    Array.isArray(sessionData.scopes) && sessionData.scopes.length > 0
      ? sessionData.scopes
      : DEFAULT_ROUTE_GUEST_SCOPES
  );
  const missingScopes = normalizeScopes(requiredScopes).filter((scope) => !effectiveScopes.includes(scope));

  if (expired || revoked || missingScopes.length > 0) {
    return null;
  }

  return {
    subjectId: String(sessionData.subjectId || '').trim(),
    subjectType: String(sessionData.subjectType || 'guest').trim() || 'guest',
    phone: String(sessionData.phone || '').trim(),
    businessId: String(sessionData.businessId || '').trim(),
    scopes: effectiveScopes,
    sessionId: sessionDoc.id,
    source: 'session_ref_fallback',
    legacy: false,
  };
}

export async function resolveActiveOrdersForCustomerContext(firestore, {
  phone = '',
  ref = '',
  restaurantId = '',
} = {}) {
  const targetRestaurantId = String(restaurantId || '').trim();
  let targetCustomerId = null;
  let targetPhone = null;

  if (ref) {
    const refSession = await resolveGuestAccessRefForRoute(firestore, ref, ['active_orders']);
    targetCustomerId = refSession?.subjectId || null;
    if (!targetCustomerId && phone) {
      targetPhone = String(phone || '').replace(/\D/g, '').slice(-10);
    } else if (!targetCustomerId) {
      return {
        activeOrders: [],
        actorUid: null,
        source: 'invalid_ref',
      };
    }
  } else if (phone) {
    targetPhone = String(phone || '').replace(/\D/g, '').slice(-10);
  } else {
    return {
      activeOrders: [],
      actorUid: null,
      source: 'missing_identifier',
    };
  }

  let userId;
  if (targetCustomerId) {
    userId = targetCustomerId;
  } else if (targetPhone) {
    const profileResult = await getOrCreateGuestProfile(firestore, targetPhone);
    userId = profileResult.userId;
  }

  if (!userId) {
    return {
      activeOrders: [],
      actorUid: null,
      source: 'identity_resolution_failed',
    };
  }

  const ordersRef = firestore.collection('orders');
  const primarySnapshot = await ordersRef
    .where('userId', '==', userId)
    .where('status', 'in', ACTIVE_STATUSES)
    .limit(20)
    .get();

  const snapshots = [primarySnapshot];
  let phoneForFallback = targetPhone || null;

  if (!phoneForFallback && targetCustomerId?.startsWith('g_')) {
    try {
      const guestDoc = await firestore.collection('guest_profiles').doc(targetCustomerId).get();
      const guestPhone = guestDoc.exists ? guestDoc.data()?.phone : null;
      if (guestPhone) phoneForFallback = guestPhone;
    } catch {
      // Ignore guest fallback failures.
    }
  }

  if (primarySnapshot.empty && phoneForFallback) {
    const [snapByCustomerPhone, snapByNestedCustomerPhone] = await Promise.all([
      ordersRef
        .where('customerPhone', '==', phoneForFallback)
        .where('status', 'in', ACTIVE_STATUSES)
        .limit(20)
        .get(),
      ordersRef
        .where('customer.phone', '==', phoneForFallback)
        .where('status', 'in', ACTIVE_STATUSES)
        .limit(20)
        .get(),
    ]);
    snapshots.push(snapByCustomerPhone, snapByNestedCustomerPhone);
  }

  const uniqueDocs = new Map();
  snapshots.forEach((snap) => {
    snap.forEach((doc) => uniqueDocs.set(doc.id, doc));
  });

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const activeOrders = [];

  uniqueDocs.forEach((doc) => {
    const data = doc.data() || {};
    const createdTime = data.orderDate || data.createdAt;
    const createdAt = createdTime?.toMillis ? createdTime.toMillis() : (toDate(createdTime)?.getTime() || 0);
    if (createdAt && createdAt < yesterday.getTime()) return;
    if (targetRestaurantId && String(data.restaurantId || '').trim() !== targetRestaurantId) return;

    activeOrders.push({
      orderId: doc.id,
      status: data.status,
      trackingToken: data.trackingToken || data.token,
      restaurantId: data.restaurantId,
      restaurantName: data.restaurantName || data.businessName || 'Restaurant',
      totalAmount: data.grandTotal || data.totalAmount,
      items: data.items || [],
      deliveryType: data.deliveryType,
      orderDate: data.orderDate,
      createdAt: data.createdAt,
      customerOrderId: data.customerOrderId,
      addressPending: data.addressPending === true || data.addressCaptureRequired === true,
      customerLocationPresent: !!(data.customerAddress?.latitude || data.customerCoordinates?.lat),
    });
  });

  activeOrders.sort((a, b) => {
    const timeA = a.orderDate?.toMillis ? a.orderDate.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0);
    const timeB = b.orderDate?.toMillis ? b.orderDate.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0);
    return timeB - timeA;
  });

  return {
    activeOrders,
    actorUid: userId,
    source: targetCustomerId ? 'ref_or_guest' : 'phone',
  };
}
