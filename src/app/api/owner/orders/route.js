
import { NextResponse } from 'next/server';
import { firestore as adminFirestore } from 'firebase-admin';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

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
    
    const restaurantDoc = restaurantsQuery.docs[0];
    return { uid, restaurantId: restaurantDoc.id, restaurantSnap: restaurantDoc };
}

async function seedInitialOrders(firestore, restaurantId, restaurantSnap) {
    const ordersRef = firestore.collection('orders');
    const batch = firestore.batch();

    const restaurantData = restaurantSnap.data();

    const initialOrders = [
        { id: 'ZEP-001', customerName: 'Ravi Kumar', customerId: 'cust-123', customerAddress: '123, ABC Society, Near Park, Pune - 411028', customerPhone: '9876543210', items: [{ name: 'Paneer Butter Masala', qty: 2, price: 250 }, { name: 'Garlic Naan', qty: 4, price: 70 }], totalAmount: 780, status: 'pending', priority: 5, orderDate: adminFirestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000) },
        { id: 'ZEP-002', customerName: 'Sunita Sharma', customerId: 'cust-456', customerAddress: 'Flat 404, Star Tower, Andheri West, Mumbai', customerPhone: '9988776655', items: [{ name: 'Chicken Biryani', qty: 1, price: 350 }], totalAmount: 350, status: 'confirmed', priority: 3, orderDate: adminFirestore.Timestamp.fromMillis(Date.now() - 10 * 60 * 1000) },
    ];
    
    const finalOrders = [];
    initialOrders.forEach(order => {
        const docRef = ordersRef.doc(order.id);
        const newOrder = {
            ...order,
            restaurantId: restaurantId,
            restaurantName: restaurantData?.name || 'Your Restaurant Name'
        };
        batch.set(docRef, newOrder);
        finalOrders.push(newOrder);
    });

    await batch.commit();
    return finalOrders;
}

export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        
        // --- Verify Owner ---
        const { uid, restaurantId, restaurantSnap } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        
        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('id');
        
        // --- Logic to fetch a SINGLE order for the bill page ---
        if (orderId) {
            const orderRef = firestore.collection('orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) {
                return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
            }
            
            let orderData = orderDoc.data();
            // Security check: ensure the fetched order belongs to the owner's restaurant
            if (orderData.restaurantId !== restaurantId) {
                return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
            }
            
            // CONVERT TIMESTAMP TO ISO STRING FOR CLIENT
            if (orderData.orderDate && orderData.orderDate.toDate) {
                orderData = { ...orderData, orderDate: orderData.orderDate.toDate().toISOString() };
            }


            const restaurantData = restaurantSnap.data();

            return NextResponse.json({ order: orderData, restaurant: restaurantData }, { status: 200 });
        }


        // --- Original logic to fetch ALL orders for the live orders page ---
        const ordersRef = firestore.collection('orders');
        const ordersSnap = await ordersRef.where('restaurantId', '==', restaurantId).orderBy('orderDate', 'desc').get();

        let orders = [];
        if (ordersSnap.empty) {
            console.log(`No orders found for restaurant ${restaurantId}. Seeding initial data...`);
            orders = await seedInitialOrders(firestore, restaurantId, restaurantSnap);
        } else {
            orders = ordersSnap.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    ...data,
                    // Ensure date is ISO string for client-side processing
                    orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                    customer: data.customerName,
                    amount: data.totalAmount,
                };
            });
        }

        return NextResponse.json({ orders }, { status: 200 });

    } catch (error) {
        console.error("GET ORDERS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        // We still verify the owner to ensure they have rights, even though orderId is unique
        await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { orderId, newStatus } = await req.json();

        if (!orderId || !newStatus) {
            return NextResponse.json({ message: 'Order ID and new status are required.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        await orderRef.update({ status: newStatus });

        return NextResponse.json({ message: 'Order status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("PATCH ORDER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function DELETE(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { orderId } = await req.json();

        if (!orderId) {
            return NextResponse.json({ message: 'Order ID is required.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        await orderRef.delete();

        return NextResponse.json({ message: 'Order rejected and removed.' }, { status: 200 });
    } catch (error) {
        console.error("DELETE ORDER ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

    