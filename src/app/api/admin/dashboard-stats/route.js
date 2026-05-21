

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { addDays, getAdminOrderAnalytics, parseAnalyticsRange, toIstDayKey } from '@/lib/server/adminAnalyticsMetrics';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();

        // 1. Pending Approvals from both collections
        const pendingRestaurantsSnap = await firestore.collection('restaurants').where('approvalStatus', '==', 'pending').count().get();
        const pendingShopsSnap = await firestore.collection('shops').where('approvalStatus', '==', 'pending').count().get();
        const pendingApprovals = pendingRestaurantsSnap.data().count + pendingShopsSnap.data().count;


        // 2. Total Listings from both collections
        const totalRestoSnap = await firestore.collection('restaurants').count().get();
        const totalShopsSnap = await firestore.collection('shops').count().get();
        const totalListings = totalRestoSnap.data().count + totalShopsSnap.data().count;

        // 3. Total Users
        const totalUsersSnap = await firestore.collection('users').count().get();
        const totalUsers = totalUsersSnap.data().count;

        // 4. Order analytics for the admin dashboard
        const todayKey = toIstDayKey(new Date());
        const selectedWindow = parseAnalyticsRange(new URLSearchParams({
            start: addDays(todayKey, -6),
            end: todayKey,
        }));
        const orderAnalytics = await getAdminOrderAnalytics(firestore, {
            selectedWindow,
            topLimit: 5,
            restaurantLimit: 8,
        });
        const todayOrders = orderAnalytics.periodSummary.today.current.orderCount;
        const todayRevenue = orderAnalytics.periodSummary.today.current.revenue;

        // 5. Recent Signups
        const recentUsersSnap = await firestore.collection('users').orderBy('createdAt', 'desc').limit(4).get();
        const recentSignups = recentUsersSnap.docs.map(doc => {
            const data = doc.data();
            const signupTime = data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString();

            let userType = 'User';
            if (data.businessType === 'restaurant') {
                userType = 'Restaurant';
            } else if (data.businessType === 'shop' || data.businessType === 'store') {
                userType = 'Store';
            } else if (data.role === 'customer') {
                userType = 'Customer'
            }

            return {
                type: userType,
                name: data.name || 'Unnamed User',
                time: signupTime,
            };
        });

        // 6. Weekly Order Data
        const weeklyOrderData = orderAnalytics.revenueData.map((row) => ({
            day: new Date(`${row.date}T00:00:00.000Z`).toLocaleDateString('en-US', { weekday: 'short' }),
            date: row.date,
            orders: row.orders,
            revenue: row.revenue,
        }));


        return NextResponse.json({
            pendingApprovals,
            totalListings,
            totalUsers,
            todayOrders,
            todayRevenue,
            periodSummary: orderAnalytics.periodSummary,
            topRestaurantsToday: orderAnalytics.restaurantBreakdown,
            sourceBreakdown: orderAnalytics.sourceBreakdown,
            recentSignups,
            weeklyOrderData
        }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/dashboard-stats ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
