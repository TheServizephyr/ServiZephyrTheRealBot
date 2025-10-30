
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify user and get UID
async function getUserId(req, auth) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken.uid;
}

export async function GET(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const uid = await getUserId(req, auth);

        const ordersSnap = await firestore.collection('orders')
            .where('customerId', '==', uid)
            .orderBy('orderDate', 'desc')
            .get();

        if (ordersSnap.empty) {
            return NextResponse.json({
                quickReorder: null,
                myRestaurants: [],
                myStats: {
                    totalSavings: 0,
                    topRestaurant: 'N/A',
                    topDish: 'N/A',
                }
            }, { status: 200 });
        }

        const orders = ordersSnap.docs.map(doc => doc.data());

        // 1. Quick Re-Order
        const lastOrder = orders[0];
        const quickReorder = {
            restaurantName: lastOrder.restaurantName,
            dishName: lastOrder.items[0]?.name || 'your last item',
            restaurantId: lastOrder.restaurantId,
        };

        // 2. My Restaurants
        const restaurantMap = new Map();
        orders.forEach(order => {
            if (!restaurantMap.has(order.restaurantId)) {
                restaurantMap.set(order.restaurantId, {
                    name: order.restaurantName,
                    id: order.restaurantId
                });
            }
        });
        const myRestaurants = Array.from(restaurantMap.values()).slice(0, 5); // Limit to 5

        // 3. My Stats - THE FIX IS HERE
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

        const topRestaurant = Object.keys(restaurantFrequency).length > 0 
            ? Object.entries(restaurantFrequency).sort((a, b) => b[1] - a[1])[0][0] 
            : 'N/A';
            
        const topDish = Object.keys(dishFrequency).length > 0 
            ? Object.entries(dishFrequency).sort((a, b) => b[1] - a[1])[0][0]
            : 'N/A';

        const myStats = {
            totalSavings,
            topRestaurant,
            topDish,
        };
        // END FIX

        return NextResponse.json({
            quickReorder,
            myRestaurants,
            myStats,
        }, { status: 200 });

    } catch (error) {
        console.error("GET /api/customer/hub-data ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
