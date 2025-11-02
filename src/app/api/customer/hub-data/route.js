

import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    console.log("[API hub-data] GET request received.");
    try {
        const uid = await verifyAndGetUid(req); // Use central helper
        const firestore = await getFirestore();

        console.log(`[API hub-data] Fetching orders for customerId: ${uid}`);
        const ordersSnap = await firestore.collection('orders')
            .where('customerId', '==', uid)
            .get();

        console.log(`[API hub-data] Found ${ordersSnap.size} orders for user.`);

        if (ordersSnap.empty) {
            console.log("[API hub-data] No orders found, returning empty data.");
            return NextResponse.json({
                quickReorder: null,
                myRestaurants: [],
                myStats: { totalSavings: 0, topRestaurant: 'N/A', topDish: 'N/A' }
            }, { status: 200 });
        }

        const orders = ordersSnap.docs.map(doc => doc.data());
        
        orders.sort((a, b) => {
            const dateA = a.orderDate?.toDate ? a.orderDate.toDate() : new Date(a.orderDate);
            const dateB = b.orderDate?.toDate ? b.orderDate.toDate() : new Date(b.orderDate);
            return dateB - dateA;
        });

        const lastOrder = orders[0];
        const quickReorder = {
            restaurantName: lastOrder.restaurantName,
            dishName: lastOrder.items[0]?.name || 'your last item',
            restaurantId: lastOrder.restaurantId,
        };
        console.log("[API hub-data] Quick Reorder data:", quickReorder);

        const restaurantMap = new Map();
        orders.forEach(order => {
            if (!restaurantMap.has(order.restaurantId)) {
                restaurantMap.set(order.restaurantId, { name: order.restaurantName, id: order.restaurantId });
            }
        });
        const myRestaurants = Array.from(restaurantMap.values()).slice(0, 5);
        console.log("[API hub-data] My Restaurants data:", myRestaurants);

        let totalSavings = 0;
        const restaurantFrequency = {};
        const dishFrequency = {};

        orders.forEach(order => {
            totalSavings += order.discount || 0;
            if (order.restaurantName) {
              restaurantFrequency[order.restaurantName] = (restaurantFrequency[order.restaurantName] || 0) + 1;
            }
            (order.items || []).forEach(item => {
                if(item.name) {
                  dishFrequency[item.name] = (dishFrequency[item.name] || 0) + (item.qty || 1);
                }
            });
        });
        console.log(`[API hub-data] Total Savings calculated: ${totalSavings}`);

        const topRestaurant = Object.keys(restaurantFrequency).length > 0 
            ? Object.entries(restaurantFrequency).sort((a, b) => b[1] - a[1])[0][0] 
            : 'N/A';
            
        const topDish = Object.keys(dishFrequency).length > 0 
            ? Object.entries(dishFrequency).sort((a, b) => b[1] - a[1])[0][0]
            : 'N/A';
        
        console.log(`[API hub-data] Top Restaurant: ${topRestaurant}, Top Dish: ${topDish}`);

        const myStats = { totalSavings, topRestaurant, topDish };

        const finalPayload = { quickReorder, myRestaurants, myStats };
        
        console.log("[API hub-data] Sending final payload to client:", JSON.stringify(finalPayload, null, 2));

        return NextResponse.json(finalPayload, { status: 200 });

    } catch (error) {
        console.error("[API hub-data] CRITICAL ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
