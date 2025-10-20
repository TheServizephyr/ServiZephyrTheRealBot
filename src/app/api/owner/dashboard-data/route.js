

import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // --- ADMIN IMPERSONATION & PERMISSION LOGIC ---
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
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, collectionName: 'restaurants', isAdmin: userRole === 'admin' };
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, collectionName: 'shops', isAdmin: userRole === 'admin' };
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

        const now = new Date();
        let startDate, prevStartDate;

        switch (filter) {
            case 'This Week':
                startDate = new Date(now.setDate(now.getDate() - now.getDay()));
                prevStartDate = new Date(new Date().setDate(startDate.getDate() - 7));
                break;
            case 'This Month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                prevStartDate = new Date(new Date().setMonth(startDate.getMonth() - 1));
                break;
            case 'Today':
            default:
                startDate = new Date(now.setHours(0, 0, 0, 0));
                prevStartDate = new Date(new Date().setDate(startDate.getDate() - 1));
                break;
        }

        const ordersRef = firestore.collection('orders').where('restaurantId', '==', businessId);
        const customersRef = firestore.collection(collectionName).doc(businessId).collection('customers');
        
        const [currentOrdersSnap, prevOrdersSnap, newCustomersSnap, topItemsSnap, rejectedOrdersSnap] = await Promise.all([
            ordersRef.where('orderDate', '>=', startDate).where('status', '!=', 'rejected').get(),
            ordersRef.where('orderDate', '>=', prevStartDate).where('orderDate', '<', startDate).where('status', '!=', 'rejected').get(),
            customersRef.where('joinedAt', '>=', startDate).get(), 
            ordersRef.where('orderDate', '>=', startDate).limit(50).get(),
            ordersRef.where('orderDate', '>=', startDate).where('status', '==', 'rejected').get()
        ]);

        let sales = 0;
        const currentOrders = currentOrdersSnap.docs.map(doc => {
            const data = doc.data();
            sales += data.totalAmount || 0;
            return data;
        });

        let prevSales = 0;
        prevOrdersSnap.docs.forEach(doc => {
            prevSales += doc.data().totalAmount || 0;
        });

        const calcChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };
        
        const avgOrderValue = currentOrders.length > 0 ? sales / currentOrders.length : 0;
        const prevAvgOrderValue = prevOrdersSnap.size > 0 ? prevSales / prevOrdersSnap.size : 0;

        const stats = {
            sales,
            salesChange: calcChange(sales, prevSales),
            orders: currentOrders.length,
            ordersChange: calcChange(currentOrders.length, prevOrdersSnap.size),
            newCustomers: newCustomersSnap.size,
            newCustomersChange: 0,
            avgOrderValue: avgOrderValue,
            avgOrderValueChange: calcChange(avgOrderValue, prevAvgOrderValue),
            todayRejections: rejectedOrdersSnap.size,
        };

        const liveOrdersSnap = await ordersRef.where('status', 'in', ['pending', 'confirmed']).orderBy('orderDate', 'desc').limit(3).get();
        const liveOrders = liveOrdersSnap.docs.map(doc => ({ id: doc.id, customer: doc.data().customerName, amount: doc.data().totalAmount }));

        const salesChartData = [];
        const sevenDaysAgo = new Date(new Date().setDate(new Date().getDate() - 7));
        const chartSnap = await ordersRef.where('orderDate', '>=', sevenDaysAgo).orderBy('orderDate').get();
        
        const salesByDay = {};
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        daysOfWeek.forEach(day => salesByDay[day] = 0);

        chartSnap.docs.forEach(doc => {
            const data = doc.data();
            const day = data.orderDate.toDate().toLocaleDateString('en-US', { weekday: 'short' });
            salesByDay[day] = (salesByDay[day] || 0) + data.totalAmount;
        });
        
        const todayDayIndex = new Date().getDay();
        const orderedDays = [...daysOfWeek.slice(todayDayIndex + 1), ...daysOfWeek.slice(0, todayDayIndex + 1)];
        orderedDays.forEach(day => salesChartData.push({ day: day, sales: salesByDay[day] || 0 }));

        const itemCounts = {};
        topItemsSnap.docs.forEach(doc => {
            (doc.data().items || []).forEach(item => {
                itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
            });
        });

        const menuRef = firestore.collection(collectionName).doc(businessId).collection('menu');
        const menuSnap = await menuRef.get();
        const menuItems = menuSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const topSellingNames = Object.entries(itemCounts)
            .sort(([,a],[,b]) => b - a)
            .slice(0, 3)
            .map(([name]) => name);

        const topItems = menuItems
            .filter(item => topSellingNames.includes(item.name))
            .map((item, index) => ({
                name: item.name,
                count: itemCounts[item.name],
                imageUrl: item.imageUrl || `https://picsum.photos/seed/dish${index+1}/200/200`
            }));


        return NextResponse.json({ stats, liveOrders, salesChart: salesChartData, topItems }, { status: 200 });

    } catch (error) {
        console.error("DASHBOARD DATA FETCH ERROR:", error);
        const zeroStats = { sales: 0, salesChange: 0, orders: 0, ordersChange: 0, newCustomers: 0, newCustomersChange: 0, avgOrderValue: 0, avgOrderValueChange: 0, todayRejections: 0 };
        return NextResponse.json({ message: `Backend Error: ${error.message}`, stats: zeroStats, liveOrders: [], salesChart: [], topItems: [] }, { status: error.status || 500 });
    }
}
