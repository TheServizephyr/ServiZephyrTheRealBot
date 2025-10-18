

import { NextResponse } from 'next/server';
import { firestore as adminFirestore } from 'firebase-admin';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import { sendOrderStatusUpdateToCustomer } from '@/lib/notifications';


async function verifyOwnerAndGetBusiness(req, auth, firestore) {
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
        return { uid: targetOwnerId, businessId: doc.id, businessSnap: doc, isAdmin: userRole === 'admin' };
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, businessSnap: doc, isAdmin: userRole === 'admin' };
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        
        const { uid, businessId, businessSnap } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        
        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('id');
        const customerId = searchParams.get('customerId');
        
        if (orderId) {
            const orderRef = firestore.collection('orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) {
                return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
            }
            
            let orderData = orderDoc.data();
            if (orderData.restaurantId !== businessId) {
                return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
            }
            
            if (orderData.orderDate && orderData.orderDate.toDate) {
                orderData = { ...orderData, orderDate: orderData.orderDate.toDate().toISOString() };
            }

            const businessData = businessSnap.data();
            
            // If customerId is provided, fetch customer details as well
            let customerData = null;
            if (customerId) {
                const businessCollectionName = businessData.businessType === 'shop' ? 'shops' : 'restaurants';
                const customerRef = firestore.collection(businessCollectionName).doc(businessId).collection('customers').doc(customerId);
                const customerSnap = await customerRef.get();
                if (customerSnap.exists) {
                    customerData = customerSnap.data();
                }
            }


            return NextResponse.json({ order: orderData, restaurant: businessData, customer: customerData }, { status: 200 });
        }

        const ordersRef = firestore.collection('orders');
        const ordersSnap = await ordersRef.where('restaurantId', '==', businessId).orderBy('orderDate', 'desc').get();

        const orders = ordersSnap.docs.map(doc => {
            const data = doc.data();
            const statusHistory = (data.statusHistory || []).map(h => ({
                ...h,
                timestamp: h.timestamp?.toDate ? h.timestamp.toDate().toISOString() : h.timestamp,
            }));
            return { 
                id: doc.id, 
                ...data,
                orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                customer: data.customerName,
                amount: data.totalAmount,
                statusHistory,
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
        const { businessId, businessSnap } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { orderId, newStatus, deliveryBoyId, rejectionReason } = await req.json();

        console.log(`[API][PATCH /orders] Body:`, { orderId, newStatus, deliveryBoyId, rejectionReason });

        if (!orderId || !newStatus) {
            return NextResponse.json({ message: 'Order ID and new status are required.' }, { status: 400 });
        }
        
        const validStatuses = ["pending", "paid", "confirmed", "preparing", "dispatched", "delivered", "rejected"];
        if(!validStatuses.includes(newStatus)) {
            return NextResponse.json({ message: 'Invalid status provided.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        
        const orderDoc = await orderRef.get();
        if (!orderDoc.exists || orderDoc.data().restaurantId !== businessId) {
            return NextResponse.json({ message: 'Access denied to this order.' }, { status: 403 });
        }
        
        const updateData = { 
            status: newStatus,
            statusHistory: adminFirestore.FieldValue.arrayUnion({
                status: newStatus,
                timestamp: new Date()
            })
        };
        let deliveryBoyData = null;

        if (newStatus === 'rejected' && rejectionReason) {
            updateData.rejectionReason = rejectionReason;
        }

        if (newStatus === 'dispatched' && deliveryBoyId) {
            console.log(`[API][PATCH /orders] Dispatch logic started for order ${orderId}, rider ${deliveryBoyId}.`);
            const businessCollectionName = businessSnap.data().businessType === 'shop' ? 'shops' : 'restaurants';
            const deliveryBoyRef = firestore.collection(businessCollectionName).doc(businessId).collection('deliveryBoys').doc(deliveryBoyId);

            console.log(`[API][PATCH /orders] Rider ref path: ${deliveryBoyRef.path}`);
            
            const deliveryBoySnap = await deliveryBoyRef.get();
            console.log(`[API][PATCH /orders] Rider snap exists: ${deliveryBoySnap.exists}`);
            
            if (deliveryBoySnap.exists) {
                deliveryBoyData = deliveryBoySnap.data();
                updateData.deliveryBoyId = deliveryBoyId;
                console.log(`[API][PATCH /orders] Rider data found:`, deliveryBoyData);
            }
        }
        
        console.log(`[API][PATCH /orders] Updating order ${orderId} with:`, updateData);
        await orderRef.update(updateData);
        console.log(`[API][PATCH /orders] Order ${orderId} successfully updated in Firestore.`);
        
        const statusesThatNotifyCustomer = ['confirmed', 'preparing', 'dispatched', 'delivered', 'rejected'];
        if (statusesThatNotifyCustomer.includes(newStatus)) {
            const orderData = orderDoc.data();
            const businessData = businessSnap.data();
            
            const notificationPayload = {
                customerPhone: orderData.customerPhone,
                botPhoneNumberId: businessData.botPhoneNumberId,
                customerName: orderData.customerName,
                orderId: orderId,
                restaurantName: businessData.name,
                status: newStatus,
                deliveryBoy: deliveryBoyData,
                businessType: businessData.businessType || 'restaurant', // Pass business type
            };
            
            console.log('[API][PATCH /orders] Preparing to send notification with payload:', notificationPayload);

            try {
                await sendOrderStatusUpdateToCustomer(notificationPayload);
            } catch (notificationError) {
                // Log the error but don't crash the main process. The status is already updated.
                console.error(`[API LOG] CRITICAL: Failed to send WhatsApp notification for order ${orderId}, but status was updated successfully. Error:`, notificationError.message);
            }
        }
        
        console.log(`[API][PATCH /orders] Request for order ${orderId} processed successfully.`);
        return NextResponse.json({ message: 'Order status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[API][PATCH /orders] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


