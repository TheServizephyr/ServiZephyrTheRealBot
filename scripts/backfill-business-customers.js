/**
 * One-time Backfill: Build/refresh business customer profiles from historical orders.
 *
 * What it does:
 * - Reads orders collection in pages
 * - Aggregates customer stats per business:
 *   totalOrders, totalSpend, totalBillValue, bestDishes, dishStats, addresses, recentOrderIds
 * - Writes into:
 *   {restaurants|shops|street_vendors}/{businessId}/customers/{customerId}
 *
 * Usage:
 *   node -r dotenv/config scripts/backfill-business-customers.js dotenv_config_path=.env.local
 *
 * Optional env:
 *   DRY_RUN=true                     # Default: false
 *   LIMIT_ORDERS=5000                # Optional cap for testing
 *   BUSINESS_ID=your_business_doc_id # Optional targeted business
 *   BUSINESS_TYPE=restaurant|shop|street-vendor
 *
 * Auth resolution order:
 *   1) FIREBASE_SERVICE_ACCOUNT_JSON
 *   2) FIREBASE_SERVICE_ACCOUNT_BASE64
 *   3) ./servizephyr-firebase-adminsdk.json
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const ORDER_PAGE_SIZE = 500;
const WRITE_BATCH_SIZE = 350;
const MAX_DISH_STATS = 120;
const MAX_BEST_DISHES = 5;
const MAX_RECENT_ORDER_IDS = 20;
const MAX_ADDRESSES = 10;
const SKIP_STATUSES = new Set(['awaiting_payment', 'payment_failed']);

function readServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    }
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    }

    const localPath = path.join(process.cwd(), 'servizephyr-firebase-adminsdk.json');
    if (fs.existsSync(localPath)) {
        return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
    throw new Error('No Firebase service account found (env or local file).');
}

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function normalizePhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function mapBusinessTypeToCollection(businessType) {
    const type = String(businessType || '').toLowerCase();
    if (type === 'shop') return 'shops';
    if (type === 'street-vendor' || type === 'street_vendor') return 'street_vendors';
    return 'restaurants';
}

function extractCustomerId(orderData) {
    const userId = orderData.userId ? String(orderData.userId).trim() : '';
    if (userId) return userId;

    const customerId = orderData.customerId ? String(orderData.customerId).trim() : '';
    if (customerId) return customerId;

    const phone = normalizePhone(orderData.customerPhone || orderData.phone);
    if (phone) return `guest_phone_${phone}`;

    return '';
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeAddress(addressInput) {
    if (!addressInput) return null;

    if (typeof addressInput === 'string') {
        const full = addressInput.trim();
        return full ? { full } : null;
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

function getOrderFinancials(orderData) {
    const subtotal = toNumber(
        orderData.subtotal,
        toNumber(orderData.grandTotal, toNumber(orderData.totalAmount, toNumber(orderData.amount, 0)))
    );
    const total = toNumber(orderData.grandTotal, toNumber(orderData.totalAmount, toNumber(orderData.amount, subtotal)));
    return { subtotal: Math.max(0, subtotal), total: Math.max(0, total) };
}

function isSkippedOrder(orderData) {
    const status = String(orderData.status || '').toLowerCase();
    return SKIP_STATUSES.has(status);
}

function initAggregate(base) {
    return {
        businessCollection: base.businessCollection,
        businessId: base.businessId,
        customerId: base.customerId,
        name: base.name || 'Guest Customer',
        email: base.email || '',
        phone: base.phone || '',
        customerType: base.customerType || (String(base.customerId).startsWith('g_') ? 'guest' : 'uid'),
        status: base.status || (String(base.customerId).startsWith('g_') ? 'unclaimed' : 'verified'),
        totalOrders: 0,
        totalSpend: 0,
        totalBillValue: 0,
        firstOrderDate: null,
        lastOrderDate: null,
        recentOrders: [],
        dishStatsMap: new Map(),
        addressMap: new Map(),
    };
}

function updateDishStats(dishStatsMap, items, orderDate) {
    if (!Array.isArray(items)) return;
    const orderDateIso = orderDate ? orderDate.toISOString() : null;

    for (const item of items) {
        const dishName = String(item?.name || '').trim();
        if (!dishName) continue;

        const qty = Math.max(1, toNumber(item?.quantity ?? item?.qty, 1));
        const unitPrice = toNumber(item?.price, 0);
        const totalPrice = toNumber(item?.totalPrice, unitPrice * qty);
        const spend = totalPrice > 0 ? totalPrice : unitPrice * qty;

        const prev = dishStatsMap.get(dishName) || { count: 0, spend: 0, lastOrderedAt: null };
        dishStatsMap.set(dishName, {
            count: toNumber(prev.count, 0) + qty,
            spend: Number((toNumber(prev.spend, 0) + spend).toFixed(2)),
            lastOrderedAt: orderDateIso,
        });
    }
}

function updateAddresses(addressMap, addressObj, orderDate) {
    if (!addressObj || !addressObj.full) return;
    const key = String(addressObj.full).trim().toLowerCase();
    if (!key) return;

    const prev = addressMap.get(key) || { ...addressObj, orderCount: 0, lastUsedAt: null };
    addressMap.set(key, {
        ...prev,
        ...addressObj,
        orderCount: toNumber(prev.orderCount, 0) + 1,
        lastUsedAt: orderDate ? orderDate.toISOString() : prev.lastUsedAt,
    });
}

function finalizeDishStats(dishStatsMap) {
    const sorted = Array.from(dishStatsMap.entries())
        .sort((a, b) => {
            const cA = toNumber(a[1]?.count, 0);
            const cB = toNumber(b[1]?.count, 0);
            if (cB !== cA) return cB - cA;
            return toNumber(b[1]?.spend, 0) - toNumber(a[1]?.spend, 0);
        })
        .slice(0, MAX_DISH_STATS);

    const dishStats = {};
    for (const [name, stat] of sorted) {
        dishStats[name] = {
            count: toNumber(stat.count, 0),
            spend: Number(toNumber(stat.spend, 0).toFixed(2)),
            lastOrderedAt: stat.lastOrderedAt || null,
        };
    }

    const bestDishes = sorted.slice(0, MAX_BEST_DISHES).map(([name, stat]) => ({
        name,
        count: toNumber(stat.count, 0),
        spend: Number(toNumber(stat.spend, 0).toFixed(2)),
        lastOrderedAt: stat.lastOrderedAt || null,
    }));

    return { dishStats, bestDishes };
}

function finalizeAddresses(addressMap) {
    return Array.from(addressMap.values())
        .sort((a, b) => {
            const aDate = toDate(a.lastUsedAt);
            const bDate = toDate(b.lastUsedAt);
            if (!aDate && !bDate) return 0;
            if (!aDate) return 1;
            if (!bDate) return -1;
            return bDate.getTime() - aDate.getTime();
        })
        .slice(0, MAX_ADDRESSES);
}

async function fetchOrdersPaged(firestore, limitOrders) {
    const ordersRef = firestore.collection('orders');
    const allDocs = [];
    let lastDoc = null;

    while (true) {
        let query = ordersRef.orderBy(admin.firestore.FieldPath.documentId()).limit(ORDER_PAGE_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc.id);
        }

        const snap = await query.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            allDocs.push(doc);
            if (limitOrders > 0 && allDocs.length >= limitOrders) {
                return allDocs;
            }
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < ORDER_PAGE_SIZE) break;
    }

    return allDocs;
}

async function run() {
    const dryRun = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';
    const limitOrders = toNumber(process.env.LIMIT_ORDERS, 0);
    const targetBusinessId = String(process.env.BUSINESS_ID || '').trim();
    const targetBusinessType = String(process.env.BUSINESS_TYPE || '').trim();
    const targetCollection = targetBusinessType ? mapBusinessTypeToCollection(targetBusinessType) : '';

    const serviceAccount = readServiceAccount();
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
    });

    const firestore = admin.firestore();

    console.log('========================================');
    console.log('Historical Customer Backfill');
    console.log(`Project: ${projectId}`);
    console.log(`Dry Run: ${dryRun}`);
    if (limitOrders > 0) console.log(`Limit Orders: ${limitOrders}`);
    if (targetBusinessId) console.log(`Target Business ID: ${targetBusinessId}`);
    if (targetCollection) console.log(`Target Collection: ${targetCollection}`);
    console.log('========================================');

    const orderDocs = await fetchOrdersPaged(firestore, limitOrders);
    console.log(`Orders scanned: ${orderDocs.length}`);

    const aggregates = new Map();
    let skippedOrders = 0;

    for (const doc of orderDocs) {
        const data = doc.data() || {};
        if (isSkippedOrder(data)) {
            skippedOrders += 1;
            continue;
        }

        const businessId = String(data.restaurantId || '').trim();
        if (!businessId) {
            skippedOrders += 1;
            continue;
        }

        const businessCollection = mapBusinessTypeToCollection(data.businessType);
        if (targetBusinessId && businessId !== targetBusinessId) continue;
        if (targetCollection && businessCollection !== targetCollection) continue;

        const customerId = extractCustomerId(data);
        if (!customerId) {
            skippedOrders += 1;
            continue;
        }

        const key = `${businessCollection}|${businessId}|${customerId}`;
        const orderDate = toDate(data.orderDate) || new Date();
        const normalizedAddress = normalizeAddress(data.deliveryAddress || data.customerAddress || data.address || null);
        const phone = normalizePhone(data.customerPhone || data.phone || '');
        const { subtotal, total } = getOrderFinancials(data);

        const current = aggregates.get(key) || initAggregate({
            businessCollection,
            businessId,
            customerId,
            name: data.customerName || 'Guest Customer',
            email: (data.customerEmail || '').toString().toLowerCase(),
            phone,
            status: String(customerId).startsWith('g_') ? 'unclaimed' : 'verified',
            customerType: String(customerId).startsWith('g_') || String(customerId).startsWith('guest_') ? 'guest' : 'uid',
        });

        if ((!current.name || current.name === 'Guest Customer') && data.customerName) {
            current.name = String(data.customerName);
        }
        if (!current.email && data.customerEmail) {
            current.email = String(data.customerEmail).toLowerCase();
        }
        if (!current.phone && phone) {
            current.phone = phone;
        }

        current.totalOrders += 1;
        current.totalSpend = Number((current.totalSpend + subtotal).toFixed(2));
        current.totalBillValue = Number((current.totalBillValue + total).toFixed(2));

        if (!current.firstOrderDate || orderDate < current.firstOrderDate) {
            current.firstOrderDate = orderDate;
        }
        if (!current.lastOrderDate || orderDate > current.lastOrderDate) {
            current.lastOrderDate = orderDate;
        }

        current.recentOrders.push({ orderId: doc.id, orderDate });
        updateDishStats(current.dishStatsMap, data.items || [], orderDate);
        updateAddresses(current.addressMap, normalizedAddress, orderDate);

        aggregates.set(key, current);
    }

    console.log(`Aggregated customer profiles: ${aggregates.size}`);
    console.log(`Skipped orders: ${skippedOrders}`);

    const businessExistsCache = new Map();

    const entries = Array.from(aggregates.values());
    let writes = 0;
    let skippedMissingBusiness = 0;

    for (let i = 0; i < entries.length; i += WRITE_BATCH_SIZE) {
        const chunk = entries.slice(i, i + WRITE_BATCH_SIZE);

        if (dryRun) {
            writes += chunk.length;
            continue;
        }

        const batch = firestore.batch();

        for (const agg of chunk) {
            const businessKey = `${agg.businessCollection}|${agg.businessId}`;
            if (!businessExistsCache.has(businessKey)) {
                const businessSnap = await firestore.collection(agg.businessCollection).doc(agg.businessId).get();
                businessExistsCache.set(businessKey, businessSnap.exists);
            }

            if (!businessExistsCache.get(businessKey)) {
                skippedMissingBusiness += 1;
                continue;
            }

            const customerRef = firestore
                .collection(agg.businessCollection)
                .doc(agg.businessId)
                .collection('customers')
                .doc(agg.customerId);

            const { dishStats, bestDishes } = finalizeDishStats(agg.dishStatsMap);
            const addresses = finalizeAddresses(agg.addressMap);
            const recentOrderIds = agg.recentOrders
                .sort((a, b) => b.orderDate.getTime() - a.orderDate.getTime())
                .slice(0, MAX_RECENT_ORDER_IDS)
                .map((entry) => entry.orderId);

            const payload = {
                customerId: agg.customerId,
                name: agg.name || 'Guest Customer',
                ...(agg.email ? { email: agg.email } : {}),
                ...(agg.phone ? { phone: agg.phone } : {}),
                status: agg.status || 'verified',
                customerType: agg.customerType || 'uid',
                totalOrders: agg.totalOrders,
                totalSpend: Number(agg.totalSpend.toFixed(2)),
                totalBillValue: Number(agg.totalBillValue.toFixed(2)),
                firstOrderDate: agg.firstOrderDate ? admin.firestore.Timestamp.fromDate(agg.firstOrderDate) : null,
                lastOrderDate: agg.lastOrderDate ? admin.firestore.Timestamp.fromDate(agg.lastOrderDate) : null,
                lastActivityAt: agg.lastOrderDate ? admin.firestore.Timestamp.fromDate(agg.lastOrderDate) : null,
                lastOrderId: recentOrderIds[0] || null,
                recentOrderIds,
                addresses,
                dishStats,
                bestDishes,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                backfillVersion: 1,
                backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            if (agg.firstOrderDate) {
                payload.joinedAt = admin.firestore.Timestamp.fromDate(agg.firstOrderDate);
            }

            batch.set(customerRef, payload, { merge: true });
            writes += 1;
        }

        await batch.commit();
        console.log(`Committed chunk: ${Math.min(i + chunk.length, entries.length)}/${entries.length}`);
    }

    console.log('========================================');
    console.log(`Dry run: ${dryRun}`);
    console.log(`Profiles processed: ${entries.length}`);
    console.log(`Profiles written: ${writes}`);
    console.log(`Skipped (missing business): ${skippedMissingBusiness}`);
    console.log('========================================');
}

run().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
