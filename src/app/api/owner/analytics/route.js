

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing analytics for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    } else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { restaurantId: doc.id, restaurantData: doc.data(), businessType: doc.data().businessType || collectionName.slice(0, -1) };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId, restaurantData, businessType } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const url = new URL(req.url, `http://${req.headers.host}`);
        const filter = url.searchParams.get('filter') || 'This Month';
        const fromDate = url.searchParams.get('from');
        const toDate = url.searchParams.get('to');

        let startDate, prevStartDate;
        const now = new Date();

        if (filter === 'Custom Range' && fromDate && toDate) {
            startDate = new Date(fromDate);
            const duration = new Date(toDate).getTime() - startDate.getTime();
            prevStartDate = new Date(startDate.getTime() - duration);
        } else {
            switch (filter) {
                case 'This Week':
                    startDate = new Date(now.setDate(now.getDate() - now.getDay()));
                    prevStartDate = new Date(new Date().setDate(startDate.getDate() - 7));
                    break;
                case 'This Year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
                    break;
                case 'Today':
                    startDate = new Date(now.setHours(0, 0, 0, 0));
                    prevStartDate = new Date(new Date().setDate(startDate.getDate() - 1));
                    break;
                case 'This Month':
                default:
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    prevStartDate = new Date(new Date().setMonth(startDate.getMonth() - 1));
                    break;
            }
        }
        startDate.setHours(0, 0, 0, 0);

        const endDate = (filter === 'Custom Range' && toDate) ? new Date(toDate) : new Date();
        endDate.setHours(23, 59, 59, 999);

        const ordersRef = firestore.collection('orders').where('restaurantId', '==', restaurantId);

        let businessCollectionName;
        if (businessType === 'restaurant') businessCollectionName = 'restaurants';
        else if (businessType === 'shop') businessCollectionName = 'shops';
        else if (businessType === 'street-vendor') businessCollectionName = 'street_vendors';

        const [currentOrdersSnap, prevOrdersSnap, allMenuSnap, allCustomersSnap, rejectedOrdersSnap] = await Promise.all([
            ordersRef.where('orderDate', '>=', startDate).where('orderDate', '<=', endDate).where('status', '!=', 'rejected').get(),
            ordersRef.where('orderDate', '>=', prevStartDate).where('orderDate', '<', startDate).where('status', '!=', 'rejected').get(),
            firestore.collection(businessCollectionName).doc(restaurantId).collection('menu').get(),
            firestore.collection(businessCollectionName).doc(restaurantId).collection('customers').get(),
            ordersRef.where('orderDate', '>=', startDate).where('orderDate', '<=', endDate).where('status', '==', 'rejected').get(),
        ]);

        let currentSales = 0, currentOrdersCount = 0, salesByDay = {};
        const paymentMethodCounts = { Online: 0, COD: 0 };

        currentOrdersSnap.forEach(doc => {
            const data = doc.data();
            currentSales += data.totalAmount || 0;
            currentOrdersCount++;

            const dayKey = format(data.orderDate.toDate(), 'dd/MM');
            salesByDay[dayKey] = (salesByDay[dayKey] || 0) + data.totalAmount;

            if (data.paymentDetails?.method === 'razorpay') {
                paymentMethodCounts.Online++;
            } else {
                paymentMethodCounts.COD++;
            }
        });

        const salesTrend = Object.entries(salesByDay).map(([day, sales]) => ({ day, sales }));
        const paymentMethods = Object.entries(paymentMethodCounts).map(([name, value]) => ({ name, value }));


        let prevSales = 0;
        prevOrdersSnap.forEach(doc => { prevSales += doc.data().totalAmount || 0; });

        const calcChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };

        const totalRejections = rejectedOrdersSnap.size;
        const rejectionReasons = {};
        rejectedOrdersSnap.forEach(doc => {
            const reason = doc.data().rejectionReason || 'Other';
            rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        });

        const rejectionReasonsData = Object.entries(rejectionReasons).map(([name, value]) => ({ name, value }));


        const salesData = {
            kpis: {
                totalRevenue: currentSales,
                totalOrders: currentOrdersCount,
                avgOrderValue: currentOrdersCount > 0 ? currentSales / currentOrdersCount : 0,
                revenueChange: calcChange(currentSales, prevSales),
                ordersChange: calcChange(currentOrdersCount, prevOrdersSnap.size),
                avgValueChange: calcChange(currentOrdersCount > 0 ? currentSales / currentOrdersCount : 0, prevOrdersSnap.size > 0 ? prevSales / prevOrdersSnap.size : 0),
                totalRejections,
            },
            salesTrend,
            paymentMethods: paymentMethods,
            rejectionReasons: rejectionReasonsData,
        };

        const menuItems = allMenuSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const itemSales = {};
        currentOrdersSnap.forEach(doc => {
            const orderItems = doc.data().items || [];
            if (orderItems.length > 0 && !itemSales.__logged) {
                console.log('[ANALYTICS DEBUG] Sample Order Item:', orderItems[0]);
                itemSales.__logged = true;
            }
            (doc.data().items || []).forEach(item => {
                const baseName = item.name.split(' (')[0];
                if (!itemSales[baseName]) itemSales[baseName] = 0;
                itemSales[baseName] += item.qty;
            });
        });

        console.log('[ANALYTICS DEBUG] Item Sales from Orders:', itemSales);
        console.log('[ANALYTICS DEBUG] Menu Item Names:', menuItems.map(i => i.name));

        const menuPerformance = menuItems.map(item => {
            const unitsSold = itemSales[item.name] || 0;
            const price = item.portions?.[0]?.price || 0;
            const foodCost = price * 0.4;
            const revenue = unitsSold * price;
            const totalCost = unitsSold * foodCost;
            const totalProfit = revenue - totalCost;
            const profitMargin = revenue > 0 ? (totalProfit / revenue) * 100 : 0;
            return {
                ...item, unitsSold, revenue, totalCost, totalProfit, profitMargin,
                popularity: unitsSold, profitability: profitMargin
            };
        });

        const allCustomers = allCustomersSnap.docs.map(doc => doc.data());
        const newThisMonth = allCustomers.filter(c => c.joinedAt && c.joinedAt.toDate() > new Date(now.getFullYear(), now.getMonth(), 1));
        const repeatCustomers = allCustomers.filter(c => (c.totalOrders || 0) > 1);

        const customerStats = {
            totalCustomers: allCustomers.length,
            newThisMonth: newThisMonth.length,
            repeatRate: allCustomers.length > 0 ? Math.round((repeatCustomers.length / allCustomers.length) * 100) : 0,
        };

        return NextResponse.json({
            salesData,
            menuPerformance,
            customerStats,
        }, { status: 200 });

    } catch (error) {
        console.error("ANALYTICS API ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


