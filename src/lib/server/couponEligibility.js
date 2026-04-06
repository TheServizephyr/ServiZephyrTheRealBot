import { resolveGuestAccessRef } from '@/lib/public-auth';
import { COUNTABLE_CUSTOMER_ORDER_STATUSES } from '@/lib/customer-profiles';

export function normalizeCouponPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeCouponType(couponType) {
  const normalized = String(couponType || '').trim().toLowerCase();
  return normalized === 'fixed' ? 'flat' : normalized;
}

export function parseOrderMilestones(input) {
  if (Array.isArray(input)) {
    return [...new Set(
      input
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )].sort((a, b) => a - b);
  }

  if (typeof input === 'string') {
    return parseOrderMilestones(
      input
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    );
  }

  return [];
}

export function couponAppliesToOrderNumber(coupon = {}, orderNumber = 0) {
  const milestones = parseOrderMilestones(coupon?.orderMilestones);
  if (!milestones.length) return true;
  const safeOrderNumber = Number(orderNumber) || 0;
  if (safeOrderNumber <= 0) return false;
  return milestones.includes(safeOrderNumber);
}

export function getCouponMilestoneLabel(coupon = {}) {
  const milestones = parseOrderMilestones(coupon?.orderMilestones);
  if (!milestones.length) return '';
  return milestones.map((value) => {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    const mod10 = value % 10;
    if (mod10 === 1) return `${value}st`;
    if (mod10 === 2) return `${value}nd`;
    if (mod10 === 3) return `${value}rd`;
    return `${value}th`;
  }).join(', ');
}

export function buildCouponRedemptionKeys({
  eligibleIds = new Set(),
  phone = '',
} = {}) {
  const redemptionKeys = new Set();
  const normalizedPhone = normalizeCouponPhone(phone);

  if (normalizedPhone) {
    redemptionKeys.add(normalizedPhone);
    redemptionKeys.add(`phone:${normalizedPhone}`);
  }

  [...eligibleIds].forEach((value) => {
    const safeValue = String(value || '').trim();
    if (!safeValue) return;

    redemptionKeys.add(safeValue);

    if (safeValue.startsWith('phone:')) {
      const phoneDigits = normalizeCouponPhone(safeValue.slice('phone:'.length));
      if (phoneDigits) {
        redemptionKeys.add(phoneDigits);
        redemptionKeys.add(`phone:${phoneDigits}`);
      }
    }
  });

  return redemptionKeys;
}

function isCountableCouponOrderStatus(status) {
  return COUNTABLE_CUSTOMER_ORDER_STATUSES.has(String(status || '').trim().toLowerCase());
}

export function hasCouponBeenRedeemedByAudience(coupon = {}, redemptionKeys = new Set()) {
  if (coupon?.singleUsePerCustomer !== true) return false;

  const normalizedRedemptionKeys = redemptionKeys instanceof Set
    ? redemptionKeys
    : new Set(
      [...(Array.isArray(redemptionKeys) ? redemptionKeys : [])]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );

  if (normalizedRedemptionKeys.size === 0) return false;

  const redeemedCustomerIds = Array.isArray(coupon?.redeemedCustomerIds)
    ? coupon.redeemedCustomerIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (redeemedCustomerIds.length === 0) return false;

  return redeemedCustomerIds.some((value) => normalizedRedemptionKeys.has(value));
}

function addMatchedCustomerDocIdentifiers(eligibleIds, doc) {
  if (!doc?.id) return;

  eligibleIds.add(String(doc.id));

  const customerData = doc.data() || {};
  if (customerData.customerId) eligibleIds.add(String(customerData.customerId));
  if (customerData.userId) eligibleIds.add(String(customerData.userId));
  if (customerData.uid) eligibleIds.add(String(customerData.uid));

  const customerPhone = normalizeCouponPhone(customerData.phone || customerData.phoneNumber);
  if (customerPhone) eligibleIds.add(`phone:${customerPhone}`);
}

function addCanonicalCustomerIdentifiers(targetIds, doc) {
  if (!doc?.id) return;

  targetIds.add(String(doc.id));

  const customerData = doc.data() || {};
  if (customerData.customerId) targetIds.add(String(customerData.customerId));
  if (customerData.userId) targetIds.add(String(customerData.userId));
  if (customerData.uid) targetIds.add(String(customerData.uid));
}

function splitIntoChunks(values = [], size = 10) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function resolveCouponAudienceContext({
  firestore,
  businessRef,
  phone = '',
  ref = '',
  actorUid = '',
  resolveRef = true,
} = {}) {
  const eligibleIds = new Set();
  const canonicalActorIds = new Set();
  const matchedCustomerDocs = new Map();
  const matchedOrderDocs = new Map();
  const normalizedPhone = normalizeCouponPhone(phone);
  const safeActorUid = String(actorUid || '').trim();
  const safeRef = String(ref || '').trim();

  if (safeActorUid) {
    eligibleIds.add(safeActorUid);
    canonicalActorIds.add(safeActorUid);
  }

  if (resolveRef && safeRef) {
    try {
      const refSession = await resolveGuestAccessRef(firestore, safeRef, { allowLegacy: true });
      if (refSession?.subjectId) {
        const subjectId = String(refSession.subjectId);
        eligibleIds.add(subjectId);
        canonicalActorIds.add(subjectId);
      }
      const refPhone = normalizeCouponPhone(refSession?.phone);
      if (refPhone) eligibleIds.add(`phone:${refPhone}`);
    } catch (error) {
      console.warn('[Coupon Eligibility] Reward ref resolution failed:', error?.message || error);
    }
  }

  if (normalizedPhone) eligibleIds.add(`phone:${normalizedPhone}`);

  if (businessRef && canonicalActorIds.size > 0) {
    const directIds = [...canonicalActorIds].filter(Boolean);

    for (const directId of directIds) {
      try {
        const directDocSnap = await businessRef.collection('customers').doc(String(directId)).get();
        if (directDocSnap.exists) {
          matchedCustomerDocs.set(directDocSnap.id, directDocSnap);
        }
      } catch (error) {
        console.warn('[Coupon Eligibility] Direct customer lookup failed:', error?.message || error);
      }
    }

    for (const idChunk of splitIntoChunks(directIds, 10)) {
      try {
        const [customerIdSnap, userIdSnap, uidSnap] = await Promise.all([
          businessRef.collection('customers').where('customerId', 'in', idChunk).get(),
          businessRef.collection('customers').where('userId', 'in', idChunk).get(),
          businessRef.collection('customers').where('uid', 'in', idChunk).get(),
        ]);

        customerIdSnap.forEach((doc) => matchedCustomerDocs.set(doc.id, doc));
        userIdSnap.forEach((doc) => matchedCustomerDocs.set(doc.id, doc));
        uidSnap.forEach((doc) => matchedCustomerDocs.set(doc.id, doc));
      } catch (error) {
        console.warn('[Coupon Eligibility] Canonical customer lookup failed:', error?.message || error);
      }
    }

    matchedCustomerDocs.forEach((doc) => {
      addMatchedCustomerDocIdentifiers(eligibleIds, doc);
      addCanonicalCustomerIdentifiers(canonicalActorIds, doc);
    });

    const businessId = String(businessRef.id || '').trim();
    const lookupIds = [...canonicalActorIds].filter((value) => value && !String(value).startsWith('phone:'));

    try {
      const orderLookups = [];
      splitIntoChunks(lookupIds, 10).forEach((idChunk) => {
        if (!idChunk.length) return;
        orderLookups.push(firestore.collection('orders').where('customerId', 'in', idChunk).get());
        orderLookups.push(firestore.collection('orders').where('userId', 'in', idChunk).get());
      });

      const orderSnapshots = await Promise.all(orderLookups);
      orderSnapshots.forEach((snapshot) => {
        snapshot.forEach((doc) => {
          const data = doc.data() || {};
          const orderBusinessId = String(data.restaurantId || '').trim();
          const orderStatus = String(data.status || '').trim().toLowerCase();
          if (businessId && orderBusinessId !== businessId) return;
          if (!isCountableCouponOrderStatus(orderStatus)) return;
          matchedOrderDocs.set(doc.id, doc);
        });
      });
    } catch (error) {
      console.warn('[Coupon Eligibility] Order history lookup failed:', error?.message || error);
    }

  }

  const resolvedCompletedOrderCount = matchedOrderDocs.size;
  const compatibilityRedemptionIds = new Set(canonicalActorIds);
  matchedCustomerDocs.forEach((doc) => {
    const customerData = doc.data() || {};
    const customerPhone = normalizeCouponPhone(customerData.phone || customerData.phoneNumber);
    if (customerPhone) compatibilityRedemptionIds.add(`phone:${customerPhone}`);
  });
  const redemptionSourceIds = compatibilityRedemptionIds.size > 0 ? compatibilityRedemptionIds : eligibleIds;

  return {
    eligibleIds,
    canonicalActorIds,
    redemptionKeys: buildCouponRedemptionKeys({
      eligibleIds: redemptionSourceIds,
      phone: canonicalActorIds.size > 0 ? '' : normalizedPhone,
    }),
    matchedCustomerDocs,
    completedOrderCount: resolvedCompletedOrderCount,
    nextOrderNumber: resolvedCompletedOrderCount + 1,
  };
}

export function filterCouponsForAudience(couponDocs = [], {
  now = new Date(),
  eligibleIds = new Set(),
  redemptionKeys = new Set(),
  nextOrderNumber = 0,
} = {}) {
  return couponDocs.filter((coupon) => {
    const startDate = coupon?.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon?.startDate);
    const expiryDate = coupon?.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon?.expiryDate);
    const assignedCustomerId = String(coupon?.customerId || '').trim();
    const isPublic = !assignedCustomerId;
    const isAssignedToCurrentCustomer = assignedCustomerId && eligibleIds.has(assignedCustomerId);
    const isValid =
      startDate instanceof Date &&
      !Number.isNaN(startDate.getTime()) &&
      expiryDate instanceof Date &&
      !Number.isNaN(expiryDate.getTime()) &&
      startDate <= now &&
      expiryDate >= now &&
      String(coupon?.status || '').trim().toLowerCase() === 'active';

    if (!isValid || (!isPublic && !isAssignedToCurrentCustomer)) {
      return false;
    }

    if (hasCouponBeenRedeemedByAudience(coupon, redemptionKeys)) {
      return false;
    }

    return couponAppliesToOrderNumber(coupon, nextOrderNumber);
  });
}
