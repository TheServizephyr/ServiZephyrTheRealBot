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

function getStatsPayloadVersion(statsData = {}) {
  const version = Number(statsData?.version);
  return Number.isFinite(version) ? version : -1;
}

function isFreshDashboardStatsPayload(statsData = {}, targetStatsVersion = 0) {
  if (!statsData || typeof statsData !== 'object') return false;
  return getStatsPayloadVersion(statsData) === Number(targetStatsVersion || 0);
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


async function computeDashboardStatsPayload({
  firestore,
  businessRef,
  businessId,
  collectionName,
  now = new Date(),
  targetStatsVersion = 0,
} = {}) {
  const ordersRef = firestore.collection('orders').where('restaurantId', '==', businessId);
  const customersRef = businessRef.collection('customers');
  const customBillHistoryRef = businessRef.collection('custom_bill_history');
  const businessSnap = await businessRef.get();
  const businessData = businessSnap.exists ? (businessSnap.data() || {}) : {};

  const todayRange = getRangeDays('Today', now);
  const weekRange = getRangeDays('This Week', now);
  const monthRange = getRangeDays('This Month', now);
  
  const prevTodayRange = getPreviousRange(todayRange.start, todayRange.end);
  const prevWeekRange = getPreviousRange(weekRange.start, weekRange.end);
  const prevMonthRange = getPreviousRange(monthRange.start, monthRange.end);

  // Use the oldest comparison start date for an efficient single query
  const oldestStart = new Date(Math.min(
    prevMonthRange.prevStart.getTime(),
    prevWeekRange.prevStart.getTime(),
    prevTodayRange.prevStart.getTime()
  ));

  const [
    allRecentOrdersSnap,
    allRecentManualSnap,
    customersSnap,
    liveOrdersSnap,
  ] = await Promise.all([
    ordersRef.where('orderDate', '>=', oldestStart).where('orderDate', '<=', todayRange.end).get(),
    customBillHistoryRef.where('printedAt', '>=', oldestStart).where('printedAt', '<=', todayRange.end).get(),
    customersRef.get(),
    ordersRef.where('status', 'in', ['pending', 'confirmed']).orderBy('orderDate', 'desc').limit(15).get(),
  ]);

  const allOrders = allRecentOrdersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const allManualBills = allRecentManualSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const customers = customersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const filterInRange = (items, start, end, dateField) => items.filter(item => {
    const d = timestampToDate(item[dateField]);
    return d && d >= start && d <= end;
  });

  const aggregateMetrics = (orders, bills) => {
    const acceptedOrders = orders.filter(o => !LOST_ORDER_STATUSES.has(String(o.status || '').toLowerCase()));
    const acceptedBills = bills.filter(b => !isCancelledManualBill(b));
    const onlineSales = acceptedOrders.reduce((sum, o) => sum + toAmount(o.totalAmount), 0);
    const manualSales = acceptedBills.reduce((sum, b) => sum + toAmount(b.totalAmount || b.grandTotal), 0);
    const totalSales = onlineSales + manualSales;
    const totalOrders = acceptedOrders.length + acceptedBills.length;
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;
    return { onlineSales, manualSales, totalSales, totalOrders, avgOrderValue, acceptedOrders, acceptedBills };
  };

  const computeForRange = (rangeStart, rangeEnd, prevRangeStart, prevRangeEnd) => {
    const orders = filterInRange(allOrders, rangeStart, rangeEnd, 'orderDate');
    const bills = filterInRange(allManualBills, rangeStart, rangeEnd, 'printedAt');
    const prevOrders = filterInRange(allOrders, prevRangeStart, prevRangeEnd, 'orderDate');
    const prevBills = filterInRange(allManualBills, prevRangeStart, prevRangeEnd, 'printedAt');

    const metrics = aggregateMetrics(orders, bills);
    const prevMetrics = aggregateMetrics(prevOrders, prevBills);

    const rejections = orders.filter(o => LOST_ORDER_STATUSES.has(String(o.status || '').toLowerCase())).length;

    const newCustomers = customers.filter(c => {
      const j = timestampToDate(c.joinedAt);
      return j && j >= rangeStart && j <= rangeEnd;
    }).length;
    const prevNewCustomers = customers.filter(c => {
      const j = timestampToDate(c.joinedAt);
      return j && j >= prevRangeStart && j <= prevRangeEnd;
    }).length;

    return {
      sales: metrics.totalSales,
      orders: metrics.totalOrders,
      newCustomers,
      avgOrderValue: metrics.avgOrderValue,
      rejections,
      manualBills: metrics.acceptedBills.length,
      manualSales: metrics.manualSales,
      onlineOrders: metrics.acceptedOrders.length,
      onlineSales: metrics.onlineSales,
      acceptedOrders: metrics.acceptedOrders,
      acceptedBills: metrics.acceptedBills,
      comparisons: {
        salesChange: Number(calcChange(metrics.totalSales, prevMetrics.totalSales).toFixed(1)),
        ordersChange: Number(calcChange(metrics.totalOrders, prevMetrics.totalOrders).toFixed(1)),
        newCustomersChange: Number(calcChange(newCustomers, prevNewCustomers).toFixed(1)),
        avgOrderValueChange: Number(calcChange(metrics.avgOrderValue, prevMetrics.avgOrderValue).toFixed(1)),
      }
    };
  };

  const todayMetrics = computeForRange(todayRange.start, todayRange.end, prevTodayRange.prevStart, prevTodayRange.prevEnd);
  const weekMetrics = computeForRange(weekRange.start, weekRange.end, prevWeekRange.prevStart, prevWeekRange.prevEnd);
  const monthMetrics = computeForRange(monthRange.start, monthRange.end, prevMonthRange.prevStart, prevMonthRange.prevEnd);

  const liveOrders = liveOrdersSnap.docs.map((doc) => {
    const orderData = doc.data() || {};
    return {
      id: doc.id,
      customer: orderData.customerName || orderData.name || 'Customer',
      amount: toAmount(orderData.totalAmount),
      items: (orderData.items || []).map(item => ({ name: item.name, quantity: item.qty || item.quantity || 0 })),
      status: orderData.status || 'pending',
    };
  });

  const salesByDay = new Map();
  const addChartSale = (dateValue, amount) => {
    const date = timestampToDate(dateValue);
    if (!date) return;
    const key = date.toISOString().slice(0, 10);
    const current = salesByDay.get(key) || { day: date.toLocaleDateString('en-US', { weekday: 'short' }), sales: 0, ts: date.getTime() };
    current.sales += amount;
    salesByDay.set(key, current);
  };

  if(monthMetrics.acceptedOrders) {
      monthMetrics.acceptedOrders.forEach(o => addChartSale(o.orderDate, toAmount(o.totalAmount)));
      monthMetrics.acceptedBills.forEach(b => addChartSale(b.printedAt || b.createdAt, toAmount(b.totalAmount || b.grandTotal)));
  }

  const salesChart = Array.from(salesByDay.values())
    .sort((a, b) => a.ts - b.ts)
    .map(({ day, sales }) => ({ day, sales }));

  const itemCounts = {};
  const addItemCounts = (items = []) => {
    items.forEach(item => {
      const name = String(item?.name || '').trim();
      if (!name) return;
      itemCounts[name] = (itemCounts[name] || 0) + toAmount(item?.quantity || item?.qty || 0);
    });
  };
  
  todayMetrics.acceptedOrders.forEach(order => addItemCounts(order.items || []));
  todayMetrics.acceptedBills.forEach(bill => addItemCounts(bill.items || []));

  const topItems = Object.entries(itemCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  const buildFinalOutput = (metrics) => {
      const { acceptedOrders, acceptedBills, comparisons, rejections, ...rest } = metrics;
      return { ...rest, todayRejections: rejections };
  };

  return {
    businessId,
    collectionName,
    businessType: normalizeBusinessType(businessData?.businessType || collectionName?.slice(0, -1)),
    version: Number(targetStatsVersion || 0),
    updatedAt: new Date().toISOString(),
    today: buildFinalOutput(todayMetrics),
    todayComparisons: todayMetrics.comparisons,
    thisWeek: buildFinalOutput(weekMetrics),
    thisWeekComparisons: weekMetrics.comparisons,
    thisMonth: buildFinalOutput(monthMetrics),
    thisMonthComparisons: monthMetrics.comparisons,
    live: {
      pending: liveOrders.filter(o => String(o.status).toLowerCase() === 'pending').length,
      confirmed: liveOrders.filter(o => String(o.status).toLowerCase() === 'confirmed').length,
      orderCount: liveOrders.length,
      orders: liveOrders,
    },
    rolling: {
      last7DaysSales: weekMetrics.sales,
      last7DaysOrders: weekMetrics.orders,
      thisMonthSales: monthMetrics.sales,
      thisMonthOrders: monthMetrics.orders,
    },
    charts: { salesChart },
    topItems,
  };
}
export async function rebuildDashboardStats({
  firestore: providedFirestore = null,
  businessId,
  collectionNameHint = null,
  businessRef: providedBusinessRef = null,
  targetStatsVersion = null,
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

  const runtimeData = await getBusinessRuntime(businessRef);
  const resolvedTargetStatsVersion = Number.isFinite(Number(targetStatsVersion))
    ? Number(targetStatsVersion)
    : Number(runtimeData?.statsVersion || 0);

  const payload = await computeDashboardStatsPayload({
    firestore,
    businessRef,
    businessId,
    collectionName,
    targetStatsVersion: resolvedTargetStatsVersion,
  });

  await getDashboardStatsRef(businessRef).set(payload, { merge: true });
  await setBusinessRuntimeFlags(businessRef, {
    statsVersion: resolvedTargetStatsVersion,
    statsReconcileQueued: false,
    lastStatsReconciledAt: new Date(),
  });

  invalidateSharedCache(`dashboard-stats:${businessId}`, { prefixMatch: true });
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

  const currentStatsVersion = Number(runtimeData?.statsVersion || 0);

  return getOrSetSharedCache(`dashboard-stats:${businessId}:v${currentStatsVersion}`, {
    ttlMs: 30 * 1000,
    kvTtlSec: 60,
    compute: async () => {
      const statsSnap = await getDashboardStatsRef(business.ref).get();
      const statsData = statsSnap.exists ? (statsSnap.data() || null) : null;
      if (isFreshDashboardStatsPayload(statsData, currentStatsVersion)) {
        return statsData;
      }

      if (!allowInlineRebuild) {
        await setBusinessRuntimeFlags(business.ref, { statsReconcileQueued: true });
        await enqueueDerivedJob({
          type: 'dashboard_stats_reconcile',
          jobKey: `dashboard_stats_reconcile:${businessId}`,
          payload: {
            businessId,
            collectionName: business.collection,
            targetStatsVersion: currentStatsVersion,
          },
        });
        return null;
      }

      return rebuildDashboardStats({
        firestore,
        businessId,
        collectionNameHint: business.collection,
        businessRef: business.ref,
        targetStatsVersion: currentStatsVersion,
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
