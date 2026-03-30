

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

function normalizeBusinessType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street_vendor' || normalized === 'street-vendor') return 'street-vendor';
    return 'restaurant';
}

const LOST_ORDER_STATUSES = new Set(['rejected', 'cancelled', 'failed_delivery', 'returned_to_restaurant']);

const toAmount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const timestampToDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value?.toDate === 'function') {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getRangeDays = (filter, now = new Date()) => {
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
};

const getPreviousRange = (start, end) => {
    const duration = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - duration);
    return { prevStart, prevEnd };
};

const calcChange = (current, previous) => {
    if (!Number.isFinite(previous) || previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
};

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        // Verify employee has access to this owner's data
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }

        console.log(`[API Employee Access] ${uid} accessing ${employeeOfOwnerId}'s dashboard data`);
        targetOwnerId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { uid: targetOwnerId, businessId: doc.id, collectionName: collectionName, isAdmin: userRole === 'admin' };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const url = new URL(req.url);
        const filter = url.searchParams.get('filter') || 'Today';
        const businessRef = firestore.collection(collectionName).doc(businessId);
        const ordersRef = firestore.collection('orders').where('restaurantId', '==', businessId);
        const customersRef = businessRef.collection('customers');
        const customBillHistoryRef = businessRef.collection('custom_bill_history');

        const { start, end } = getRangeDays(filter, new Date());
        const { prevStart, prevEnd } = getPreviousRange(start, end);

        const [
            currentOrdersSnap,
            prevOrdersSnap,
            currentManualSnap,
            prevManualSnap,
            customersSnap,
            liveOrdersSnap,
            chartOrdersSnap,
            chartManualSnap,
            menuSnap,
            businessSnap,
            todayRejectedSnap,
        ] = await Promise.all([
            ordersRef.where('orderDate', '>=', start).where('orderDate', '<=', end).get(),
            ordersRef.where('orderDate', '>=', prevStart).where('orderDate', '<=', prevEnd).get(),
            customBillHistoryRef.where('printedAt', '>=', start).where('printedAt', '<=', end).get(),
            customBillHistoryRef.where('printedAt', '>=', prevStart).where('printedAt', '<=', prevEnd).get(),
            customersRef.get(),
            ordersRef.where('status', 'in', ['pending', 'confirmed']).orderBy('orderDate', 'desc').limit(6).get(),
            ordersRef.where('orderDate', '>=', start).where('orderDate', '<=', end).get(),
            customBillHistoryRef.where('printedAt', '>=', start).where('printedAt', '<=', end).get(),
            businessRef.collection('menu').get(),
            businessRef.get(),
            ordersRef.where('orderDate', '>=', getRangeDays('Today', new Date()).start).where('orderDate', '<=', getRangeDays('Today', new Date()).end).get(),
        ]);

        const resolvedBusinessType = normalizeBusinessType(businessSnap.data()?.businessType || collectionName.slice(0, -1));

        const acceptedCurrentOrders = currentOrdersSnap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((order) => !LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase()));
        const acceptedPrevOrders = prevOrdersSnap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((order) => !LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase()));

        const currentManualBills = currentManualSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const prevManualBills = prevManualSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

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
            return joinedAt && joinedAt >= start && joinedAt <= end;
        }).length;
        const newCustomersPrevious = customers.filter((customer) => {
            const joinedAt = timestampToDate(customer.joinedAt);
            return joinedAt && joinedAt >= prevStart && joinedAt <= prevEnd;
        }).length;

        const todayRejections = todayRejectedSnap.docs.filter((doc) =>
            LOST_ORDER_STATUSES.has(String(doc.data()?.status || '').toLowerCase())
        ).length;

        const stats = {
            sales: totalSales,
            salesChange: Number(calcChange(totalSales, prevTotalSales).toFixed(1)),
            orders: totalOrders,
            ordersChange: Number(calcChange(totalOrders, prevTotalOrders).toFixed(1)),
            newCustomers: newCustomersCurrent,
            newCustomersChange: Number(calcChange(newCustomersCurrent, newCustomersPrevious).toFixed(1)),
            avgOrderValue,
            avgOrderValueChange: Number(calcChange(avgOrderValue, prevAvgOrderValue).toFixed(1)),
            todayRejections,
        };

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

        chartOrdersSnap.docs.forEach((doc) => {
            const order = doc.data() || {};
            if (LOST_ORDER_STATUSES.has(String(order.status || '').toLowerCase())) return;
            addChartSale(order.orderDate, toAmount(order.totalAmount));
        });
        chartManualSnap.docs.forEach((doc) => {
            const bill = doc.data() || {};
            addChartSale(bill.printedAt || bill.createdAt, toAmount(bill.totalAmount || bill.grandTotal));
        });

        const salesChartData = Array.from(salesByDay.values())
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

        const menuItems = menuSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const topSellingNames = Object.entries(itemCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 6)
            .map(([name]) => name);

        const topItems = topSellingNames.map((name, index) => {
            const matchedItem = menuItems.find((item) => item.name === name);
            return {
                name,
                count: itemCounts[name],
                imageUrl: matchedItem?.imageUrl || `https://picsum.photos/seed/dish${index + 1}/200/200`,
            };
        });


        return NextResponse.json({
            stats,
            liveOrders,
            salesChart: salesChartData,
            topItems,
            businessInfo: {
                businessType: resolvedBusinessType,
            },
        }, { status: 200 });

    } catch (error) {
        console.error("DASHBOARD DATA FETCH ERROR:", error);
        const zeroStats = { sales: 0, salesChange: 0, orders: 0, ordersChange: 0, newCustomers: 0, newCustomersChange: 0, avgOrderValue: 0, avgOrderValueChange: 0, todayRejections: 0 };
        return NextResponse.json({ message: `Backend Error: ${error.message}`, stats: zeroStats, liveOrders: [], salesChart: [], topItems: [], businessInfo: { businessType: 'restaurant' } }, { status: error.status || 500 });
    }
}


