import { resolveGuestAccessRef } from '@/lib/public-auth';
import { resolveBusinessCustomerProfileRef } from '@/lib/customer-profiles';

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
}

function addCanonicalCustomerIdentifiers(targetIds, doc) {
  if (!doc?.id) return;

  targetIds.add(String(doc.id));

  const customerData = doc.data() || {};
  (Array.isArray(customerData.actorIds) ? customerData.actorIds : []).forEach((value) => {
    const safeValue = String(value || '').trim();
    if (safeValue) targetIds.add(safeValue);
  });
  if (customerData.currentActorId) targetIds.add(String(customerData.currentActorId));
  if (customerData.userId) targetIds.add(String(customerData.userId));
  if (customerData.uid) targetIds.add(String(customerData.uid));
  if (customerData.guestId) targetIds.add(String(customerData.guestId));
}

export async function resolveCouponAudienceContext({
  firestore,
  businessRef,
  phone = '',
  ref = '',
  actorUid = '',
  resolveRef = true,
  preferredCustomerDocId = '',
} = {}) {
  const eligibleIds = new Set();
  const canonicalActorIds = new Set();
  const matchedCustomerDocs = new Map();
  const normalizedPhone = normalizeCouponPhone(phone);
  const safeActorUid = String(actorUid || '').trim();
  const safeRef = String(ref || '').trim();
  const safePreferredCustomerDocId = String(preferredCustomerDocId || '').trim();

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
      if (refPhone) canonicalActorIds.add(`phone:${refPhone}`);
    } catch (error) {
      console.warn('[Coupon Eligibility] Reward ref resolution failed:', error?.message || error);
    }
  }

  if (businessRef) {
    const resolvedProfile = await resolveBusinessCustomerProfileRef({
      firestore,
      businessCollection: businessRef.parent.parent?.id || businessRef.parent.id || '',
      businessId: businessRef.id,
      customerDocId: safePreferredCustomerDocId,
      actorId: [...canonicalActorIds].find((value) => value && !String(value).startsWith('phone:')) || '',
      customerPhone: normalizedPhone,
    }).catch((error) => {
      console.warn('[Coupon Eligibility] Customer profile resolution failed:', error?.message || error);
      return null;
    });

    const resolvedDoc = resolvedProfile?.customerSnap
      || (resolvedProfile?.customerRef ? await resolvedProfile.customerRef.get().catch(() => null) : null);

    if (resolvedDoc?.exists) {
      matchedCustomerDocs.set(resolvedDoc.id, resolvedDoc);
      addMatchedCustomerDocIdentifiers(eligibleIds, resolvedDoc);
      addCanonicalCustomerIdentifiers(canonicalActorIds, resolvedDoc);
    }
  }
  const matchedCustomerDoc = matchedCustomerDocs.size > 0
    ? [...matchedCustomerDocs.values()][0]
    : null;
  const matchedCustomerData = matchedCustomerDoc?.data() || {};
  const completedOrderCount = Math.max(0, Number(matchedCustomerData.completedOrderCount) || 0);
  const compatibilityRedemptionIds = new Set();
  if (matchedCustomerDoc?.id) compatibilityRedemptionIds.add(String(matchedCustomerDoc.id));
  canonicalActorIds.forEach((value) => {
    const safeValue = String(value || '').trim();
    if (safeValue) compatibilityRedemptionIds.add(safeValue);
  });
  const matchedCustomerPhone = normalizeCouponPhone(matchedCustomerData.phone || matchedCustomerData.phoneNumber || normalizedPhone);
  if (matchedCustomerPhone) {
    compatibilityRedemptionIds.add(matchedCustomerPhone);
    compatibilityRedemptionIds.add(`phone:${matchedCustomerPhone}`);
  }
  const redemptionSourceIds = compatibilityRedemptionIds.size > 0 ? compatibilityRedemptionIds : new Set();

  return {
    eligibleIds,
    canonicalActorIds,
    redemptionKeys: buildCouponRedemptionKeys({
      eligibleIds: redemptionSourceIds,
      phone: '',
    }),
    matchedCustomerDocs,
    primaryCustomerDocId: matchedCustomerDoc?.id || safePreferredCustomerDocId || '',
    completedOrderCount,
    nextOrderNumber: completedOrderCount + 1,
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
