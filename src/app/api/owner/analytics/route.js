

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

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
        console.log(`[API Impersonation] Admin ${uid} is viewing analytics for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }

        console.log(`[API Employee Access] ${uid} viewing ${employeeOfOwnerId}'s analytics`);
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

        // OPTIMIZED QUERY: Fetch ALL orders for the period, filter in memory
        const [currentPeriodOrdersSnap, prevPeriodOrdersSnap, allMenuSnap, allCustomersSnap] = await Promise.all([
            ordersRef.where('orderDate', '>=', startDate).where('orderDate', '<=', endDate).get(),
            ordersRef.where('orderDate', '>=', prevStartDate).where('orderDate', '<', startDate).get(),
            firestore.collection(businessCollectionName).doc(restaurantId).collection('menu').get(),
            firestore.collection(businessCollectionName).doc(restaurantId).collection('customers').get(),
        ]);

        // ---- METRICS CALCULATION ----
        let currentSales = 0, currentOrdersCount = 0, salesByDay = {}, cashRevenue = 0, onlineRevenue = 0;
        const paymentMethodCounts = { Online: 0, Cash: 0 }; // Simplified groups: Online vs Cash
        const hourlyOrders = Array(24).fill(0);
        const prepTimes = [];
        const customerOrderDates = {};

        // Rejection Metrics
        let totalRejections = 0;
        let missedRevenue = 0;
        const missedItems = {};
        const rejectionReasons = {};

        // Helper: Check for "Lost" orders (Rejected, Cancelled, Failed)
        const isLostOrder = (status) => ['rejected', 'cancelled', 'failed_delivery', 'returned_to_restaurant'].includes(status);

        currentPeriodOrdersSnap.forEach(doc => {
            const data = doc.data();
            const status = data.status || 'pending';

            // 1. REJECTION METRICS (Lost Orders)
            if (isLostOrder(status)) {
                totalRejections++;
                const reason = data.rejectionReason || data.cancellationReason || 'Other';
                rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;

                if (data.totalAmount) missedRevenue += data.totalAmount;

                if (reason === 'out_of_stock' && data.items) {
                    data.items.forEach(item => {
                        const itemName = item.name.split(' (')[0];
                        if (!missedItems[itemName]) {
                            missedItems[itemName] = { count: 0, revenue: 0 };
                        }
                        missedItems[itemName].count++;
                        missedItems[itemName].revenue += (item.price * item.quantity) || 0;
                    });
                }
            }
            // 2. SUCCESSFUL ORDERS (Revenue, Counts)
            // Explicitly exclude lost orders from Revenue calculation
            else {
                currentOrdersCount++;
                currentSales += data.totalAmount || 0;

                const dayKey = format(data.orderDate.toDate(), 'dd/MM');
                salesByDay[dayKey] = (salesByDay[dayKey] || 0) + data.totalAmount;

                // Hourly Distribution
                const utcDate = data.orderDate.toDate();
                const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
                const hour = istDate.getHours();
                hourlyOrders[hour]++;

                // Payment Analysis
                let isOnlinePayment = false;
                if (Array.isArray(data.paymentDetails)) {
                    isOnlinePayment = data.paymentDetails.some(p =>
                        (p.method === 'razorpay' || p.method === 'phonepe') &&
                        (p.status === 'completed' || p.status === 'success' || p.status === 'paid')
                    );
                } else if (data.paymentDetails?.method) {
                    isOnlinePayment = (data.paymentDetails.method === 'razorpay' || data.paymentDetails.method === 'phonepe');
                }

                // Fallback check
                if (!isOnlinePayment && data.paymentMethod) {
                    isOnlinePayment = (data.paymentMethod === 'razorpay' || data.paymentMethod === 'phonepe' || data.paymentMethod === 'online');
                }

                // Also check raw 'paymentStatus' for valid confirmation
                if (data.paymentStatus === 'paid') isOnlinePayment = true;


                if (isOnlinePayment) {
                    paymentMethodCounts.Online++;
                    onlineRevenue += data.totalAmount || 0;
                } else {
                    paymentMethodCounts.Cash++;
                    cashRevenue += data.totalAmount || 0;
                }

                // Prep Times
                if (data.readyAt && data.orderDate) {
                    const prepTime = (data.readyAt.toDate() - data.orderDate.toDate()) / (1000 * 60);
                    if (prepTime > 0 && prepTime < 120) prepTimes.push(prepTime);
                }

                // Customer Loyalty
                if (data.phone) {
                    if (!customerOrderDates[data.phone]) customerOrderDates[data.phone] = [];
                    customerOrderDates[data.phone].push(data.orderDate.toDate());
                }
            }
        });

        // Previous Period Comparison (Approximate: Revenue only for now)
        let prevSales = 0;
        let prevOrdersCount = 0;
        prevPeriodOrdersSnap.forEach(doc => {
            const d = doc.data();
            if (!isLostOrder(d.status)) { // Filter prev period too!
                prevSales += d.totalAmount || 0;
                prevOrdersCount++;
            }
        });

        const calcChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };

        const salesTrend = Object.entries(salesByDay).map(([day, sales]) => ({ day, sales }));
        const paymentMethodsData = Object.entries(paymentMethodCounts).map(([name, value]) => ({ name, value })); // For Pie Chart
        const rejectionReasonsData = Object.entries(rejectionReasons).map(([name, value]) => ({ name, value }));
        const missedItemsData = Object.entries(missedItems)
            .map(([name, data]) => ({ name, ...data }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        const avgPrepTime = prepTimes.length > 0 ? prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length : 0;
        const peakHours = hourlyOrders.map((count, hour) => ({ hour, count })).filter(h => h.count > 0).sort((a, b) => b.count - a.count);

        const salesData = {
            kpis: {
                totalRevenue: currentSales,
                totalOrders: currentOrdersCount,
                avgOrderValue: currentOrdersCount > 0 ? currentSales / currentOrdersCount : 0,
                cashRevenue,
                onlineRevenue,
                revenueChange: calcChange(currentSales, prevSales),
                ordersChange: calcChange(currentOrdersCount, prevOrdersCount),
                avgValueChange: calcChange(currentOrdersCount > 0 ? currentSales / currentOrdersCount : 0, prevOrdersCount > 0 ? prevSales / prevOrdersCount : 0),
                totalRejections, // Now includes cancelled
                missedRevenue,
                avgPrepTime: Math.round(avgPrepTime),
            },
            salesTrend,
            paymentMethods: paymentMethodsData,
            rejectionReasons: rejectionReasonsData,
            peakHours,
            missedOpportunities: missedItemsData,
        };

        // ... REMAINING LOGIC FOR MENU AND CUSTOMERS (unchanged largely, just menu mapping) ...
        const menuItems = allMenuSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const itemSales = {};

        // Count items ONLY from successful orders
        currentPeriodOrdersSnap.forEach(doc => {
            const data = doc.data();
            if (!isLostOrder(data.status)) {
                (data.items || []).forEach(item => {
                    const baseName = item.name.split(' (')[0];
                    if (!itemSales[baseName]) itemSales[baseName] = 0;
                    itemSales[baseName] += item.quantity || 0;
                });
            }
        });

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

        // ... REMAINING LOGIC FOR CUSTOMERS ...
        const allCustomers = allCustomersSnap.docs.map(doc => ({ phone: doc.id, ...doc.data() }));
        const newThisMonth = allCustomers.filter(c => c.joinedAt && c.joinedAt.toDate() > new Date(now.getFullYear(), now.getMonth(), 1));
        const repeatCustomers = allCustomers.filter(c => (c.totalOrders || 0) > 1);

        const uniqueCustomersThisPeriod = new Set(Object.keys(customerOrderDates));
        const returningThisPeriod = Array.from(uniqueCustomersThisPeriod).filter(phone => {
            const customer = allCustomers.find(c => c.phone === phone);
            return customer && customer.joinedAt && customer.joinedAt.toDate() < startDate;
        });

        const topLoyalCustomers = allCustomers
            .filter(c => (c.totalOrders || 0) > 0)
            .sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0))
            .slice(0, 5)
            .map(c => ({
                name: c.name || 'Customer',
                phone: c.phone,
                orders: c.totalOrders || 0,
                totalSpent: c.totalSpent || 0
            }));

        const customerStats = {
            totalCustomers: allCustomers.length,
            newThisMonth: newThisMonth.length,
            repeatRate: allCustomers.length > 0 ? Math.round((repeatCustomers.length / allCustomers.length) * 100) : 0,
            newThisPeriod: uniqueCustomersThisPeriod.size - returningThisPeriod.length,
            returningThisPeriod: returningThisPeriod.length,
            topLoyalCustomers,
        };

        // ... AI INSIGHTS ...
        const aiInsights = [];

        if (missedRevenue > 0 && missedItemsData.length > 0) {
            const topMissed = missedItemsData[0];
            aiInsights.push({
                type: 'warning',
                message: `Boss, aaj aapne ₹${Math.round(missedRevenue)} ka nuksan kiya kyunki '${topMissed.name}' cancel hua. Stock check karo!`
            });
        }
        if (peakHours.length > 0) {
            const peak = peakHours[0];
            const peakTime = peak.hour >= 12 ? `${peak.hour > 12 ? peak.hour - 12 : peak.hour} PM` : `${peak.hour} AM`;
            aiInsights.push({
                type: 'tip',
                message: `Aapka sabse busy time ${peakTime} hai (${peak.count} orders). Uss time se pehle ready raho!`
            });
        }
        const aov = currentOrdersCount > 0 ? currentSales / currentOrdersCount : 0;
        if (aov > 0 && aov < 100) {
            aiInsights.push({
                type: 'suggestion',
                message: `Average order value ₹${Math.round(aov)} hai. Combo offers dalo toh zyada paisa banega!`
            });
        }
        if (customerStats.repeatRate > 50) {
            aiInsights.push({
                type: 'success',
                message: `Badhiya! ${customerStats.repeatRate}% customers wapas aa rahe hain. Matlab khana accha hai! 🔥`
            });
        }

        return NextResponse.json({
            salesData,
            menuPerformance,
            customerStats,
            aiInsights,
        }, { status: 200 });

    } catch (error) {
        console.error("ANALYTICS API ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


