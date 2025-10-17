
import { NextResponse } from 'next/server';
import { firestore as adminFirestore } from 'firebase-admin';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import { sendOrderStatusUpdateToCustomer } from '@/lib/notifications';


async function verifyOwnerAndGetRestaurant(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const url = new URL(req.headers.get('referer') || 'http://localhost');
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', impersonatedOwnerId).limit(1).get();
        if (restaurantsQuery.empty) {
            throw { message: 'Impersonated owner does not have an associated restaurant.', status: 404 };
        }
        const restaurantSnap = restaurantsQuery.docs[0];
        return { uid: impersonatedOwnerId, restaurantId: restaurantSnap.id, restaurantSnap, isAdmin: true };
    }

    if (userRole === 'owner') {
        const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
        if (restaurantsQuery.empty) {
            throw { message: 'No restaurant associated with this owner.', status: 404 };
        }
        const restaurantDoc = restaurantsQuery.docs[0];
        return { uid, restaurantId: restaurantDoc.id, restaurantSnap: restaurantDoc };
    }
    
    throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        
        const { uid, restaurantId, restaurantSnap } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        
        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('id');
        
        if (orderId) {
            const orderRef = firestore.collection('orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) {
                return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
            }
            
            let orderData = orderDoc.data();
            if (orderData.restaurantId !== restaurantId) {
                return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
            }
            
            if (orderData.orderDate && orderData.orderDate.toDate) {
                orderData = { ...orderData, orderDate: orderData.orderDate.toDate().toISOString() };
            }


            const restaurantData = restaurantSnap.data();

            return NextResponse.json({ order: orderData, restaurant: restaurantData }, { status: 200 });
        }

        const ordersRef = firestore.collection('orders');
        const ordersSnap = await ordersRef.where('restaurantId', '==', restaurantId).orderBy('orderDate', 'desc').get();

        const orders = ordersSnap.docs.map(doc => {
            const data = doc.data();
            return { 
                id: doc.id, 
                ...data,
                orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                customer: data.customerName,
                amount: data.totalAmount,
            };
        });

        return NextResponse.json({ orders }, { status: 200 });

    } catch (error) {
        console.error("GET ORDERS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    console.log('[API][PATCH /orders] Request received.');
    try {
        const auth = getAuth();
        const firestore = await getFirestore();
        const { restaurantId, restaurantSnap } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { orderId, newStatus, deliveryBoyId } = await req.json();

        console.log(`[API][PATCH /orders] Body:`, { orderId, newStatus, deliveryBoyId });

        if (!orderId || !newStatus) {
            return NextResponse.json({ message: 'Order ID and new status are required.' }, { status: 400 });
        }
        
        const validStatuses = ["pending", "paid", "confirmed", "preparing", "dispatched", "delivered", "rejected"];
        if(!validStatuses.includes(newStatus)) {
            return NextResponse.json({ message: 'Invalid status provided.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        
        const orderDoc = await orderRef.get();
        if (!orderDoc.exists || orderDoc.data().restaurantId !== restaurantId) {
            return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
        }
        
        const updateData = { status: newStatus };
        let deliveryBoyData = null;

        if (newStatus === 'dispatched' && deliveryBoyId) {
            console.log(`[API][PATCH /orders] Dispatch logic started for order ${orderId}, rider ${deliveryBoyId}.`);
            updateData.deliveryBoyId = deliveryBoyId;
            const deliveryBoyRef = firestore.collection('restaurants').doc(restaurantId).collection('deliveryBoys').doc(deliveryBoyId);
            console.log(`[API][PATCH /orders] Rider ref path: ${deliveryBoyRef.path}`);
            
            const deliveryBoySnap = await deliveryBoyRef.get();
            console.log(`[API][PATCH /orders] Rider snap exists: ${deliveryBoySnap.exists}`);
            
            if (deliveryBoySnap.exists) {
                deliveryBoyData = deliveryBoySnap.data();
                console.log(`[API][PATCH /orders] Rider data found:`, deliveryBoyData);
            }
        }
        
        console.log(`[API][PATCH /orders] Updating order ${orderId} with:`, updateData);
        await orderRef.update(updateData);
        console.log(`[API][PATCH /orders] Order ${orderId} successfully updated in Firestore.`);
        
        const statusesThatNotifyCustomer = ['confirmed', 'preparing', 'dispatched', 'delivered', 'rejected'];
        if (statusesThatNotifyCustomer.includes(newStatus)) {
            const orderData = orderDoc.data();
            const restaurantData = restaurantSnap.data();
            
            const notificationPayload = {
                customerPhone: orderData.customerPhone,
                botPhoneNumberId: restaurantData.botPhoneNumberId,
                customerName: orderData.customerName,
                orderId: orderId,
                restaurantName: restaurantData.name,
                status: newStatus,
                deliveryBoy: deliveryBoyData
            };
            
            console.log('[API][PATCH /orders] Preparing to send notification with payload:', notificationPayload);

            sendOrderStatusUpdateToCustomer(notificationPayload).catch(e => {
                console.error(`[API LOG] Failed to send WhatsApp notification for order ${orderId} in the background:`, e.message);
            });
        }
        
        console.log(`[API][PATCH /orders] Request for order ${orderId} processed successfully.`);
        return NextResponse.json({ message: 'Order status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[API][PATCH /orders] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
