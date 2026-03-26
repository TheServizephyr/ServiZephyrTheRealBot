import { FieldValue } from '@/lib/firebase-admin';

export const BUSINESS_COLLECTIONS = [
  { name: 'restaurants', businessType: 'restaurant' },
  { name: 'shops', businessType: 'store' },
  { name: 'street_vendors', businessType: 'street-vendor' },
];

const CUSTOMER_STATUS_VALUES = new Set(['Active', 'Blocked']);

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

export function pickTimestamp(data, fields) {
  for (const field of fields) {
    const parsed = toIso(data?.[field]);
    if (parsed) return parsed;
  }
  return null;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  const email = normalizeText(value).toLowerCase();
  return email || null;
}

function normalizePhone(value) {
  const phone = normalizeText(value);
  return phone || null;
}

function normalizeAddressObject(addressInput = {}) {
  if (!addressInput) return null;
  if (typeof addressInput === 'string') {
    const full = normalizeText(addressInput);
    return full ? { full } : null;
  }
  if (typeof addressInput !== 'object') return null;

  const full = normalizeText(
    addressInput.full || [
      addressInput.houseNumber,
      addressInput.street,
      addressInput.area,
      addressInput.city,
      addressInput.state,
      addressInput.postalCode,
      addressInput.country,
    ].filter(Boolean).join(', ')
  );

  const address = {
    ...addressInput,
    full,
  };

  if (!address.full) return null;
  return address;
}

function dedupeAddresses(addresses = [], limit = 20) {
  const seen = new Set();
  const output = [];

  for (const rawAddress of addresses) {
    const address = normalizeAddressObject(rawAddress);
    if (!address?.full) continue;
    const key = address.full.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(address);
    if (output.length >= limit) break;
  }

  return output;
}

function buildAddressFromOrder(orderData = {}) {
  return normalizeAddressObject(
    orderData.customerAddress ||
    orderData?.customer?.address ||
    orderData.address ||
    null
  );
}

function getCustomerStatusForBusiness(userProfile, existingData = {}) {
  if (existingData.status) return existingData.status;
  if (userProfile?.userType === 'user') return 'verified';
  return 'guest';
}

function getCustomerType(userProfile, customerUid, existingData = {}) {
  return (
    existingData.customerType ||
    userProfile?.userType ||
    (String(customerUid || '').startsWith('g_') ? 'guest' : 'uid')
  );
}

function computeBestDishes(dishStats = {}) {
  return Object.entries(dishStats)
    .sort((a, b) => {
      const countDiff = toNumber(b[1]?.count) - toNumber(a[1]?.count);
      if (countDiff !== 0) return countDiff;
      return toNumber(b[1]?.spend) - toNumber(a[1]?.spend);
    })
    .slice(0, 5)
    .map(([name, data]) => ({
      name,
      count: toNumber(data?.count),
      spend: Number(toNumber(data?.spend).toFixed(2)),
      lastOrderedAt: data?.lastOrderedAt || null,
    }));
}

function buildDishStats(orders = []) {
  const stats = {};

  for (const order of orders) {
    const orderDate = order.orderDate || new Date().toISOString();
    for (const item of order.items || []) {
      const name = normalizeText(item.name);
      if (!name) continue;
      const qty = Math.max(1, toNumber(item.quantity ?? item.qty, 1));
      const price = toNumber(item.price ?? item.basePrice ?? item.mrp, 0);
      const spend = toNumber(item.total ?? item.itemTotal ?? item.totalPrice, price * qty);
      const prev = stats[name] || { count: 0, spend: 0, lastOrderedAt: null };
      stats[name] = {
        count: prev.count + qty,
        spend: Number((prev.spend + spend).toFixed(2)),
        lastOrderedAt: orderDate,
      };
    }
  }

  return stats;
}

export function generateRequestId() {
  try {
    return crypto.randomUUID();
  } catch (_) {
    return `checkid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function normalizeOrder(doc) {
  const data = doc.data() || {};
  const items = Array.isArray(data.items) ? data.items : [];

  return {
    firestoreOrderId: doc.id,
    customerOrderId: data.customerOrderId || null,
    status: data.status || 'unknown',
    orderDate: pickTimestamp(data, ['orderDate', 'createdAt', 'updatedAt']),
    deliveryType: data.deliveryType || 'delivery',
    paymentMethod: data.paymentMethod || data?.paymentDetails?.method || null,
    paymentStatus: data.paymentStatus || data?.paymentDetails?.status || null,
    restaurantId: data.restaurantId || null,
    userId: data.userId || data.customerId || null,
    customerName: data.customerName || null,
    customerPhone: data.customerPhone || null,
    customerAddress: data.customerAddress || data?.customer?.address?.full || data?.customer?.address || null,
    subtotal: toNumber(data.subtotal || 0),
    cgst: toNumber(data.cgst || 0),
    sgst: toNumber(data.sgst || 0),
    gstAmount: toNumber(data.gstAmount || 0),
    deliveryCharge: toNumber(data.deliveryCharge || 0),
    tipAmount: toNumber(data.tipAmount || 0),
    grandTotal: toNumber(data.grandTotal ?? data.totalAmount ?? data.amount ?? 0),
    loyaltyDiscount: toNumber(data.loyaltyDiscount || 0),
    coupon: data.coupon || null,
    restaurantName: data.restaurantName || null,
    items: items.map((item) => {
      const qty = Math.max(1, toNumber(item.quantity ?? item.qty, 1));
      const price = toNumber(item.price ?? item.basePrice ?? item.mrp ?? 0);
      const total = toNumber(item.total ?? item.itemTotal ?? item.totalPrice, qty * price);
      return {
        name: item.name || 'Unnamed Item',
        qty,
        quantity: qty,
        price,
        total,
      };
    }),
    statusHistory: (Array.isArray(data.statusHistory) ? data.statusHistory : []).map((entry) => ({
      status: entry.status || 'unknown',
      timestamp: toIso(entry.timestamp) || null,
      notes: entry.notes || null,
    })),
  };
}

function normalizeManualBill(doc) {
  const data = doc.data() || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const historyCollectionRef = doc.ref.parent;
  const businessDocRef = historyCollectionRef?.parent || null;
  const businessCollectionName = businessDocRef?.parent?.id || null;
  const businessId = businessDocRef?.id || data.businessId || null;
  const paymentMethod = data.paymentMethod || (String(data.orderType || '').toLowerCase() === 'delivery' ? 'cash' : 'counter');

  return {
    firestoreOrderId: doc.id,
    customerOrderId: data.customerOrderId || null,
    historyId: data.historyId || doc.id,
    status: data.isSettled ? 'settled' : (data.settlementEligible ? 'pending_settlement' : 'saved_manual_bill'),
    orderDate: pickTimestamp(data, ['printedAt', 'createdAt', 'updatedAt']),
    deliveryType: data.orderType || 'dine-in',
    paymentMethod,
    paymentStatus: data.paymentStatus || 'not_applicable',
    restaurantId: businessId,
    restaurantCollectionName: businessCollectionName,
    customerId: data.customerId || null,
    customerType: data.customerType || 'guest',
    userId: data.customerType === 'uid' ? (data.customerId || null) : null,
    customerName: data.customerName || 'Walk-in Customer',
    customerPhone: data.customerPhone || null,
    customerAddress: data.customerAddress || null,
    subtotal: toNumber(data.subtotal || 0),
    cgst: toNumber(data.cgst || 0),
    sgst: toNumber(data.sgst || 0),
    gstAmount: toNumber(data.cgst || 0) + toNumber(data.sgst || 0),
    deliveryCharge: toNumber(data.deliveryCharge || 0),
    tipAmount: 0,
    grandTotal: toNumber(data.totalAmount ?? data.grandTotal ?? 0),
    loyaltyDiscount: 0,
    coupon: null,
    restaurantName: null,
    source: data.source || 'offline_counter',
    channel: data.channel || 'custom_bill',
    orderStorage: 'custom_bill_history',
    isManualBill: true,
    items: items.map((item) => {
      const qty = Math.max(1, toNumber(item.quantity ?? item.qty, 1));
      const price = toNumber(item.price ?? item.basePrice ?? item.mrp ?? 0);
      const total = toNumber(item.total ?? item.itemTotal ?? item.totalPrice, qty * price);
      return {
        name: item.name || 'Unnamed Item',
        qty,
        quantity: qty,
        price,
        total,
      };
    }),
    statusHistory: [],
  };
}

async function queryOrdersWithFallback(baseQuery, limit = 20) {
  try {
    const query = baseQuery.orderBy('orderDate', 'desc');
    const snap = limit ? await query.limit(limit).get() : await query.get();
    return snap.docs;
  } catch (_) {
    const snap = limit ? await baseQuery.limit(limit).get() : await baseQuery.get();
    return snap.docs;
  }
}

function buildUserProfile(doc) {
  const data = doc.data() || {};
  return {
    userType: 'user',
    uid: doc.id,
    customerId: data.customerId || null,
    name: data.name || 'Customer',
    email: data.email || null,
    phone: data.phone || data.phoneNumber || null,
    status: data.status || 'Active',
    addresses: dedupeAddresses(data.addresses || []),
    createdAt: pickTimestamp(data, ['createdAt', 'created_at', 'registeredAt', 'joinedAt']),
    updatedAt: pickTimestamp(data, ['updatedAt', 'lastActivityAt', 'lastSeen', 'lastLoginAt']),
  };
}

function buildGuestProfile(doc) {
  const data = doc.data() || {};
  return {
    userType: 'guest',
    uid: doc.id,
    customerId: data.customerId || null,
    name: data.name || 'Guest Customer',
    email: data.email || null,
    phone: data.phone || null,
    status: data.status === 'Blocked' || data.blocked ? 'Blocked' : 'Active',
    addresses: dedupeAddresses(data.addresses || []),
    createdAt: pickTimestamp(data, ['createdAt']),
    updatedAt: pickTimestamp(data, ['updatedAt', 'lastActivityAt', 'lastSeen']),
  };
}

export async function getCustomerProfileByUid(firestore, uid) {
  if (!uid) return null;

  const userDoc = await firestore.collection('users').doc(String(uid)).get();
  if (userDoc.exists) return buildUserProfile(userDoc);

  const guestDoc = await firestore.collection('guest_profiles').doc(String(uid)).get();
  if (guestDoc.exists) return buildGuestProfile(guestDoc);

  return null;
}

async function getCustomerProfileByCustomerId(firestore, customerId) {
  const userSnap = await firestore.collection('users').where('customerId', '==', customerId).limit(1).get();
  if (!userSnap.empty) return buildUserProfile(userSnap.docs[0]);

  const guestSnap = await firestore.collection('guest_profiles').where('customerId', '==', customerId).limit(1).get();
  if (!guestSnap.empty) return buildGuestProfile(guestSnap.docs[0]);

  return null;
}

async function getCustomerOrders(firestore, customerUid, limit = 20) {
  const [byUserId, byCustomerId] = await Promise.all([
    queryOrdersWithFallback(firestore.collection('orders').where('userId', '==', customerUid), limit),
    queryOrdersWithFallback(firestore.collection('orders').where('customerId', '==', customerUid), limit),
  ]);

  const orderMap = new Map();
  [...byUserId, ...byCustomerId].forEach((doc) => {
    orderMap.set(doc.id, doc);
  });

  return Array.from(orderMap.values())
    .map((doc) => normalizeOrder(doc))
    .sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime());
}

export async function findBusinessByDocId(firestore, businessId) {
  if (!businessId) return null;

  for (const config of BUSINESS_COLLECTIONS) {
    const snap = await firestore.collection(config.name).doc(String(businessId)).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    return {
      businessId: snap.id,
      businessType: data.businessType || config.businessType,
      collectionName: config.name,
      name: data.name || 'Unnamed Business',
      merchantId: data.merchantId || null,
      ownerId: data.ownerId || null,
      approvalStatus: data.approvalStatus || 'pending',
      createdAt: pickTimestamp(data, ['createdAt', 'created_at']),
      updatedAt: pickTimestamp(data, ['updatedAt', 'lastSeen']),
    };
  }

  return null;
}

export async function findBusinessByMerchantId(firestore, merchantId) {
  const results = await Promise.all(
    BUSINESS_COLLECTIONS.map(async (config) => {
      const snap = await firestore.collection(config.name).where('merchantId', '==', merchantId).limit(1).get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      const data = doc.data() || {};
      return {
        businessId: doc.id,
        businessType: data.businessType || config.businessType,
        collectionName: config.name,
        name: data.name || 'Unnamed Business',
        merchantId: data.merchantId || merchantId,
        ownerId: data.ownerId || null,
        approvalStatus: data.approvalStatus || 'pending',
        createdAt: pickTimestamp(data, ['createdAt', 'created_at']),
        updatedAt: pickTimestamp(data, ['updatedAt', 'lastSeen']),
      };
    })
  );

  return results.find(Boolean) || null;
}

export async function getOwnerInfo(firestore, ownerId) {
  if (!ownerId) return null;
  const ownerDoc = await firestore.collection('users').doc(String(ownerId)).get();
  if (!ownerDoc.exists) return null;
  const data = ownerDoc.data() || {};
  return {
    ownerId,
    name: data.name || 'N/A',
    email: data.email || 'N/A',
    phone: data.phone || data.phoneNumber || 'N/A',
    status: data.status || 'Active',
  };
}

export async function getCustomerResult(firestore, customerIdentifier) {
  const normalizedId = normalizeText(customerIdentifier);
  if (!normalizedId) return null;

  const userProfile =
    await getCustomerProfileByUid(firestore, normalizedId) ||
    await getCustomerProfileByCustomerId(firestore, normalizedId);

  if (!userProfile) return null;

  const orders = (await getCustomerOrders(firestore, userProfile.uid, 20)).slice(0, 20);
  const totalSpent = orders.reduce((sum, order) => sum + toNumber(order.grandTotal), 0);
  const lastActivity = orders[0]?.orderDate || userProfile.updatedAt || userProfile.createdAt;
  const linkedBusinessIds = [...new Set(orders.map((order) => order.restaurantId).filter(Boolean))].slice(0, 8);
  const linkedBusinesses = [];

  for (const businessId of linkedBusinessIds) {
    const business = await findBusinessByDocId(firestore, businessId);
    if (business) linkedBusinesses.push(business);
  }

  return {
    searchedId: normalizedId,
    customer: userProfile,
    stats: {
      totalOrders: orders.length,
      totalSpent: Number(totalSpent.toFixed(2)),
      lastActivity,
    },
    linkedBusinesses,
    recentOrders: orders,
  };
}

export async function getRestaurantResult(firestore, merchantId) {
  const business = await findBusinessByMerchantId(firestore, merchantId);
  if (!business) return null;

  const owner = await getOwnerInfo(firestore, business.ownerId);
  const orders = await queryOrdersWithFallback(
    firestore.collection('orders').where('restaurantId', '==', business.businessId),
    30
  );

  const recentOrders = orders
    .map((doc) => normalizeOrder(doc))
    .sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime());

  const totalRevenue = recentOrders.reduce((sum, order) => sum + toNumber(order.grandTotal), 0);
  const lastActivity = recentOrders[0]?.orderDate || business.updatedAt || business.createdAt;

  return {
    searchedId: merchantId,
    restaurant: business,
    owner,
    stats: {
      totalOrders: recentOrders.length,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      lastActivity,
    },
    recentOrders: recentOrders.slice(0, 20),
  };
}

async function resolveStandardOrderDoc(firestore, orderSearchId) {
  const normalizedId = normalizeText(orderSearchId);
  if (!normalizedId) return null;

  let orderDoc = null;

  const byCustomerOrderId = await firestore.collection('orders').where('customerOrderId', '==', normalizedId).limit(1).get();
  if (!byCustomerOrderId.empty) {
    orderDoc = byCustomerOrderId.docs[0];
  }

  if (!orderDoc) {
    const numericId = Number(normalizedId);
    if (Number.isFinite(numericId)) {
      const byNumeric = await firestore.collection('orders').where('customerOrderId', '==', numericId).limit(1).get();
      if (!byNumeric.empty) {
        orderDoc = byNumeric.docs[0];
      }
    }
  }

  if (!orderDoc) {
    const byFirestoreId = await firestore.collection('orders').doc(normalizedId).get();
    if (byFirestoreId.exists) {
      orderDoc = byFirestoreId;
    }
  }

  return orderDoc;
}

async function resolveManualBillDoc(firestore, orderSearchId) {
  const normalizedId = normalizeText(orderSearchId);
  if (!normalizedId) return null;

  try {
    let billDoc = null;

    const byCustomerOrderId = await firestore.collectionGroup('custom_bill_history').where('customerOrderId', '==', normalizedId).limit(1).get();
    if (!byCustomerOrderId.empty) {
      billDoc = byCustomerOrderId.docs[0];
    }

    if (!billDoc) {
      const byHistoryId = await firestore.collectionGroup('custom_bill_history').where('historyId', '==', normalizedId).limit(1).get();
      if (!byHistoryId.empty) {
        billDoc = byHistoryId.docs[0];
      }
    }

    if (billDoc) {
      return billDoc;
    }
  } catch (error) {
    console.warn('[admin-check-ids] collectionGroup custom_bill_history lookup failed, falling back to per-business scan:', error?.message || error);
  }

  for (const config of BUSINESS_COLLECTIONS) {
    const businessesSnap = await firestore.collection(config.name).select().get();

    for (const businessDoc of businessesSnap.docs) {
      const historyRef = businessDoc.ref.collection('custom_bill_history');

      const directDoc = await historyRef.doc(normalizedId).get();
      if (directDoc.exists) {
        return directDoc;
      }

      const byCustomerOrderId = await historyRef.where('customerOrderId', '==', normalizedId).limit(1).get();
      if (!byCustomerOrderId.empty) {
        return byCustomerOrderId.docs[0];
      }

      const byHistoryId = await historyRef.where('historyId', '==', normalizedId).limit(1).get();
      if (!byHistoryId.empty) {
        return byHistoryId.docs[0];
      }
    }
  }

  return null;
}

async function resolveOrderDoc(firestore, orderSearchId) {
  const standardOrderDoc = await resolveStandardOrderDoc(firestore, orderSearchId);
  if (standardOrderDoc) {
    return { source: 'orders', doc: standardOrderDoc };
  }

  const manualBillDoc = await resolveManualBillDoc(firestore, orderSearchId);
  if (manualBillDoc) {
    return { source: 'custom_bill_history', doc: manualBillDoc };
  }

  return null;
}

export async function getOrderResult(firestore, orderSearchId) {
  const resolved = await resolveOrderDoc(firestore, orderSearchId);
  if (!resolved?.doc) return null;

  const order = resolved.source === 'custom_bill_history'
    ? normalizeManualBill(resolved.doc)
    : normalizeOrder(resolved.doc);
  const customerLookupId =
    order.userId ||
    (resolved.source === 'custom_bill_history' && String(order?.customerType || '').toLowerCase() === 'uid'
      ? order.customerId
      : null);
  const [restaurant, customer] = await Promise.all([
    findBusinessByDocId(firestore, order.restaurantId),
    customerLookupId ? getCustomerProfileByUid(firestore, customerLookupId) : null,
  ]);

  return {
    searchedId: normalizeText(orderSearchId),
    order,
    customer: customer || {
      uid: order.userId || null,
      customerId: order.customerId || null,
      name: order.customerName || 'N/A',
      phone: order.customerPhone || null,
      addresses: order.customerAddress ? [{ full: order.customerAddress }] : [],
    },
    restaurant,
  };
}

export function buildResultSummary(type, data) {
  if (!data) return { found: false };

  if (type === 'customer') {
    return {
      found: true,
      entity: 'customer',
      customerUid: data.customer?.uid || null,
      customerId: data.customer?.customerId || data.searchedId || null,
      totalOrders: data.stats?.totalOrders ?? 0,
      totalSpent: data.stats?.totalSpent ?? 0,
      linkedBusinesses: (data.linkedBusinesses || []).length,
      lastActivity: data.stats?.lastActivity || null,
    };
  }

  if (type === 'restaurant') {
    return {
      found: true,
      entity: 'restaurant',
      businessId: data.restaurant?.businessId || null,
      merchantId: data.restaurant?.merchantId || data.searchedId || null,
      businessType: data.restaurant?.businessType || null,
      totalOrders: data.stats?.totalOrders ?? 0,
      totalRevenue: data.stats?.totalRevenue ?? 0,
      lastActivity: data.stats?.lastActivity || null,
    };
  }

  return {
    found: true,
    entity: 'order',
    firestoreOrderId: data.order?.firestoreOrderId || null,
    customerOrderId: data.order?.customerOrderId || null,
    orderStorage: data.order?.orderStorage || 'orders',
    source: data.order?.source || data.order?.channel || null,
    status: data.order?.status || null,
    orderDate: data.order?.orderDate || null,
    grandTotal: data.order?.grandTotal ?? 0,
    restaurantId: data.order?.restaurantId || null,
    userId: data.order?.userId || null,
    itemCount: Array.isArray(data.order?.items) ? data.order.items.length : 0,
  };
}

export function buildAudit({ type, id, data, adminContext, endpoint, event = 'admin_check_ids_lookup' }) {
  return {
    event,
    requestId: generateRequestId(),
    searchedAt: new Date().toISOString(),
    searchType: type,
    searchedId: id,
    searchedBy: {
      uid: adminContext?.uid || null,
      email: adminContext?.userData?.email || null,
      role: adminContext?.userData?.role || 'admin',
    },
    endpoint,
    resultSummary: buildResultSummary(type, data),
  };
}

async function syncBusinessCustomerDocsForProfile(firestore, profile) {
  if (!profile?.uid) return;

  const snap = await firestore.collectionGroup('customers').where('customerId', '==', profile.uid).get();
  if (snap.empty) return;

  const batch = firestore.batch();
  for (const doc of snap.docs) {
    const current = doc.data() || {};
    const update = {
      name: profile.name || current.name || 'Guest Customer',
      status: current.status || getCustomerStatusForBusiness(profile, current),
      customerType: getCustomerType(profile, profile.uid, current),
      addresses: dedupeAddresses(profile.addresses || current.addresses || []),
      updatedAt: new Date(),
    };
    if (profile.email || current.email) update.email = profile.email || current.email || '';
    if (profile.phone || current.phone) update.phone = profile.phone || current.phone || '';
    batch.set(doc.ref, update, { merge: true });
  }
  await batch.commit();
}

function buildJoinedRestaurantStats(orders, existingData, businessName) {
  if (!orders.length) return null;

  const latest = orders[0];
  const oldest = orders[orders.length - 1];
  const loyaltyPoints = orders.reduce((sum, order) => {
    const earned = Math.floor(toNumber(order.subtotal) / 100) * 10;
    const spent = toNumber(order.loyaltyDiscount) > 0 ? toNumber(order.loyaltyDiscount) / 0.5 : 0;
    return sum + earned - spent;
  }, 0);

  return {
    restaurantName: businessName || latest.restaurantName || existingData?.restaurantName || 'Unknown Business',
    totalSpend: Number(orders.reduce((sum, order) => sum + toNumber(order.subtotal), 0).toFixed(2)),
    totalOrders: orders.length,
    loyaltyPoints: Math.round(loyaltyPoints),
    lastOrderDate: toDate(latest.orderDate) || new Date(),
    joinedAt: existingData?.joinedAt || toDate(oldest.orderDate) || new Date(),
    updatedAt: new Date(),
  };
}

async function rebuildJoinedRestaurantProfile({ firestore, customerUid, business, allOrders }) {
  const userDoc = await firestore.collection('users').doc(String(customerUid)).get();
  if (!userDoc.exists) return;

  const ref = userDoc.ref.collection('joined_restaurants').doc(String(business.businessId));
  const currentSnap = await ref.get();

  if (!allOrders.length) {
    if (currentSnap.exists) {
      await ref.delete();
    }
    return;
  }

  const currentData = currentSnap.exists ? (currentSnap.data() || {}) : {};
  const payload = buildJoinedRestaurantStats(allOrders, currentData, business.name);
  await ref.set(payload, { merge: true });
}

async function rebuildBusinessCustomerAggregate({ firestore, business, customerUid }) {
  if (!business?.collectionName || !business?.businessId || !customerUid) return;

  const [ordersByUser, ordersByCustomer, profile, customerDoc] = await Promise.all([
    queryOrdersWithFallback(
      firestore.collection('orders').where('restaurantId', '==', business.businessId).where('userId', '==', customerUid),
      null
    ),
    queryOrdersWithFallback(
      firestore.collection('orders').where('restaurantId', '==', business.businessId).where('customerId', '==', customerUid),
      null
    ),
    getCustomerProfileByUid(firestore, customerUid),
    firestore.collection(business.collectionName).doc(business.businessId).collection('customers').doc(customerUid).get(),
  ]);

  const uniqueDocs = new Map();
  [...ordersByUser, ...ordersByCustomer].forEach((doc) => uniqueDocs.set(doc.id, doc));

  const allOrders = Array.from(uniqueDocs.values())
    .map((doc) => normalizeOrder(doc))
    .sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime());

  const ref = firestore.collection(business.collectionName).doc(business.businessId).collection('customers').doc(customerUid);

  if (!allOrders.length) {
    if (customerDoc.exists) {
      await ref.delete();
    }
    if (profile?.userType === 'user') {
      await rebuildJoinedRestaurantProfile({ firestore, customerUid, business, allOrders: [] });
    }
    return;
  }

  const latest = allOrders[0];
  const currentData = customerDoc.exists ? (customerDoc.data() || {}) : {};
  const dishStats = buildDishStats(allOrders);
  const addresses = dedupeAddresses([
    ...(profile?.addresses || []),
    ...allOrders.map((order) => order.customerAddress && { full: order.customerAddress }).filter(Boolean),
  ]);

  const payload = {
    customerId: String(customerUid),
    name: profile?.name || latest.customerName || currentData.name || 'Guest Customer',
    status: getCustomerStatusForBusiness(profile, currentData),
    customerType: getCustomerType(profile, customerUid, currentData),
    totalOrders: allOrders.length,
    totalSpend: Number(allOrders.reduce((sum, order) => sum + toNumber(order.subtotal), 0).toFixed(2)),
    totalBillValue: Number(allOrders.reduce((sum, order) => sum + toNumber(order.grandTotal), 0).toFixed(2)),
    lastOrderDate: toDate(latest.orderDate) || new Date(),
    lastActivityAt: toDate(latest.orderDate) || new Date(),
    lastOrderId: latest.firestoreOrderId,
    dishStats,
    bestDishes: computeBestDishes(dishStats),
    addresses,
    recentOrderIds: allOrders.map((order) => order.firestoreOrderId).slice(0, 20),
    updatedAt: new Date(),
  };

  if (profile?.email || currentData.email) payload.email = profile?.email || currentData.email || '';
  if (profile?.phone || currentData.phone || latest.customerPhone) {
    payload.phone = profile?.phone || currentData.phone || latest.customerPhone || '';
  }

  if (!customerDoc.exists) {
    payload.createdAt = new Date();
    payload.joinedAt = toDate(allOrders[allOrders.length - 1]?.orderDate) || new Date();
  }

  await ref.set(payload, { merge: true });

  if (profile?.userType === 'user') {
    await rebuildJoinedRestaurantProfile({ firestore, customerUid, business, allOrders });
  }
}

export async function patchCustomerResult({ firestore, identifier, action, payload = {} }) {
  const profile =
    await getCustomerProfileByUid(firestore, identifier) ||
    await getCustomerProfileByCustomerId(firestore, identifier);

  if (!profile) {
    throw new Error(`No customer found for ID ${identifier}.`);
  }

  const collectionName = profile.userType === 'guest' ? 'guest_profiles' : 'users';
  const ref = firestore.collection(collectionName).doc(profile.uid);
  const update = { updatedAt: new Date() };

  if (action === 'delete_address') {
    const index = Number(payload.addressIndex);
    if (!Number.isInteger(index) || index < 0 || index >= (profile.addresses || []).length) {
      throw new Error('Invalid address index.');
    }
    update.addresses = (profile.addresses || []).filter((_, idx) => idx !== index);
  } else if (action === 'update_profile') {
    if (payload.name !== undefined) update.name = normalizeText(payload.name) || profile.name || '';
    if (payload.email !== undefined) update.email = normalizeEmail(payload.email) || '';
    if (payload.phone !== undefined) update.phone = normalizePhone(payload.phone) || '';
    if (payload.status !== undefined) {
      const nextStatus = normalizeText(payload.status);
      if (!CUSTOMER_STATUS_VALUES.has(nextStatus)) {
        throw new Error('Invalid status value.');
      }
      update.status = nextStatus;
      if (profile.userType === 'guest') {
        update.blocked = nextStatus === 'Blocked';
      }
    }
    if (Array.isArray(payload.addresses)) {
      update.addresses = dedupeAddresses(payload.addresses);
    }
  } else {
    throw new Error('Invalid customer action.');
  }

  await ref.set(update, { merge: true });
  const refreshed = await getCustomerProfileByUid(firestore, profile.uid);
  await syncBusinessCustomerDocsForProfile(firestore, refreshed);
  return getCustomerResult(firestore, refreshed.customerId || refreshed.uid);
}

export async function deleteOrderResult({ firestore, identifier }) {
  const resolved = await resolveOrderDoc(firestore, identifier);
  if (!resolved?.doc) {
    throw new Error(`No order found for ID ${identifier}.`);
  }

  if (resolved.source === 'custom_bill_history') {
    const raw = resolved.doc.data() || {};
    const order = normalizeManualBill(resolved.doc);
    await resolved.doc.ref.delete();

    return {
      deletedOrder: order,
      customerUid: order.userId || null,
      businessId: order.restaurantId || null,
      storage: 'custom_bill_history',
      source: raw.source || 'offline_counter',
    };
  }

  const raw = resolved.doc.data() || {};
  const order = normalizeOrder(resolved.doc);
  const business = await findBusinessByDocId(firestore, order.restaurantId);
  const customerUid = order.userId;
  let couponRef = null;
  let couponExists = false;

  if (business?.collectionName && raw?.coupon?.id) {
    couponRef = firestore
      .collection(business.collectionName)
      .doc(business.businessId)
      .collection('coupons')
      .doc(String(raw.coupon.id));
    const couponSnap = await couponRef.get();
    couponExists = couponSnap.exists;
  }

  const batch = firestore.batch();
  batch.delete(resolved.doc.ref);

  if (raw.trackingToken) {
    batch.delete(firestore.collection('auth_tokens').doc(String(raw.trackingToken)));
  }

  if (couponRef && couponExists) {
    batch.set(couponRef, { timesUsed: FieldValue.increment(-1), updatedAt: new Date() }, { merge: true });
  }

  await batch.commit();

  if (business && customerUid) {
    await rebuildBusinessCustomerAggregate({ firestore, business, customerUid });
  }

  return {
    deletedOrder: order,
    customerUid: customerUid || null,
    businessId: business?.businessId || order.restaurantId || null,
    storage: 'orders',
    source: raw.orderSource || 'online_order',
  };
}
