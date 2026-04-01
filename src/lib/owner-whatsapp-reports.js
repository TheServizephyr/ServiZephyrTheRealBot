import { getAdminSystemConfig, sendAdminSystemMessage } from '@/lib/admin-system';

const LOST_ORDER_STATUSES = new Set(['rejected', 'cancelled', 'failed_delivery', 'returned_to_restaurant']);
const REPORT_KEYS = {
    TODAY_SALES: 'today_sales',
    LAST_7_DAYS_SALES: 'last_7_days_sales',
    UNSETTLED_BILLS: 'unsettled_bills',
    TODAY_ANALYTICS: 'today_analytics',
    LAST_7_DAYS_ANALYTICS: 'last_7_days_analytics',
    MONTHLY_SALES: 'monthly_sales',
    CANCELLED_BILLS: 'cancelled_bills',
};

const REPORT_MENU = [
    { number: '1', key: REPORT_KEYS.TODAY_SALES, label: "Today's Sales" },
    { number: '2', key: REPORT_KEYS.LAST_7_DAYS_SALES, label: 'Last 7 Days Sales' },
    { number: '3', key: REPORT_KEYS.UNSETTLED_BILLS, label: 'Unsettled Bills' },
    { number: '4', key: REPORT_KEYS.TODAY_ANALYTICS, label: "Today's Analytics" },
    { number: '5', key: REPORT_KEYS.LAST_7_DAYS_ANALYTICS, label: 'Last 7 Days Analytics' },
    { number: '6', key: REPORT_KEYS.MONTHLY_SALES, label: 'Monthly Sales' },
    { number: '7', key: REPORT_KEYS.CANCELLED_BILLS, label: 'Cancelled Bills (This Month)' },
];

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const formatCurrency = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const toAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const timestampToDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value?.toDate === 'function') {
        const converted = value.toDate();
        return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeServiceMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'delivery') return 'delivery';
    if (normalized === 'pickup' || normalized === 'takeaway') return 'pickup';
    if (normalized === 'dine-in' || normalized === 'dine_in') return 'dine-in';
    return 'counter';
};

const isCancelledManualBill = (bill = {}) => String(bill.status || '').trim().toLowerCase() === 'cancelled';
const isSettlementEligible = (printedVia) => String(printedVia || '').trim().toLowerCase() !== 'create_order';
const isLostOrder = (status) => LOST_ORDER_STATUSES.has(String(status || '').trim().toLowerCase());
const isManualCallOrder = (order = {}) =>
    order?.isManualCallOrder === true || String(order?.orderSource || '').trim().toLowerCase() === 'manual_call';

const getDayRange = () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const getLastNDaysRange = (days) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    return { start, end };
};

const getCurrentMonthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const formatShortDate = (value) => {
    const date = timestampToDate(value);
    if (!date) return 'NA';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const incrementItemCount = (bucket, items = []) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
        const name = String(item?.name || 'Item').split(' (')[0].trim();
        if (!name) return;
        bucket.set(name, (bucket.get(name) || 0) + Math.max(1, Number(item?.quantity || 1)));
    });
};

const buildReportMenuText = (businessName) => [
    `Owner Reports for *${businessName || 'your outlet'}*`,
    '',
    'Reply with any number:',
    ...REPORT_MENU.map((option) => `${option.number}. ${option.label}`),
    '',
    "You can also send text like 'today sales' or 'unsettled bills'.",
].join('\n');

const parseReportCommand = (rawText = '') => {
    const text = String(rawText || '').trim().toLowerCase();
    if (!text) return null;

    if (['reports', 'report', 'menu', 'analytics', 'sales'].includes(text)) return 'menu';
    if (text === '1' || text.includes('today sale')) return REPORT_KEYS.TODAY_SALES;
    if (text === '2' || text.includes('7 day sale') || text.includes('last 7 day sale') || text.includes('weekly sale')) return REPORT_KEYS.LAST_7_DAYS_SALES;
    if (text === '3' || text.includes('unsettled') || text.includes('pending settlement')) return REPORT_KEYS.UNSETTLED_BILLS;
    if (text === '4' || text.includes('today analytics')) return REPORT_KEYS.TODAY_ANALYTICS;
    if (text === '5' || text.includes('7 day analytics') || text.includes('last 7 day analytics') || text.includes('weekly analytics')) return REPORT_KEYS.LAST_7_DAYS_ANALYTICS;
    if (text === '6' || text.includes('monthly sale') || text.includes('month sale') || text.includes('this month sale')) return REPORT_KEYS.MONTHLY_SALES;
    if (text === '7' || text.includes('cancelled bill') || text.includes('canceled bill')) return REPORT_KEYS.CANCELLED_BILLS;
    return null;
};

async function resolveOwnerBusinesses(firestore, normalizedPhone) {
    if (!normalizedPhone) return [];
    const candidates = [normalizedPhone, `91${normalizedPhone}`, `+91${normalizedPhone}`];
    const collections = ['restaurants', 'shops', 'street_vendors'];
    const fieldNames = ['ownerPersonalWhatsappNumber', 'ownerPhone'];
    const results = new Map();

    for (const collectionName of collections) {
        for (const fieldName of fieldNames) {
            for (const candidate of candidates) {
                try {
                    const snap = await firestore.collection(collectionName).where(fieldName, '==', candidate).limit(5).get();
                    snap.forEach((doc) => {
                        results.set(`${collectionName}:${doc.id}`, {
                            id: doc.id,
                            ref: doc.ref,
                            collectionName,
                            data: doc.data() || {},
                        });
                    });
                } catch (error) {
                    console.warn('[Owner WA Reports] Business lookup failed:', collectionName, fieldName, candidate, error?.message || error);
                }
            }
        }
    }

    return Array.from(results.values());
}

async function loadPeriodMetrics({ firestore, business, start, end }) {
    const ordersRef = firestore.collection('orders').where('restaurantId', '==', business.id);
    const billsRef = business.ref.collection('custom_bill_history');

    const [ordersSnap, billsSnap] = await Promise.all([
        ordersRef
            .where('orderDate', '>=', start)
            .where('orderDate', '<=', end)
            .select('status', 'totalAmount', 'items', 'deliveryType', 'orderType', 'isManualCallOrder', 'orderSource')
            .get(),
        billsRef
            .where('printedAt', '>=', start)
            .where('printedAt', '<=', end)
            .select('status', 'totalAmount', 'grandTotal', 'items', 'orderType')
            .get(),
    ]);

    const topItemCounts = new Map();
    const serviceModes = {
        delivery: { count: 0, revenue: 0 },
        pickup: { count: 0, revenue: 0 },
        'dine-in': { count: 0, revenue: 0 },
        counter: { count: 0, revenue: 0 },
    };

    let completedRevenue = 0;
    let completedOrders = 0;
    let cancelledRevenue = 0;
    let cancelledOrders = 0;
    let manualCallOrders = 0;

    ordersSnap.forEach((doc) => {
        const data = doc.data() || {};
        const amount = toAmount(data.totalAmount);
        if (isLostOrder(data.status)) {
            cancelledOrders += 1;
            cancelledRevenue += amount;
            return;
        }
        completedOrders += 1;
        completedRevenue += amount;
        incrementItemCount(topItemCounts, data.items);

        const manualCall = isManualCallOrder(data);
        const mode = normalizeServiceMode(data?.deliveryType || data?.orderType);
        if (manualCall && mode === 'delivery') manualCallOrders += 1;
        if (serviceModes[mode]) {
            serviceModes[mode].count += 1;
            serviceModes[mode].revenue += amount;
        }
    });

    billsSnap.forEach((doc) => {
        const data = doc.data() || {};
        const amount = toAmount(data.totalAmount || data.grandTotal);
        if (isCancelledManualBill(data)) {
            cancelledOrders += 1;
            cancelledRevenue += amount;
            return;
        }
        completedOrders += 1;
        completedRevenue += amount;
        incrementItemCount(topItemCounts, data.items);

        const mode = normalizeServiceMode(data?.orderType);
        if (serviceModes[mode]) {
            serviceModes[mode].count += 1;
            serviceModes[mode].revenue += amount;
        }
        if (mode === 'delivery') manualCallOrders += 1;
    });

    const topItems = Array.from(topItemCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, quantity]) => ({ name, quantity }));

    return {
        completedRevenue,
        completedOrders,
        cancelledRevenue,
        cancelledOrders,
        avgOrderValue: completedOrders > 0 ? completedRevenue / completedOrders : 0,
        manualCallOrders,
        serviceModes,
        topItems,
    };
}

async function loadUnsettledBills({ business }) {
    const historyRef = business.ref.collection('custom_bill_history');
    let snapshot;
    try {
        snapshot = await historyRef.where('isSettled', '==', false).orderBy('printedAt', 'desc').limit(500).get();
    } catch (error) {
        snapshot = await historyRef.orderBy('printedAt', 'desc').limit(500).get();
    }

    let unsettledCount = 0;
    let unsettledAmount = 0;
    const recentBills = [];

    snapshot.forEach((doc) => {
        const data = doc.data() || {};
        if (isCancelledManualBill(data)) return;
        if (!isSettlementEligible(data.printedVia || data.source || 'browser')) return;
        if (data.isSettled) return;

        const amount = toAmount(data.totalAmount || data.grandTotal);
        unsettledCount += 1;
        unsettledAmount += amount;
        if (recentBills.length < 5) {
            recentBills.push({
                historyId: data.historyId || doc.id,
                amount,
                orderType: normalizeServiceMode(data.orderType),
                printedAt: timestampToDate(data.printedAt) || timestampToDate(data.createdAt),
            });
        }
    });

    return { unsettledCount, unsettledAmount, recentBills };
}

const formatModeLine = (label, entry) => `${label}: ${entry.count} order(s), ${formatCurrency(entry.revenue)}`;

function buildSalesReportText({ title, businessName, metrics }) {
    return [
        `*${title}*`,
        businessName,
        '',
        `Sales: ${formatCurrency(metrics.completedRevenue)}`,
        `Orders: ${metrics.completedOrders}`,
        `Average Order Value: ${formatCurrency(metrics.avgOrderValue)}`,
        '',
        formatModeLine('Delivery', metrics.serviceModes.delivery),
        formatModeLine('Pickup', metrics.serviceModes.pickup),
        formatModeLine('Dine-In', metrics.serviceModes['dine-in']),
        formatModeLine('Counter', metrics.serviceModes.counter),
        '',
        `Manual Call Orders: ${metrics.manualCallOrders}`,
    ].join('\n');
}

function buildAnalyticsReportText({ title, businessName, metrics }) {
    const topItemsLine = metrics.topItems.length
        ? metrics.topItems.map((item, index) => `${index + 1}. ${item.name} (${item.quantity})`).join('\n')
        : 'No top items yet.';

    return [
        `*${title}*`,
        businessName,
        '',
        `Sales: ${formatCurrency(metrics.completedRevenue)}`,
        `Orders: ${metrics.completedOrders}`,
        `Average Order Value: ${formatCurrency(metrics.avgOrderValue)}`,
        `Cancelled Bills/Orders: ${metrics.cancelledOrders}`,
        `Cancelled Value: ${formatCurrency(metrics.cancelledRevenue)}`,
        '',
        'Top Items:',
        topItemsLine,
        '',
        'Mode Breakdown:',
        formatModeLine('Delivery', metrics.serviceModes.delivery),
        formatModeLine('Pickup', metrics.serviceModes.pickup),
        formatModeLine('Dine-In', metrics.serviceModes['dine-in']),
        formatModeLine('Counter', metrics.serviceModes.counter),
    ].join('\n');
}

function buildUnsettledReportText({ businessName, summary }) {
    const recentLines = summary.recentBills.length
        ? summary.recentBills
            .map((bill, index) => `${index + 1}. ${bill.historyId} | ${bill.orderType} | ${formatCurrency(bill.amount)} | ${formatShortDate(bill.printedAt)}`)
            .join('\n')
        : 'No unsettled bills right now.';

    return [
        '*Unsettled Bills*',
        businessName,
        '',
        `Pending Bills: ${summary.unsettledCount}`,
        `Pending Amount: ${formatCurrency(summary.unsettledAmount)}`,
        '',
        'Recent Pending Bills:',
        recentLines,
    ].join('\n');
}

function buildCancelledReportText({ businessName, metrics }) {
    return [
        '*Cancelled Bills (This Month)*',
        businessName,
        '',
        `Cancelled Count: ${metrics.cancelledOrders}`,
        `Cancelled Value: ${formatCurrency(metrics.cancelledRevenue)}`,
        '',
        `Net Sales after cancellations: ${formatCurrency(metrics.completedRevenue)}`,
    ].join('\n');
}

async function buildReportText({ firestore, business, reportKey }) {
    const businessName = String(business.data?.name || business.id || 'Outlet').trim();

    switch (reportKey) {
        case REPORT_KEYS.TODAY_SALES: {
            const metrics = await loadPeriodMetrics({ firestore, business, ...getDayRange() });
            return buildSalesReportText({ title: "Today's Sales", businessName, metrics });
        }
        case REPORT_KEYS.LAST_7_DAYS_SALES: {
            const metrics = await loadPeriodMetrics({ firestore, business, ...getLastNDaysRange(7) });
            return buildSalesReportText({ title: 'Last 7 Days Sales', businessName, metrics });
        }
        case REPORT_KEYS.UNSETTLED_BILLS: {
            const summary = await loadUnsettledBills({ business });
            return buildUnsettledReportText({ businessName, summary });
        }
        case REPORT_KEYS.TODAY_ANALYTICS: {
            const metrics = await loadPeriodMetrics({ firestore, business, ...getDayRange() });
            return buildAnalyticsReportText({ title: "Today's Analytics", businessName, metrics });
        }
        case REPORT_KEYS.LAST_7_DAYS_ANALYTICS: {
            const metrics = await loadPeriodMetrics({ firestore, business, ...getLastNDaysRange(7) });
            return buildAnalyticsReportText({ title: 'Last 7 Days Analytics', businessName, metrics });
        }
        case REPORT_KEYS.MONTHLY_SALES: {
            const metrics = await loadPeriodMetrics({ firestore, business, ...getCurrentMonthRange() });
            return buildSalesReportText({ title: 'Monthly Sales', businessName, metrics });
        }
        case REPORT_KEYS.CANCELLED_BILLS: {
            const metrics = await loadPeriodMetrics({ firestore, business, ...getCurrentMonthRange() });
            return buildCancelledReportText({ businessName, metrics });
        }
        default:
            return buildReportMenuText(businessName);
    }
}

export async function handleAdminOwnerReportMessage({ firestore, fromNumber, messageText, customerName = '' }) {
    const adminConfig = await getAdminSystemConfig(firestore);
    const normalizedPhone = normalizePhone(fromNumber);
    if (!adminConfig.botPhoneNumberId || !normalizedPhone) {
        return { handled: false };
    }

    const parsedCommand = parseReportCommand(messageText);

    const businesses = await resolveOwnerBusinesses(firestore, normalizedPhone);
    if (businesses.length === 0) {
        if (!parsedCommand) {
            return { handled: false };
        }
        await sendAdminSystemMessage({
            phoneNumber: normalizedPhone,
            customerName,
            preview: 'Owner report access denied',
            metadata: { type: 'owner_report_denied' },
            messageText: [
                '*Owner Reports*',
                '',
                'Your WhatsApp number is not linked to any outlet owner profile yet.',
                'Please add your personal WhatsApp number in outlet settings first.',
            ].join('\n'),
        });
        return { handled: true };
    }

    if (businesses.length > 1) {
        await sendAdminSystemMessage({
            phoneNumber: normalizedPhone,
            customerName,
            preview: 'Multiple owner outlets found',
            metadata: { type: 'owner_report_multi_outlet' },
            messageText: [
                '*Owner Reports*',
                '',
                'Your number is linked to multiple outlets.',
                'Multi-outlet report selection will be added next.',
                'For now, please use a dedicated owner WhatsApp number per outlet.',
            ].join('\n'),
        });
        return { handled: true };
    }

    const business = businesses[0];
    const reportCommand = parsedCommand || 'menu';
    if (reportCommand === 'menu') {
        await sendAdminSystemMessage({
            phoneNumber: normalizedPhone,
            customerName,
            preview: 'Owner reports menu',
            metadata: { type: 'owner_report_menu', businessId: business.id, collectionName: business.collectionName },
            messageText: buildReportMenuText(String(business.data?.name || business.id || 'Outlet').trim()),
        });
        return { handled: true };
    }

    const reportText = await buildReportText({ firestore, business, reportKey: reportCommand });
    await sendAdminSystemMessage({
        phoneNumber: normalizedPhone,
        customerName,
        preview: reportCommand,
        metadata: {
            type: 'owner_report_response',
            reportKey: reportCommand,
            businessId: business.id,
            collectionName: business.collectionName,
        },
        messageText: reportText,
    });
    return { handled: true };
}
