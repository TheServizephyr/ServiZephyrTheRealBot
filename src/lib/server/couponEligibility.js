import { resolveGuestAccessRef } from '@/lib/public-auth';

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

export async function resolveCouponAudienceContext({
  firestore,
  businessRef,
  phone = '',
  ref = '',
  actorUid = '',
  resolveRef = true,
} = {}) {
  const eligibleIds = new Set();
  const matchedCustomerDocs = new Map();
  const normalizedPhone = normalizeCouponPhone(phone);
  const safeActorUid = String(actorUid || '').trim();
  const safeRef = String(ref || '').trim();

  if (safeActorUid) eligibleIds.add(safeActorUid);

  if (resolveRef && safeRef) {
    try {
      const refSession = await resolveGuestAccessRef(firestore, safeRef, { allowLegacy: true });
      if (refSession?.subjectId) eligibleIds.add(String(refSession.subjectId));
      const refPhone = normalizeCouponPhone(refSession?.phone);
      if (refPhone) eligibleIds.add(`phone:${refPhone}`);
    } catch (error) {
      console.warn('[Coupon Eligibility] Reward ref resolution failed:', error?.message || error);
    }
  }

  if (normalizedPhone) eligibleIds.add(`phone:${normalizedPhone}`);

  if (businessRef && eligibleIds.size > 0) {
    const directIds = [...eligibleIds].filter((value) => value && !String(value).startsWith('phone:'));

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

    const lookupPhones = [...eligibleIds]
      .filter((value) => value.startsWith('phone:'))
      .map((value) => value.slice('phone:'.length));

    for (const lookupPhone of lookupPhones) {
      try {
        const [phoneSnap, phoneNumberSnap, directDocSnap] = await Promise.all([
          businessRef.collection('customers').where('phone', '==', lookupPhone).limit(10).get(),
          businessRef.collection('customers').where('phoneNumber', '==', lookupPhone).limit(10).get(),
          businessRef.collection('customers').doc(lookupPhone).get(),
        ]);

        phoneSnap.forEach((doc) => matchedCustomerDocs.set(doc.id, doc));
        phoneNumberSnap.forEach((doc) => matchedCustomerDocs.set(doc.id, doc));
        if (directDocSnap.exists) matchedCustomerDocs.set(directDocSnap.id, directDocSnap);
      } catch (error) {
        console.warn('[Coupon Eligibility] Phone based reward lookup failed:', error?.message || error);
      }
    }

    matchedCustomerDocs.forEach((doc) => {
      eligibleIds.add(String(doc.id));
      const customerData = doc.data() || {};
      if (customerData.customerId) eligibleIds.add(String(customerData.customerId));
      if (customerData.userId) eligibleIds.add(String(customerData.userId));
      if (customerData.uid) eligibleIds.add(String(customerData.uid));
    });
  }

  const completedOrderCount = [...matchedCustomerDocs.values()].reduce((maxOrders, doc) => {
    const customerData = doc.data() || {};
    return Math.max(maxOrders, Number(customerData.totalOrders) || 0);
  }, 0);

  return {
    eligibleIds,
    matchedCustomerDocs,
    completedOrderCount,
    nextOrderNumber: completedOrderCount + 1,
  };
}

export function filterCouponsForAudience(couponDocs = [], {
  now = new Date(),
  eligibleIds = new Set(),
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

    return couponAppliesToOrderNumber(coupon, nextOrderNumber);
  });
}
