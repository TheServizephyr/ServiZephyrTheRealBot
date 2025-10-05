
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetRestaurant(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    const restaurantId = restaurantsQuery.docs[0].id;
    
    return { uid, restaurantId };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

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

        // Now we query orders specific to the owner's restaurant
        const ordersRef = firestore.collection('orders').where('restaurantId', '==', restaurantId);
        const customersRef = firestore.collection('restaurants').doc(restaurantId).collection('customers');
        
        const [currentOrdersSnap, prevOrdersSnap, newCustomersSnap, topItemsSnap] = await Promise.all([
            ordersRef.where('orderDate', '>=', startDate).get(),
            ordersRef.where('orderDate', '>=', prevStartDate).where('orderDate', '<', startDate).get(),
            customersRef.where('joinedAt', '>=', startDate).get(), // Assuming 'joinedAt' exists
            ordersRef.where('orderDate', '>=', startDate).limit(50).get()
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
            newCustomersChange: 0, // This logic would need more historical data
            avgOrderValue: avgOrderValue,
            avgOrderValueChange: calcChange(avgOrderValue, prevAvgOrderValue),
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
        orderedDays.forEach(day => salesChartData.push({ day, sales: salesByDay[day] || 0 }));

        const itemCounts = {};
        topItemsSnap.docs.forEach(doc => {
            (doc.data().items || []).forEach(item => {
                itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
            });
        });
        const topItems = Object.entries(itemCounts)
            .sort(([,a],[,b]) => b - a)
            .slice(0, 5)
            .map(([name, count], index) => ({
                name,
                count,
                imageUrl: `https://picsum.photos/seed/dish${index+1}/200/200`
            }));

        return NextResponse.json({ stats, liveOrders, salesChart: topItems }, { status: 200 });

    } catch (error) {
        console.error("DASHBOARD DATA FETCH ERROR:", error);
        const zeroStats = { sales: 0, salesChange: 0, orders: 0, ordersChange: 0, newCustomers: 0, newCustomersChange: 0, avgOrderValue: 0, avgOrderValueChange: 0 };
        return NextResponse.json({ message: `Backend Error: ${error.message}`, stats: zeroStats, liveOrders: [], salesChart: [], topItems: [] }, { status: error.status || 500 });
    }
}
