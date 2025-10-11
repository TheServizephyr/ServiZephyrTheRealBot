import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

// This function should be in a lib file but placing here for simplicity
function initAdmin() {
    if (!getApps().length) {
        initializeApp();
    }
}
initAdmin();

export async function GET(req) {
    try {
        const firestore = getFirestore();

        // 1. Pending Approvals
        const pendingSnap = await firestore.collection('restaurants').where('approvalStatus', '==', 'pending').count().get();
        const pendingApprovals = pendingSnap.data().count;

        // 2. Total Restaurants
        const totalRestoSnap = await firestore.collection('restaurants').count().get();
        const totalRestaurants = totalRestoSnap.data().count;

        // 3. Total Users
        const totalUsersSnap = await firestore.collection('users').count().get();
        const totalUsers = totalUsersSnap.data().count;
        
        // 4. Today's metrics
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayOrdersSnap = await firestore.collection('orders').where('orderDate', '>=', today).get();
        const todayOrders = todayOrdersSnap.size;
        const todayRevenue = todayOrdersSnap.docs.reduce((sum, doc) => sum + doc.data().totalAmount, 0);
        
        // 5. Recent Signups
        const recentUsersSnap = await firestore.collection('users').orderBy('createdAt', 'desc').limit(4).get();
        const recentSignups = recentUsersSnap.docs.map(doc => {
            const data = doc.data();
            return {
                type: data.role === 'owner' ? 'Restaurant' : 'User',
                name: data.name || 'Unnamed User',
                time: data.createdAt?.toDate().toISOString() || new Date().toISOString(),
            };
        });

        // 6. Weekly Order Data
        const weeklyOrderData = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const day = date.toLocaleDateString('en-US', { weekday: 'short' });

            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            
            const daySnap = await firestore.collection('orders')
                .where('orderDate', '>=', startOfDay)
                .where('orderDate', '<=', endOfDay)
                .count().get();
            
            weeklyOrderData.push({ day, orders: daySnap.data().count });
        }


        return NextResponse.json({
            pendingApprovals,
            totalRestaurants,
            totalUsers,
            todayOrders,
            todayRevenue,
            recentSignups,
            weeklyOrderData
        }, { status: 200 });

    } catch (error) {
        console.error("ADMIN: GET DASHBOARD STATS ERROR", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
