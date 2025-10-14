
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

async function verifyOwnerAndGetRestaurant(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
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
    } else if (userRole !== 'owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    
    const restaurantDoc = restaurantsQuery.docs[0];
    return { restaurantId: restaurantDoc.id, restaurantData: restaurantDoc.data() };
}


export async function GET(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const { restaurantId, restaurantData } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

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
        startDate.setHours(0,0,0,0);

        const endDate = (filter === 'Custom Range' && toDate) ? new Date(toDate) : new Date();
        endDate.setHours(23,59,59,999);

        // --- 1. Fetch Sales Data ---
        const ordersRef = firestore.collection('orders').where('restaurantId', '==', restaurantId);
        
        const [currentOrdersSnap, prevOrdersSnap, allMenuSnap, allCustomersSnap] = await Promise.all([
            ordersRef.where('orderDate', '>=', startDate).where('orderDate', '<=', endDate).get(),
            ordersRef.where('orderDate', '>=', prevStartDate).where('orderDate', '<', startDate).get(),
            firestore.collection('restaurants').doc(restaurantId).collection('menu').get(),
            firestore.collection('restaurants').doc(restaurantId).collection('customers').get()
        ]);
        
        // --- 2. Process Sales Overview ---
        let currentSales = 0, currentOrdersCount = 0, salesByDay = {};
        currentOrdersSnap.forEach(doc => {
            const data = doc.data();
            currentSales += data.totalAmount || 0;
            currentOrdersCount++;

            const dayKey = format(data.orderDate.toDate(), 'dd/MM');
            salesByDay[dayKey] = (salesByDay[dayKey] || 0) + data.totalAmount;
        });
        
        const salesTrend = Object.entries(salesByDay).map(([day, sales]) => ({ day, sales }));

        let prevSales = 0;
        prevOrdersSnap.forEach(doc => { prevSales += doc.data().totalAmount || 0; });
        
        const calcChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };

        const salesData = {
            kpis: {
                totalRevenue: currentSales,
                totalOrders: currentOrdersCount,
                avgOrderValue: currentOrdersCount > 0 ? currentSales / currentOrdersCount : 0,
                revenueChange: calcChange(currentSales, prevSales),
                ordersChange: calcChange(currentOrdersCount, prevOrdersSnap.size),
                avgValueChange: calcChange(currentOrdersCount > 0 ? currentSales / currentOrdersCount : 0, prevOrdersSnap.size > 0 ? prevSales / prevOrdersSnap.size : 0),
            },
            salesTrend,
            paymentMethods: [{ name: 'Online', value: 70 }, { name: 'COD', value: 30 }] // Dummy for now
        };

        // --- 3. Process Menu Analytics ---
        const menuItems = allMenuSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const itemSales = {};
        currentOrdersSnap.forEach(doc => {
            (doc.data().items || []).forEach(item => {
                const baseName = item.name.split(' (')[0];
                if (!itemSales[baseName]) itemSales[baseName] = 0;
                itemSales[baseName] += item.qty;
            });
        });

        const menuPerformance = menuItems.map(item => {
            const unitsSold = itemSales[item.name] || 0;
            const price = item.portions?.[0]?.price || 0;
            const foodCost = price * 0.4; // Dummy food cost
            const revenue = unitsSold * price;
            const totalCost = unitsSold * foodCost;
            const totalProfit = revenue - totalCost;
            const profitMargin = revenue > 0 ? (totalProfit / revenue) * 100 : 0;
            return {
                ...item, unitsSold, revenue, totalCost, totalProfit, profitMargin,
                popularity: unitsSold, profitability: profitMargin
            };
        });

        // --- 4. Process Customer Analytics ---
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
