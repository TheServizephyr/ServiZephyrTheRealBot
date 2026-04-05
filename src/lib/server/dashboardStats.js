import { getFirestore } from '@/lib/firebase-admin';
import { findBusinessById } from '@/services/business/businessService';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { bumpBusinessRuntimeVersions, getBusinessRuntime, resolveScopedFeatureFlagValue, setBusinessRuntimeFlags } from '@/lib/server/businessRuntime';
import { enqueueDerivedJob } from '@/lib/server/derivedJobs';
import { getOrSetSharedCache, invalidateSharedCache } from '@/lib/server/sharedCache';

export const DASHBOARD_STATS_COLLECTION = 'dashboard_stats';
export const DASHBOARD_STATS_DOC_ID = 'current';

const LOST_ORDER_STATUSES = new Set(['rejected', 'cancelled', 'failed_delivery', 'returned_to_restaurant']);

function normalizeBusinessType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street_vendor' || normalized === 'street-vendor') return 'street-vendor';
  return 'restaurant';
}

function isCancelledManualBill(bill = {}) {
  return String(bill.status || '').toLowerCase() === 'cancelled';
}

function toAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getRangeDays(filter, now = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let start;
  switch (filter) {
    case 'This Week': {
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      break;
    }
    case 'This Month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'Today':
    default:
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function getPreviousRange(start, end) {
  const duration = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - duration);
  return { prevStart, prevEnd };
}

function calcChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function getDashboardStatsRef(businessRef) {
  return businessRef.collection(DASHBOARD_STATS_COLLECTION).doc(DASHBOARD_STATS_DOC_ID);
}

async function computeDashboardStatsPayload({ firestore, businessRef, businessId, collectionName, now = new Date() }) {
  const ordersRef = firestore.collection('orders').where('restaurantId', '==', businessId);
  const customersRef = businessRef.collection('customers');
  const customBillHistoryRef = businessRef.collection('custom_bill_history');
  const businessSnap = await businessRef.get();
  const businessData = businessSnap.exists ? (businessSnap.data() || {}) : {};

  const todayRange = getRangeDays('Today', now);
  const weekRange = getRangeDays('This Week', now);
  const monthRange = getRangeDays('This Month', now);
  const { prevStart, prevEnd } = getPreviousRange(todayRange.start, todayRange.end);

  const [
    currentOrdersSnap,
    prevOrdersSnap,
    currentManualSnap,
    prevManualSnap,
    customersSnap,
    liveOrdersSnap,
    weekOrdersSnap,
    weekManualSnap,
    monthOrdersSnap,
    monthManualSnap,
    todayRejectedSnap,
  ] = await Promise.all([
    ordersRef.where('orderDate', '>=', todayRange.start).where('orderDate', '<=', todayRange.end).get(),
    ordersRef.where('orderDate', '>=', prevStart).where('orderDate', '<=', prevEnd).get(),
    customBillHistoryRef.where('printedAt', '>=', todayRange.start).where('printedAt', '<=', todayRange.end).get(),
    customBillHistoryRef.where('printedAt', '>=', prevStart).where('printedAt', '<=', prevEnd).get(),
    customersRef.get(),
    ordersRef.where('status', 'in', ['pending', 'confirmed']).orderBy('orderDate', 'desc').limit(6).get(),
    ordersRef.where('orderDate', '>=', weekRange.start).where('orderDate', '<=', weekRange.end).get(),
    customBillHistoryRef.where('printedAt', '>=', weekRange.start).where('printedAt', '<=', weekRange.end).get(),
    ordersRef.where('orderDate', '>=', monthRange.start).where('orderDate', '<=', monthRange.end).get(),
    customBillHistoryRef.where('printedAt', '>=', monthRange.start).where('printedAt', '<=', monthRange.end).get(),
    ordersRef.where('orderDate', '>=', todayRange.start).where('orderDate', '<=', todayRange.end).get(),
  ]);

  const acceptedCurrentOrders = currentOrdersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((order) => !LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase()));
  const acceptedPrevOrders = prevOrdersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((order) => !LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase()));
  const currentManualBills = currentManualSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((bill) => !isCancelledManualBill(bill));
  const prevManualBills = prevManualSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((bill) => !isCancelledManualBill(bill));

  const currentOrderSales = acceptedCurrentOrders.reduce((sum, order) => sum + toAmount(order.totalAmount), 0);
  const prevOrderSales = acceptedPrevOrders.reduce((sum, order) => sum + toAmount(order.totalAmount), 0);
  const currentManualSales = currentManualBills.reduce((sum, bill) => sum + toAmount(bill.totalAmount || bill.grandTotal), 0);
  const prevManualSales = prevManualBills.reduce((sum, bill) => sum + toAmount(bill.totalAmount || bill.grandTotal), 0);

  const totalSales = currentOrderSales + currentManualSales;
  const prevTotalSales = prevOrderSales + prevManualSales;
  const totalOrders = acceptedCurrentOrders.length + currentManualBills.length;
  const prevTotalOrders = acceptedPrevOrders.length + prevManualBills.length;
  const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
  const prevAvgOrderValue = prevTotalOrders > 0 ? prevTotalSales / prevTotalOrders : 0;

  const customers = customersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const newCustomersCurrent = customers.filter((customer) => {
    const joinedAt = timestampToDate(customer.joinedAt);
    return joinedAt && joinedAt >= todayRange.start && joinedAt <= todayRange.end;
  }).length;
  const newCustomersPrevious = customers.filter((customer) => {
    const joinedAt = timestampToDate(customer.joinedAt);
    return joinedAt && joinedAt >= prevStart && joinedAt <= prevEnd;
  }).length;

  const todayRejections = todayRejectedSnap.docs.filter((doc) =>
    LOST_ORDER_STATUSES.has(String(doc.data()?.status || '').toLowerCase())
  ).length;

  const liveOrders = liveOrdersSnap.docs.map((doc) => {
    const orderData = doc.data() || {};
    return {
      id: doc.id,
      customer: orderData.customerName || orderData.name || 'Customer',
      amount: toAmount(orderData.totalAmount),
      items: (orderData.items || []).map((item) => ({
        name: item.name,
        quantity: item.qty || item.quantity || 0,
      })),
      status: orderData.status || 'pending',
    };
  });

  const salesByDay = new Map();
  const addChartSale = (dateValue, amount) => {
    const date = timestampToDate(dateValue);
    if (!date) return;
    const key = date.toISOString().slice(0, 10);
    const current = salesByDay.get(key) || {
      day: date.toLocaleDateString('en-US', { weekday: 'short' }),
      sales: 0,
      ts: date.getTime(),
    };
    current.sales += amount;
    salesByDay.set(key, current);
  };

  [...weekOrdersSnap.docs, ...monthOrdersSnap.docs].forEach((doc) => {
    const order = doc.data() || {};
    if (LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase())) return;
    addChartSale(order.orderDate, toAmount(order.totalAmount));
  });

  [...weekManualSnap.docs, ...monthManualSnap.docs].forEach((doc) => {
    const bill = doc.data() || {};
    if (isCancelledManualBill(bill)) return;
    addChartSale(bill.printedAt || bill.createdAt, toAmount(bill.totalAmount || bill.grandTotal));
  });

  const salesChart = Array.from(salesByDay.values())
    .sort((a, b) => a.ts - b.ts)
    .map(({ day, sales }) => ({ day, sales }));

  const itemCounts = {};
  const addItemCounts = (items = []) => {
    items.forEach((item) => {
      const name = String(item?.name || '').trim();
      if (!name) return;
      const quantity = toAmount(item?.quantity || item?.qty || 0);
      itemCounts[name] = (itemCounts[name] || 0) + quantity;
    });
  };
  acceptedCurrentOrders.forEach((order) => addItemCounts(order.items || []));
  currentManualBills.forEach((bill) => addItemCounts(bill.items || []));

  const topItems = Object.entries(itemCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  const weekAcceptedOrders = weekOrdersSnap.docs.map((doc) => doc.data() || {})
    .filter((order) => !LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase()));
  const weekAcceptedBills = weekManualSnap.docs.map((doc) => doc.data() || {})
    .filter((bill) => !isCancelledManualBill(bill));
  const monthAcceptedOrders = monthOrdersSnap.docs.map((doc) => doc.data() || {})
    .filter((order) => !LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase()));
  const monthAcceptedBills = monthManualSnap.docs.map((doc) => doc.data() || {})
    .filter((bill) => !isCancelledManualBill(bill));

  return {
    businessId,
    collectionName,
    businessType: normalizeBusinessType(businessData?.businessType || collectionName?.slice(0, -1)),
    version: Number(businessData?.statsVersion || 0),
    updatedAt: new Date().toISOString(),
    today: {
      sales: totalSales,
      orders: totalOrders,
      newCustomers: newCustomersCurrent,
      avgOrderValue,
      todayRejections,
      manualBills: currentManualBills.length,
      manualSales: currentManualSales,
      onlineOrders: acceptedCurrentOrders.length,
      onlineSales: currentOrderSales,
    },
    todayComparisons: {
      salesChange: Number(calcChange(totalSales, prevTotalSales).toFixed(1)),
      ordersChange: Number(calcChange(totalOrders, prevTotalOrders).toFixed(1)),
      newCustomersChange: Number(calcChange(newCustomersCurrent, newCustomersPrevious).toFixed(1)),
      avgOrderValueChange: Number(calcChange(avgOrderValue, prevAvgOrderValue).toFixed(1)),
    },
    live: {
      pending: liveOrders.filter((order) => String(order.status).toLowerCase() === 'pending').length,
      confirmed: liveOrders.filter((order) => String(order.status).toLowerCase() === 'confirmed').length,
      orderCount: liveOrders.length,
      orders: liveOrders,
    },
    rolling: {
      last7DaysSales: weekAcceptedOrders.reduce((sum, order) => sum + toAmount(order.totalAmount), 0)
        + weekAcceptedBills.reduce((sum, bill) => sum + toAmount(bill.totalAmount || bill.grandTotal), 0),
      last7DaysOrders: weekAcceptedOrders.length + weekAcceptedBills.length,
      thisMonthSales: monthAcceptedOrders.reduce((sum, order) => sum + toAmount(order.totalAmount), 0)
        + monthAcceptedBills.reduce((sum, bill) => sum + toAmount(bill.totalAmount || bill.grandTotal), 0),
      thisMonthOrders: monthAcceptedOrders.length + monthAcceptedBills.length,
    },
    charts: {
      salesChart,
    },
    topItems,
  };
}

export async function rebuildDashboardStats({
  firestore: providedFirestore = null,
  businessId,
  collectionNameHint = null,
  businessRef: providedBusinessRef = null,
} = {}) {
  const firestore = providedFirestore || await getFirestore();
  let businessRef = providedBusinessRef;
  let collectionName = collectionNameHint;

  if (!businessRef || !collectionName) {
    const business = await findBusinessById(firestore, businessId, {
      collectionNameHint,
      includeDeliverySettings: false,
    });
    if (!business?.ref) {
      throw new Error(`Business not found for dashboard stats rebuild: ${businessId}`);
    }
    businessRef = business.ref;
    collectionName = business.collection;
  }

  const payload = await computeDashboardStatsPayload({
    firestore,
    businessRef,
    businessId,
    collectionName,
  });

  await getDashboardStatsRef(businessRef).set(payload, { merge: true });
  await setBusinessRuntimeFlags(businessRef, {
    statsVersion: Number(payload.version || 0),
    statsReconcileQueued: false,
    lastStatsReconciledAt: new Date(),
  });

  invalidateSharedCache(`dashboard-stats:${businessId}`);
  return payload;
}

export async function getFreshDashboardStats({
  firestore: providedFirestore = null,
  businessId,
  collectionNameHint = null,
  allowInlineRebuild = true,
} = {}) {
  const firestore = providedFirestore || await getFirestore();
  const business = await findBusinessById(firestore, businessId, {
    collectionNameHint,
    includeDeliverySettings: false,
  });
  if (!business?.ref) return null;

  const businessData = business.data || {};
  const runtimeData = await getBusinessRuntime(business.ref);
  const statsEnabled = resolveScopedFeatureFlagValue('dashboard_stats_enabled', {
    businessData,
    runtimeData,
    envDefault: FEATURE_FLAGS.USE_DASHBOARD_STATS,
  });
  if (!statsEnabled) return null;

  return getOrSetSharedCache(`dashboard-stats:${businessId}:v${Number(runtimeData?.statsVersion || businessData?.statsVersion || 0)}`, {
    ttlMs: 30 * 1000,
    kvTtlSec: 60,
    compute: async () => {
      const statsSnap = await getDashboardStatsRef(business.ref).get();
      const statsData = statsSnap.exists ? (statsSnap.data() || null) : null;
      if (statsData && !allowInlineRebuild) return statsData;
      if (statsData) return statsData;

      if (!allowInlineRebuild) {
        await setBusinessRuntimeFlags(business.ref, { statsReconcileQueued: true });
        await enqueueDerivedJob({
          type: 'dashboard_stats_reconcile',
          jobKey: `dashboard_stats_reconcile:${businessId}`,
          payload: {
            businessId,
            collectionName: business.collection,
          },
        });
        return null;
      }

      return rebuildDashboardStats({
        firestore,
        businessId,
        collectionNameHint: business.collection,
        businessRef: business.ref,
      });
    },
  });
}

export async function queueDashboardStatsRefresh({
  businessRef,
  businessId,
  collectionName,
  reason = 'order_mutation',
  bumpStatsVersion = true,
  bumpActiveOrderVersion = false,
} = {}) {
  if (bumpStatsVersion || bumpActiveOrderVersion) {
    await bumpBusinessRuntimeVersions(businessRef, {
      statsVersion: bumpStatsVersion,
      activeOrderVersion: bumpActiveOrderVersion,
    });
  }

  await setBusinessRuntimeFlags(businessRef, {
    statsReconcileQueued: true,
  });

  await enqueueDerivedJob({
    type: 'dashboard_stats_reconcile',
    jobKey: `dashboard_stats_reconcile:${businessId}`,
    payload: {
      businessId,
      collectionName,
      reason,
    },
  });
}
