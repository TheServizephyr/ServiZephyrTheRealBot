

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendOrderStatusUpdateToCustomer } from '@/lib/notifications';


async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

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
    } else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { uid: targetOwnerId, businessId: doc.id, businessSnap: doc, isAdmin: userRole === 'admin' };
        }
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

            if (orderData.orderDate && typeof orderData.orderDate.toDate === 'function') {
                orderData = { ...orderData, orderDate: orderData.orderDate.toDate().toISOString() };
            }

            const businessData = businessSnap.data();

            // If customerId is provided, fetch customer details as well
            let customerData = null;
            if (customerId) {
                const businessCollectionName = businessData.businessType === 'shop' ? 'shops' : (businessData.businessType === 'street-vendor' ? 'street_vendors' : 'restaurants');
                const customerRef = firestore.collection(businessCollectionName).doc(businessId).collection('customers').doc(customerId);
                const customerSnap = await customerRef.get();
                if (customerSnap.exists) {
                    customerData = customerSnap.data();
                }
            }


            return NextResponse.json({ order: orderData, restaurant: businessData, customer: customerData }, { status: 200 });
        }

        const ordersRef = firestore.collection('orders');
        const ordersSnap = await ordersRef.where('restaurantId', '==', businessId).orderBy('orderDate', 'desc').limit(50).get();

        const orders = ordersSnap.docs.map(doc => {
            const data = doc.data();
            const statusHistory = (data.statusHistory || []).map(h => ({
                ...h,
                timestamp: h.timestamp && typeof h.timestamp.toDate === 'function' ? h.timestamp.toDate().toISOString() : h.timestamp,
            }));

            // Correctly map quantity to items
            const itemsWithQty = (data.items || []).map(item => ({
                name: item.name,
                price: item.price,
                qty: item.quantity,
            }));


            return {
                id: doc.id,
                ...data,
                items: itemsWithQty,
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
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, businessSnap } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const body = await req.json();
        console.log(`[API][PATCH /orders] Body:`, body);

        const { orderId, orderIds, newStatus, deliveryBoyId, rejectionReason } = body;

        const idsToUpdate = orderIds && orderIds.length > 0 ? orderIds : (orderId ? [orderId] : []);

        if (idsToUpdate.length === 0 || !newStatus) {
            return NextResponse.json({ message: 'Order ID(s) and new status are required.' }, { status: 400 });
        }

        const validStatuses = ["pending", "confirmed", "preparing", "dispatched", "delivered", "rejected", "ready_for_pickup", "picked_up", "Ready"];
        if (!validStatuses.includes(newStatus)) {
            return NextResponse.json({ message: 'Invalid status provided.' }, { status: 400 });
        }

        const batch = firestore.batch();
        let deliveryBoyData = null;

        if (newStatus === 'dispatched' && deliveryBoyId) {
            console.log(`[API][PATCH /orders] Dispatch logic started for riders ${deliveryBoyId}.`);
            const businessCollectionName = businessSnap.data().businessType === 'shop' ? 'shops' : (businessSnap.data().businessType === 'street-vendor' ? 'street_vendors' : 'restaurants');
            const deliveryBoyRef = firestore.collection(businessCollectionName).doc(businessId).collection('deliveryBoys').doc(deliveryBoyId);

            const deliveryBoySnap = await deliveryBoyRef.get();
            if (deliveryBoySnap.exists) {
                deliveryBoyData = deliveryBoySnap.data();
                batch.update(deliveryBoyRef, { status: 'On Delivery' });
            }
        }

        for (const id of idsToUpdate) {
            const orderRef = firestore.collection('orders').doc(id);
            const orderDoc = await orderRef.get();
            if (!orderDoc.exists || orderDoc.data().restaurantId !== businessId) {
                console.warn(`[API][PATCH /orders] Skipping order ${id}: Not found or access denied.`);
                continue; // Skip this order
            }
            const orderData = orderDoc.data();

            const updateData = {
                status: newStatus,
                statusHistory: FieldValue.arrayUnion({
                    status: newStatus,
                    timestamp: new Date()
                })
            };

            if (newStatus === 'rejected' && rejectionReason) {
                updateData.rejectionReason = rejectionReason;
            }
            if (newStatus === 'dispatched' && deliveryBoyId) {
                updateData.deliveryBoyId = deliveryBoyId;
            }

            if (orderData.deliveryType === 'dine-in' && newStatus === 'confirmed') {
                const newTabId = `tab_${Date.now()}`;
                updateData.dineInTabId = newTabId;
            }

            batch.update(orderRef, updateData);

            const businessData = businessSnap.data();

            if (orderData.customerPhone) {
                console.log(`[API LOG] Preparing to send notification for status '${newStatus}' for order ${id}.`);
                const notificationPayload = {
                    customerPhone: orderData.customerPhone,
                    botPhoneNumberId: businessData.botPhoneNumberId,
                    customerName: orderData.customerName,
                    orderId: id,
                    restaurantName: businessData.name,
                    status: newStatus,
                    deliveryBoy: deliveryBoyData,
                    businessType: businessData.businessType || 'restaurant',
                };

                sendOrderStatusUpdateToCustomer(notificationPayload).catch(e =>
                    console.error(`[API LOG] CRITICAL: Failed to send WhatsApp notification for order ${id}. Error:`, e.message)
                );
            } else {
                console.warn(`[API LOG] No customer phone for order ${id}, skipping notification.`);
            }
        }

        await batch.commit();
        console.log(`[API][PATCH /orders] Batch update completed successfully for ${idsToUpdate.length} orders.`);

        return NextResponse.json({ message: 'Order status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[API][PATCH /orders] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
