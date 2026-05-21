const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIstDayKey(date) {
  const d = timestampToDate(date);
  if (!d) return null;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDayKey(dayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ''))) return null;
  const [year, month, day] = dayKey.split('-').map(Number);
  return { year, month, day };
}

function istStartOfDay(dayKey) {
  const parts = parseDayKey(dayKey);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - IST_OFFSET_MS);
}

function istEndOfDay(dayKey) {
  const start = istStartOfDay(dayKey);
  return start ? new Date(start.getTime() + MS_PER_DAY - 1) : null;
}

function addDays(dayKey, days) {
  const start = istStartOfDay(dayKey);
  if (!start) return null;
  return toIstDayKey(new Date(start.getTime() + days * MS_PER_DAY + IST_OFFSET_MS));
}

function compareDateAsc(a, b) {
  return a.getTime() - b.getTime();
}

function minDate(dates) {
  return dates.filter(Boolean).sort(compareDateAsc)[0];
}

function maxDate(dates) {
  return dates.filter(Boolean).sort(compareDateAsc).at(-1);
}

function getWindow(startKey, endKey) {
  return {
    startKey,
    endKey,
    start: istStartOfDay(startKey),
    end: istEndOfDay(endKey),
  };
}

function getPreviousWindow(window) {
  const days = Math.max(1, Math.round((window.end.getTime() - window.start.getTime() + 1) / MS_PER_DAY));
  const previousEndKey = addDays(window.startKey, -1);
  const previousStartKey = addDays(window.startKey, -days);
  return getWindow(previousStartKey, previousEndKey);
}

function startOfIstMonthKey(dayKey) {
  const parts = parseDayKey(dayKey);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-01`;
}

function startOfIstYearKey(dayKey) {
  const parts = parseDayKey(dayKey);
  return `${parts.year}-01-01`;
}

function startOfIstWeekKey(dayKey) {
  const start = istStartOfDay(dayKey);
  const istNoon = new Date(start.getTime() + IST_OFFSET_MS + 12 * 60 * 60 * 1000);
  const day = istNoon.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(dayKey, -daysSinceMonday);
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAnalyticsRange(searchParams, now = new Date()) {
  const todayKey = toIstDayKey(now);
  const rawStart = searchParams?.get?.('start');
  const rawEnd = searchParams?.get?.('end');
  const endKey = toIstDayKey(normalizeDate(rawEnd) || now) || todayKey;
  const fallbackStartKey = addDays(endKey, -40);
  const startKey = toIstDayKey(normalizeDate(rawStart)) || fallbackStartKey;
  const start = istStartOfDay(startKey);
  const end = istEndOfDay(endKey);

  if (start > end) {
    return getWindow(endKey, endKey);
  }

  return { startKey, endKey, start, end };
}

function buildPeriodWindows(now = new Date()) {
  const todayKey = toIstDayKey(now);
  const windows = {
    today: { label: 'Today', ...getWindow(todayKey, todayKey) },
    yesterday: { label: 'Yesterday', ...getWindow(addDays(todayKey, -1), addDays(todayKey, -1)) },
    week: { label: 'This Week', ...getWindow(startOfIstWeekKey(todayKey), todayKey) },
    month: { label: 'This Month', ...getWindow(startOfIstMonthKey(todayKey), todayKey) },
    year: { label: 'This Year', ...getWindow(startOfIstYearKey(todayKey), todayKey) },
  };

  return Object.fromEntries(
    Object.entries(windows).map(([key, value]) => [
      key,
      {
        ...value,
        previous: getPreviousWindow(value),
      },
    ])
  );
}

function normalizeAmount(order = {}) {
  const candidates = [order.totalAmount, order.grandTotal, order.amount, order.billTotal];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function normalizeQty(item = {}) {
  const qty = Number(item.qty ?? item.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function emptyMetric() {
  return { orderCount: 0, revenue: 0 };
}

function addMetric(metric, amount) {
  metric.orderCount += 1;
  metric.revenue += amount;
}

function finalizeMetric(metric) {
  const orderCount = Number(metric?.orderCount || 0);
  const revenue = Math.round(Number(metric?.revenue || 0) * 100) / 100;
  return {
    orderCount,
    revenue,
    avgOrderValue: orderCount > 0 ? Math.round((revenue / orderCount) * 100) / 100 : 0,
  };
}

const ORDER_SOURCE_BUCKETS = {
  whatsappOnline: {
    key: 'whatsappOnline',
    label: 'WhatsApp Online',
    description: 'Customer orders placed from WhatsApp/menu links',
  },
  dineIn: {
    key: 'dineIn',
    label: 'Dine-in',
    description: 'QR/table dine-in orders',
  },
  manual: {
    key: 'manual',
    label: 'Manual / Counter',
    description: 'Manual call, counter, and custom bills',
  },
  bookings: {
    key: 'bookings',
    label: 'Bookings',
    description: 'Table booking requests',
  },
  other: {
    key: 'other',
    label: 'Other Orders',
    description: 'Pickup, car, and uncategorized orders',
  },
};

function createSourceMetrics() {
  return Object.fromEntries(
    Object.values(ORDER_SOURCE_BUCKETS).map((bucket) => [
      bucket.key,
      {
        ...bucket,
        current: emptyMetric(),
        previous: emptyMetric(),
      },
    ])
  );
}

function classifyOrderSource(order = {}) {
  const deliveryType = String(order.deliveryType || '').trim().toLowerCase();
  const orderSource = String(order.orderSource || order.source || order.channel || '').trim().toLowerCase();
  const orderedBy = String(order.ordered_by || order.orderedBy || '').trim().toLowerCase();

  if (
    order.isManualCallOrder ||
    order.isCustomBill ||
    orderSource.includes('manual') ||
    orderSource.includes('custom_bill') ||
    orderedBy.includes('owner') ||
    orderedBy.includes('employee') ||
    orderedBy.includes('staff')
  ) {
    return 'manual';
  }

  if (deliveryType === 'dine-in' || order.dineInTabId || order.dineInToken) {
    return 'dineIn';
  }

  if (deliveryType === 'delivery' || deliveryType === 'pickup' || deliveryType === 'street-vendor-pre-order') {
    return 'whatsappOnline';
  }

  return 'other';
}

function addSourceMetric(sourceMetrics, key, amount, target = 'current') {
  const source = sourceMetrics[key] || sourceMetrics.other;
  addMetric(source[target], amount);
}

function finalizeSourceMetrics(sourceMetrics) {
  return Object.values(sourceMetrics).map((source) => {
    const current = finalizeMetric(source.current);
    const previous = finalizeMetric(source.previous);
    return {
      key: source.key,
      label: source.label,
      description: source.description,
      current,
      previous,
      orderGrowth: growth(current.orderCount, previous.orderCount),
      revenueGrowth: growth(current.revenue, previous.revenue),
    };
  });
}

function growth(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);
  const delta = currentValue - previousValue;

  if (previousValue === 0) {
    return {
      delta,
      percent: currentValue > 0 ? null : 0,
      direction: currentValue > 0 ? 'up' : 'flat',
      label: currentValue > 0 ? 'New' : '0%',
    };
  }

  const percent = Math.round((delta / previousValue) * 1000) / 10;
  return {
    delta,
    percent,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    label: `${percent > 0 ? '+' : ''}${percent}%`,
  };
}

function isInWindow(date, window) {
  return date && window?.start && window?.end && date >= window.start && date <= window.end;
}

function buildDaySeries(startKey, endKey) {
  const map = new Map();
  let cursor = startKey;
  while (cursor <= endKey) {
    map.set(cursor, { date: cursor, revenue: 0, orders: 0 });
    cursor = addDays(cursor, 1);
  }
  return map;
}

function ensureRestaurant(map, id, fallbackName = '') {
  if (!map.has(id)) {
    map.set(id, {
      id,
      name: fallbackName,
      today: emptyMetric(),
      yesterday: emptyMetric(),
      week: emptyMetric(),
      month: emptyMetric(),
      year: emptyMetric(),
      selected: emptyMetric(),
      todaySources: createSourceMetrics(),
      sources: createSourceMetrics(),
    });
  } else if (fallbackName && !map.get(id).name) {
    map.get(id).name = fallbackName;
  }
  return map.get(id);
}

function getParentBusinessId(doc) {
  return doc?.ref?.parent?.parent?.id || '';
}

async function resolveListingNames(firestore, ids = [], fallbackNames = {}) {
  if (!ids.length) return {};
  const result = {};

  await Promise.all(ids.map(async (id) => {
    if (!id) return;
    const [restaurantSnap, shopSnap, vendorSnap] = await Promise.all([
      firestore.collection('restaurants').doc(id).get(),
      firestore.collection('shops').doc(id).get(),
      firestore.collection('street_vendors').doc(id).get(),
    ]);

    if (restaurantSnap.exists) {
      result[id] = restaurantSnap.data()?.name || fallbackNames[id] || 'Unnamed Restaurant';
    } else if (shopSnap.exists) {
      result[id] = shopSnap.data()?.name || fallbackNames[id] || 'Unnamed Store';
    } else if (vendorSnap.exists) {
      result[id] = vendorSnap.data()?.name || fallbackNames[id] || 'Unnamed Vendor';
    } else {
      result[id] = fallbackNames[id] || `Listing ${id.slice(0, 6)}`;
    }
  }));

  return result;
}

async function getAdminOrderAnalytics(firestore, options = {}) {
  const now = options.now || new Date();
  const selectedWindow = options.selectedWindow || parseAnalyticsRange(options.searchParams || new URLSearchParams(), now);
  const selectedPrevious = getPreviousWindow(selectedWindow);
  const periodWindows = buildPeriodWindows(now);
  const periodList = Object.entries(periodWindows);
  const topLimit = Number(options.topLimit || 10);
  const restaurantLimit = Number(options.restaurantLimit || 20);

  const queryStart = minDate([
    selectedWindow.start,
    selectedPrevious.start,
    ...periodList.map(([, window]) => window.start),
    ...periodList.map(([, window]) => window.previous.start),
  ]);
  const queryEnd = maxDate([
    selectedWindow.end,
    ...periodList.map(([, window]) => window.end),
  ]);

  const ordersSnap = await firestore.collection('orders')
    .where('orderDate', '>=', queryStart)
    .where('orderDate', '<=', queryEnd)
    .get();

  const daySeries = buildDaySeries(selectedWindow.startKey, selectedWindow.endKey);
  const rangeListings = new Map();
  const previousRangeListings = new Map();
  const restaurantMap = new Map();
  const fallbackNames = {};
  const itemStats = new Map();
  const statusCounts = {};
  const sourceMetrics = createSourceMetrics();
  const periodTotals = Object.fromEntries(
    periodList.map(([key, window]) => [
      key,
      {
        key,
        label: window.label,
        range: { start: window.startKey, end: window.endKey },
        previousRange: { start: window.previous.startKey, end: window.previous.endKey },
        current: emptyMetric(),
        previous: emptyMetric(),
      },
    ])
  );

  ordersSnap.docs.forEach((doc) => {
    const order = doc.data() || {};
    const orderDate = timestampToDate(order.orderDate);
    if (!orderDate) return;

    const amount = normalizeAmount(order);
    const listingId = String(order.restaurantId || order.businessId || '').trim();
    const listingName = String(order.restaurantName || order.businessName || '').trim();
    if (listingId && listingName) fallbackNames[listingId] = listingName;

    if (isInWindow(orderDate, selectedWindow)) {
      const sourceKey = classifyOrderSource(order);
      const dayKey = toIstDayKey(orderDate);
      const day = daySeries.get(dayKey);
      if (day) {
        day.orders += 1;
        day.revenue += amount;
      }

      const status = String(order.status || 'unknown').trim().toLowerCase() || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      addSourceMetric(sourceMetrics, sourceKey, amount, 'current');

      if (listingId) {
        addMetric(rangeListings.get(listingId) || rangeListings.set(listingId, emptyMetric()).get(listingId), amount);
        const restaurant = ensureRestaurant(restaurantMap, listingId, listingName);
        addMetric(restaurant.selected, amount);
        addSourceMetric(restaurant.sources, sourceKey, amount, 'current');
        if (isInWindow(orderDate, periodWindows.today)) {
          addSourceMetric(restaurant.todaySources, sourceKey, amount, 'current');
        }
      }

      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach((item) => {
        const itemName = String(item?.name || item?.title || 'Unknown Item').trim();
        if (!itemName) return;
        const prev = itemStats.get(itemName) || { orders: 0 };
        prev.orders += normalizeQty(item);
        itemStats.set(itemName, prev);
      });
    }

    if (isInWindow(orderDate, selectedPrevious) && listingId) {
      addMetric(previousRangeListings.get(listingId) || previousRangeListings.set(listingId, emptyMetric()).get(listingId), amount);
    }

    if (isInWindow(orderDate, selectedPrevious)) {
      addSourceMetric(sourceMetrics, classifyOrderSource(order), amount, 'previous');
    }

    periodList.forEach(([key, window]) => {
      if (isInWindow(orderDate, window)) {
        addMetric(periodTotals[key].current, amount);
        if (listingId) addMetric(ensureRestaurant(restaurantMap, listingId, listingName)[key], amount);
      }
      if (isInWindow(orderDate, window.previous)) {
        addMetric(periodTotals[key].previous, amount);
      }
    });
  });

  const [manualBillsSnap, bookingsSnap] = await Promise.all([
    firestore.collectionGroup('custom_bill_history')
      .where('printedAt', '>=', queryStart)
      .where('printedAt', '<=', queryEnd)
      .get()
      .catch((error) => {
        console.warn('[adminAnalyticsMetrics] custom_bill_history source split failed:', error?.message || error);
        return { docs: [] };
      }),
    firestore.collectionGroup('bookings')
      .where('createdAt', '>=', queryStart)
      .where('createdAt', '<=', queryEnd)
      .get()
      .catch((error) => {
        console.warn('[adminAnalyticsMetrics] bookings source split failed:', error?.message || error);
        return { docs: [] };
      }),
  ]);

  manualBillsSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const printedAt = timestampToDate(data.printedAt) || timestampToDate(data.createdAt);
    const amount = normalizeAmount(data);
    const businessId = getParentBusinessId(doc);

    if (isInWindow(printedAt, selectedWindow)) {
      addSourceMetric(sourceMetrics, 'manual', amount, 'current');
      if (businessId) {
        const restaurant = ensureRestaurant(restaurantMap, businessId);
        addMetric(restaurant.selected, amount);
        addSourceMetric(restaurant.sources, 'manual', amount, 'current');
      }
    }
    if (isInWindow(printedAt, selectedPrevious)) addSourceMetric(sourceMetrics, 'manual', amount, 'previous');
    if (isInWindow(printedAt, periodWindows.today) && businessId) {
      const restaurant = ensureRestaurant(restaurantMap, businessId);
      addMetric(restaurant.today, amount);
      addSourceMetric(restaurant.todaySources, 'manual', amount, 'current');
    }
  });

  bookingsSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const createdAt = timestampToDate(data.createdAt) || timestampToDate(data.bookingDateTime);
    const businessId = getParentBusinessId(doc);

    if (isInWindow(createdAt, selectedWindow)) {
      addSourceMetric(sourceMetrics, 'bookings', 0, 'current');
      if (businessId) {
        const restaurant = ensureRestaurant(restaurantMap, businessId);
        addMetric(restaurant.selected, 0);
        addSourceMetric(restaurant.sources, 'bookings', 0, 'current');
      }
    }
    if (isInWindow(createdAt, selectedPrevious)) addSourceMetric(sourceMetrics, 'bookings', 0, 'previous');
    if (isInWindow(createdAt, periodWindows.today) && businessId) {
      const restaurant = ensureRestaurant(restaurantMap, businessId);
      addMetric(restaurant.today, 0);
      addSourceMetric(restaurant.todaySources, 'bookings', 0, 'current');
    }
  });

  const periodSummary = Object.fromEntries(
    Object.entries(periodTotals).map(([key, value]) => {
      const current = finalizeMetric(value.current);
      const previous = finalizeMetric(value.previous);
      return [
        key,
        {
          key,
          label: value.label,
          range: value.range,
          previousRange: value.previousRange,
          current,
          previous,
          orderGrowth: growth(current.orderCount, previous.orderCount),
          revenueGrowth: growth(current.revenue, previous.revenue),
        },
      ];
    })
  );

  const topListingEntries = Array.from(rangeListings.entries())
    .sort((a, b) => (b[1].revenue || 0) - (a[1].revenue || 0))
    .slice(0, topLimit);

  const allRestaurantEntries = Array.from(restaurantMap.values())
    .sort((a, b) => (
      (b.today.orderCount - a.today.orderCount) ||
      (b.week.orderCount - a.week.orderCount) ||
      (b.year.revenue - a.year.revenue)
    ));
  const restaurantEntries = allRestaurantEntries.slice(0, restaurantLimit);

  const idsToResolve = [
    ...topListingEntries.map(([id]) => id),
    ...allRestaurantEntries.map((row) => row.id),
  ];
  const uniqueIds = [...new Set(idsToResolve.filter(Boolean))];
  const listingNames = await resolveListingNames(firestore, uniqueIds, fallbackNames);

  const topRestaurants = topListingEntries.map(([id, stats]) => {
    const current = finalizeMetric(stats);
    const previous = finalizeMetric(previousRangeListings.get(id) || emptyMetric());
    return {
      id,
      name: listingNames[id] || fallbackNames[id] || `Listing ${id.slice(0, 6)}`,
      ...current,
      previous,
      orderGrowth: growth(current.orderCount, previous.orderCount),
      revenueGrowth: growth(current.revenue, previous.revenue),
    };
  });

  const buildRestaurantBreakdownRow = (row) => {
    const today = finalizeMetric(row.today);
    const yesterday = finalizeMetric(row.yesterday);
    const sources = finalizeSourceMetrics(row.sources || createSourceMetrics());
    const todaySources = finalizeSourceMetrics(row.todaySources || createSourceMetrics());
    return {
      id: row.id,
      name: listingNames[row.id] || row.name || `Listing ${row.id.slice(0, 6)}`,
      today,
      yesterday,
      week: finalizeMetric(row.week),
      month: finalizeMetric(row.month),
      year: finalizeMetric(row.year),
      selected: finalizeMetric(row.selected),
      sources,
      todaySources,
      todayOrderGrowth: growth(today.orderCount, yesterday.orderCount),
      todayRevenueGrowth: growth(today.revenue, yesterday.revenue),
    };
  };

  const restaurantBreakdown = restaurantEntries.map(buildRestaurantBreakdownRow);
  const allRestaurantBreakdown = allRestaurantEntries.map(buildRestaurantBreakdownRow);

  const sourceRestaurantBreakdown = Object.values(ORDER_SOURCE_BUCKETS).map((source) => {
    const rows = allRestaurantBreakdown
      .map((restaurant) => {
        const selectedSource = restaurant.sources.find((entry) => entry.key === source.key);
        const todaySource = restaurant.todaySources.find((entry) => entry.key === source.key);
        return {
          id: restaurant.id,
          name: restaurant.name,
          selected: selectedSource?.current || finalizeMetric(emptyMetric()),
          today: todaySource?.current || finalizeMetric(emptyMetric()),
        };
      })
      .filter((row) => row.selected.orderCount > 0 || row.today.orderCount > 0 || row.selected.revenue > 0)
      .sort((a, b) => (b.selected.orderCount - a.selected.orderCount) || (b.selected.revenue - a.selected.revenue));

    return {
      key: source.key,
      label: source.label,
      description: source.description,
      rows,
    };
  });

  const revenueData = Array.from(daySeries.values()).map((row) => ({
    date: row.date,
    orders: row.orders,
    revenue: Math.round(row.revenue * 100) / 100,
  }));

  const topItems = Array.from(itemStats.entries())
    .sort((a, b) => (b[1].orders || 0) - (a[1].orders || 0))
    .slice(0, topLimit)
    .map(([name, stats]) => ({
      name,
      orders: stats.orders || 0,
    }));

  return {
    range: {
      start: selectedWindow.startKey,
      end: selectedWindow.endKey,
      previousStart: selectedPrevious.startKey,
      previousEnd: selectedPrevious.endKey,
    },
    totals: {
      orderCount: revenueData.reduce((sum, row) => sum + row.orders, 0),
      revenue: Math.round(revenueData.reduce((sum, row) => sum + row.revenue, 0) * 100) / 100,
    },
    periodSummary,
    revenueData,
    topRestaurants,
    topItems,
    restaurantBreakdown,
    sourceBreakdown: finalizeSourceMetrics(sourceMetrics),
    sourceRestaurantBreakdown,
    statusCounts,
  };
}

export {
  addDays,
  buildPeriodWindows,
  getAdminOrderAnalytics,
  istEndOfDay,
  istStartOfDay,
  parseAnalyticsRange,
  timestampToDate,
  toIstDayKey,
};
