import { FieldValue } from '@/lib/firebase-admin';

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value?.toDate === 'function') {
        const parsed = value.toDate();
        return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value) {
    const parsed = toDate(value);
    return parsed ? parsed.toISOString() : null;
}

function pickTimestamp(data, fields = []) {
    for (const field of fields) {
        const parsed = toDate(data?.[field]);
        if (parsed) return parsed;
    }
    return null;
}

function normalizePhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function buildAddressObject(addressInput) {
    if (!addressInput) return null;

    if (typeof addressInput === 'string') {
        const trimmed = addressInput.trim();
        return trimmed ? { full: trimmed } : null;
    }

    if (typeof addressInput !== 'object') return null;

    const full =
        addressInput.full ||
        addressInput.address ||
        [addressInput.houseNumber, addressInput.street, addressInput.city, addressInput.state, addressInput.postalCode]
            .filter(Boolean)
            .join(', ');

    const lat = toNumber(addressInput.latitude ?? addressInput.lat, null);
    const lng = toNumber(addressInput.longitude ?? addressInput.lng, null);

    if (!full && lat === null && lng === null) return null;

    return {
        full: full || '',
        ...(lat !== null ? { latitude: lat } : {}),
        ...(lng !== null ? { longitude: lng } : {}),
        ...(addressInput.label ? { label: addressInput.label } : {}),
    };
}

function mergeAddresses(existing, incoming) {
    const safeExisting = Array.isArray(existing) ? existing : [];
    if (!incoming) return safeExisting.slice(0, 10);

    const key = String(incoming.full || '').trim().toLowerCase();
    if (!key) return safeExisting.slice(0, 10);

    const deduped = safeExisting.filter((addr) => String(addr?.full || '').trim().toLowerCase() !== key);
    return [incoming, ...deduped].slice(0, 10);
}

function updateDishStats(existingStats, items, nowIso) {
    const stats = (existingStats && typeof existingStats === 'object') ? { ...existingStats } : {};
    const safeItems = Array.isArray(items) ? items : [];

    for (const item of safeItems) {
        const dishName = String(item?.name || '').trim();
        if (!dishName) continue;

        const quantity = Math.max(1, toNumber(item?.quantity ?? item?.qty, 1));
        const itemPrice = toNumber(item?.price, 0);
        const itemTotal = toNumber(item?.totalPrice, itemPrice * quantity);
        const spend = itemTotal > 0 ? itemTotal : itemPrice * quantity;

        const prev = stats[dishName] || { count: 0, spend: 0, lastOrderedAt: null };
        stats[dishName] = {
            count: toNumber(prev.count, 0) + quantity,
            spend: Number((toNumber(prev.spend, 0) + spend).toFixed(2)),
            lastOrderedAt: nowIso,
        };
    }

    const entries = Object.entries(stats);
    if (entries.length > 120) {
        entries.sort((a, b) => {
            const c1 = toNumber(a[1]?.count, 0);
            const c2 = toNumber(b[1]?.count, 0);
            if (c2 !== c1) return c2 - c1;
            return toNumber(b[1]?.spend, 0) - toNumber(a[1]?.spend, 0);
        });
        const trimmed = entries.slice(0, 120);
        return Object.fromEntries(trimmed);
    }

    return stats;
}

function computeBestDishes(dishStats) {
    const entries = Object.entries(dishStats || {});
    entries.sort((a, b) => {
        const aCount = toNumber(a[1]?.count, 0);
        const bCount = toNumber(b[1]?.count, 0);
        if (bCount !== aCount) return bCount - aCount;
        return toNumber(b[1]?.spend, 0) - toNumber(a[1]?.spend, 0);
    });

    return entries.slice(0, 5).map(([name, data]) => ({
        name,
        count: toNumber(data?.count, 0),
        spend: Number(toNumber(data?.spend, 0).toFixed(2)),
        lastOrderedAt: data?.lastOrderedAt || null,
    }));
}

export const COUNTABLE_CUSTOMER_ORDER_STATUSES = new Set([
    'completed',
    'delivered',
    'paid',
    'picked_up',
    'served',
]);

function isCountableCustomerOrderStatus(status) {
    return COUNTABLE_CUSTOMER_ORDER_STATUSES.has(String(status || '').trim().toLowerCase());
}

function normalizeOnlineOrderEntry(doc) {
    const data = doc.data() || {};
    const orderDate = pickTimestamp(data, ['orderDate', 'deliveredAt', 'completedAt', 'updatedAt', 'createdAt']);

    return {
        id: doc.id,
        source: 'order',
        status: String(data.status || '').trim().toLowerCase(),
        orderDate: orderDate ? orderDate.toISOString() : null,
        subtotal: Math.max(0, toNumber(data.subtotal, 0)),
        totalAmount: Math.max(0, toNumber(data.totalAmount ?? data.grandTotal, 0)),
        customerAddress: data.customerAddress || data?.customer?.address?.full || data?.customer?.address || null,
        items: Array.isArray(data.items) ? data.items : [],
    };
}

function mergeCustomerProfileMetadata(existing = {}, incoming = {}) {
    return {
        customerId: String(incoming.customerDocId || existing.customerId || ''),
        name: incoming.customerName || existing.name || 'Guest Customer',
        email: incoming.customerEmail
            ? String(incoming.customerEmail).trim().toLowerCase()
            : (existing.email || ''),
        phone: incoming.customerPhone ? normalizePhone(incoming.customerPhone) : normalizePhone(existing.phone || ''),
        status: incoming.customerStatus || existing.status || 'verified',
        customerType: incoming.customerType || existing.customerType || (String(incoming.customerDocId || '').startsWith('g_') ? 'guest' : 'uid'),
        addresses: mergeAddresses(existing.addresses, buildAddressObject(incoming.customerAddress)),
    };
}

async function loadProfileOrders({ firestore, businessId, customerDocId }) {
    const orderMap = new Map();
    const [userOrders, customerOrders] = await Promise.all([
        firestore.collection('orders').where('userId', '==', String(customerDocId)).get().catch(() => null),
        firestore.collection('orders').where('customerId', '==', String(customerDocId)).get().catch(() => null),
    ]);

    [userOrders, customerOrders].forEach((snapshot) => {
        snapshot?.forEach((doc) => {
            const data = doc.data() || {};
            if (String(data.restaurantId || '').trim() !== String(businessId || '').trim()) return;
            const normalized = normalizeOnlineOrderEntry(doc);
            if (!isCountableCustomerOrderStatus(normalized.status)) return;
            orderMap.set(`order:${doc.id}`, normalized);
        });
    });

    return Array.from(orderMap.values());
}

function buildAggregatedDishStats(orderEntries = []) {
    let dishStats = {};
    for (const entry of orderEntries) {
        dishStats = updateDishStats(dishStats, entry.items, entry.orderDate || new Date().toISOString());
    }
    return dishStats;
}

export async function rebuildBusinessCustomerProfile({
    firestore,
    businessCollection,
    businessId,
    customerDocId,
    customerName = '',
    customerEmail = '',
    customerPhone = '',
    customerAddress = null,
    customerStatus = 'verified',
    customerType = null,
} = {}) {
    if (!firestore || !businessCollection || !businessId || !customerDocId) return;

    const businessRef = firestore.collection(String(businessCollection)).doc(String(businessId));
    const customerRef = businessRef.collection('customers').doc(String(customerDocId));

    const [customerSnap, onlineOrders] = await Promise.all([
        customerRef.get(),
        loadProfileOrders({ firestore, businessId, customerDocId }),
    ]);

    const current = customerSnap.exists ? (customerSnap.data() || {}) : {};
    const metadata = mergeCustomerProfileMetadata(current, {
        customerDocId,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        customerStatus,
        customerType,
    });

    const aggregatedOrders = [...onlineOrders]
        .sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime());

    const dishStats = buildAggregatedDishStats(aggregatedOrders);
    const bestDishes = computeBestDishes(dishStats);
    const recentOrderIds = aggregatedOrders.map((entry) => entry.id).slice(0, 20);
    const latestOrder = aggregatedOrders[0] || null;
    const oldestOrder = aggregatedOrders[aggregatedOrders.length - 1] || null;

    const aggregatedAddresses = mergeAddresses(
        metadata.addresses,
        ...aggregatedOrders.map((entry) => buildAddressObject(entry.customerAddress))
    );

    const totalOrders = aggregatedOrders.length;
    const totalSpend = Number(aggregatedOrders.reduce((sum, entry) => sum + Math.max(0, toNumber(entry.subtotal, 0)), 0).toFixed(2));
    const totalBillValue = Number(aggregatedOrders.reduce((sum, entry) => sum + Math.max(0, toNumber(entry.totalAmount, 0)), 0).toFixed(2));
    const latestOrderDate = toDate(latestOrder?.orderDate);
    const oldestOrderDate = toDate(oldestOrder?.orderDate);

    const payload = {
        customerId: metadata.customerId,
        name: metadata.name,
        status: metadata.status,
        customerType: metadata.customerType,
        totalOrders,
        totalSpend,
        totalBillValue,
        lastOrderDate: latestOrderDate || null,
        lastActivityAt: latestOrderDate || null,
        lastOrderId: latestOrder?.id || null,
        dishStats,
        bestDishes,
        addresses: aggregatedAddresses,
        recentOrderIds,
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (metadata.email) payload.email = metadata.email;
    if (metadata.phone) payload.phone = metadata.phone;

    if (!customerSnap.exists) {
        payload.createdAt = FieldValue.serverTimestamp();
        payload.joinedAt = oldestOrderDate || FieldValue.serverTimestamp();
        if (latestOrderDate) {
            payload.firstOrderDate = oldestOrderDate || latestOrderDate;
        }
    } else if (!current.joinedAt && oldestOrderDate) {
        payload.joinedAt = oldestOrderDate;
    }

    await customerRef.set(payload, { merge: true });
}

/**
 * Upserts customer profile inside:
 * `{businessCollection}/{businessId}/customers/{customerDocId}`
 *
 * Keeps one profile per customer and increments aggregate stats per order.
 */
export async function upsertBusinessCustomerProfile({
    firestore,
    businessCollection,
    businessId,
    customerDocId,
    customerName,
    customerEmail = '',
    customerPhone = '',
    customerAddress = null,
    customerStatus = 'verified',
    orderId = null,
    customerType = null,
}) {
    if (!firestore || !businessCollection || !businessId || !customerDocId) return;

    const customerRef = firestore
        .collection(businessCollection)
        .doc(String(businessId))
        .collection('customers')
        .doc(String(customerDocId));

    const safePhone = normalizePhone(customerPhone);
    const normalizedAddress = buildAddressObject(customerAddress);

    await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(customerRef);
        const current = snap.exists ? (snap.data() || {}) : {};
        const addresses = mergeAddresses(current.addresses, normalizedAddress);

        const recentOrderIds = Array.isArray(current.recentOrderIds) ? [...current.recentOrderIds] : [];
        if (orderId) {
            const oid = String(orderId);
            if (!recentOrderIds.includes(oid)) {
                recentOrderIds.unshift(oid);
            }
        }

        const payload = {
            customerId: String(customerDocId),
            name: customerName || current.name || 'Guest Customer',
            ...(customerEmail ? { email: String(customerEmail).trim().toLowerCase() } : {}),
            ...(safePhone ? { phone: safePhone } : {}),
            status: customerStatus || current.status || 'verified',
            customerType: customerType || current.customerType || (String(customerDocId).startsWith('g_') ? 'guest' : 'uid'),
            lastActivityAt: FieldValue.serverTimestamp(),
            ...(orderId ? { lastOrderId: String(orderId) } : {}),
            addresses,
            recentOrderIds: recentOrderIds.slice(0, 20),
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (!snap.exists) {
            payload.createdAt = FieldValue.serverTimestamp();
            payload.joinedAt = FieldValue.serverTimestamp();
            payload.totalOrders = 0;
            payload.totalSpend = 0;
            payload.totalBillValue = 0;
            payload.dishStats = {};
            payload.bestDishes = [];
        }

        tx.set(customerRef, payload, { merge: true });
    });
}
