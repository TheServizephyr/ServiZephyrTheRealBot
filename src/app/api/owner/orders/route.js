

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, getDatabase, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendOrderStatusUpdateToCustomer } from '@/lib/notifications';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import Razorpay from 'razorpay';


async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

    // --- ADMIN IMPERSONATION & EMPLOYEE ACCESS LOGIC ---
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing orders for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }

        console.log(`[API Employee Access] ${uid} accessing ${employeeOfOwnerId}'s orders`);
        targetOwnerId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
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

        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('id');
        const customerId = searchParams.get('customerId');

        const { uid, businessId, businessSnap, collectionName } = await verifyOwnerWithAudit(
            req,
            orderId ? 'view_order_details' : 'view_orders',
            orderId ? { orderId, customerId } : { customerId }
        );

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

        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        const ordersRef = firestore.collection('orders');
        // Exclude orders with status 'awaiting_payment' (payment not completed yet)
        let query = ordersRef
            .where('restaurantId', '==', businessId)
            .where('status', '!=', 'awaiting_payment');

        if (startDate && endDate) {
            // Ensure dates are valid Date objects
            const start = new Date(startDate);
            const end = new Date(endDate);
            query = query.where('orderDate', '>=', start).where('orderDate', '<=', end).orderBy('orderDate', 'desc');
        } else {
            query = query.orderBy('orderDate', 'desc').limit(50);
        }

        const ordersSnap = await query.get();

        const orders = ordersSnap.docs.map(doc => {
            const data = doc.data();
            const statusHistory = (data.statusHistory || []).map(h => ({
                ...h,
                timestamp: h.timestamp && typeof h.timestamp.toDate === 'function' ? h.timestamp.toDate().toISOString() : h.timestamp,
            }));

            // Return complete item data (needed for refund calculations)
            const itemsWithQty = (data.items || []).map(item => ({
                ...item, // Keep all original fields
                qty: item.quantity || item.qty, // Normalize quantity field
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

        const body = await req.json();
        console.log(`[API][PATCH /orders] Body:`, body);

        const { orderId, orderIds, newStatus, deliveryBoyId, rejectionReason, action, shouldRefund, paymentStatus, paymentMethod } = body;

        const { businessId, businessSnap } = await verifyOwnerWithAudit(
            req,
            'update_order_status',
            { orderId, orderIds, newStatus, rejectionReason, action, paymentStatus }
        );

        const idsToUpdate = orderIds && orderIds.length > 0 ? orderIds : (orderId ? [orderId] : []);

        // Handle markCashRefunded action
        if (action === 'markCashRefunded') {
            if (idsToUpdate.length === 0) {
                return NextResponse.json({ message: 'Order ID(s) required.' }, { status: 400 });
            }

            const batch = firestore.batch();
            for (const id of idsToUpdate) {
                const orderRef = firestore.collection('orders').doc(id);
                const orderDoc = await orderRef.get();
                if (!orderDoc.exists || orderDoc.data().restaurantId !== businessId) {
                    console.warn(`[API][PATCH /orders] Skipping order ${id}: Not found or access denied.`);
                    continue;
                }

                batch.update(orderRef, {
                    cashRefunded: true,
                    cashRefundedAt: FieldValue.serverTimestamp()
                });
            }

            await batch.commit();
            return NextResponse.json({ message: 'Cash refund marked successfully.' });
        }

        // Handle payment status update (for dine-in mark as paid)
        if (paymentStatus && idsToUpdate.length > 0) {
            const batch = firestore.batch();
            for (const id of idsToUpdate) {
                const orderRef = firestore.collection('orders').doc(id);
                const orderDoc = await orderRef.get();
                if (!orderDoc.exists || orderDoc.data().restaurantId !== businessId) {
                    console.warn(`[API][PATCH /orders] Skipping order ${id}: Not found or access denied.`);
                    continue;
                }

                const updateData = { paymentStatus };
                if (paymentMethod) {
                    updateData.paymentMethod = paymentMethod;
                }

                batch.update(orderRef, updateData);
            }

            await batch.commit();
            return NextResponse.json({ message: 'Payment status updated successfully.' });
        }

        if (idsToUpdate.length === 0 || !newStatus) {
            return NextResponse.json({ message: 'Order ID(s) and new status are required.' }, { status: 400 });
        }

        const validStatuses = [
            "pending", "confirmed", "preparing", "dispatched",
            "reached_restaurant", "picked_up", "on_the_way", // ✅ STEP 4: New pickup flow statuses
            "delivery_attempted", "failed_delivery", "returned_to_restaurant", // ✅ STEP 5: Failure flow
            "delivered", "rejected", "ready_for_pickup", "Ready"
        ];
        if (!validStatuses.includes(newStatus)) {
            return NextResponse.json({ message: 'Invalid status provided.' }, { status: 400 });
        }

        const batch = firestore.batch();
        let deliveryBoyData = null;

        // ✅ FIX: Allow checks for 'ready_for_pickup' (New Flow) or 'dispatched' (Old Flow)
        if ((newStatus === 'dispatched' || newStatus === 'ready_for_pickup') && deliveryBoyId) {
            console.log(`[API][PATCH /orders] Dispatch logic started for rider ${deliveryBoyId}.`);
            const businessCollectionName = businessSnap.data().businessType === 'shop' ? 'shops' : (businessSnap.data().businessType === 'street-vendor' ? 'street_vendors' : 'restaurants');
            const deliveryBoyRef = firestore.collection(businessCollectionName).doc(businessId).collection('deliveryBoys').doc(deliveryBoyId);

            const deliveryBoySnap = await deliveryBoyRef.get();
            if (deliveryBoySnap.exists) {
                deliveryBoyData = deliveryBoySnap.data();

                // ✅ STEP 6B: Check rider capacity before assignment
                const activeOrdersQuery = firestore.collection('orders')
                    .where('deliveryBoyId', '==', deliveryBoyId)
                    .where('status', 'in', [
                        'ready_for_pickup', 'dispatched', 'reached_restaurant', 'picked_up', 'on_the_way', 'delivery_attempted'
                    ]);

                const activeOrdersSnap = await activeOrdersQuery.get();
                const activeCount = activeOrdersSnap.size;

                const MAX_ACTIVE_ORDERS = 5; // Hard safety limit

                if (activeCount >= MAX_ACTIVE_ORDERS) {
                    console.warn(`[API][PATCH /orders] Rider ${deliveryBoyId} already has ${activeCount} active orders (max: ${MAX_ACTIVE_ORDERS}).`);
                    return NextResponse.json({
                        message: `Rider already has ${activeCount} active deliveries (maximum: ${MAX_ACTIVE_ORDERS})`,
                        suggestion: 'Please assign another rider or wait for current deliveries to complete',
                        riderActiveOrders: activeCount
                    }, { status: 400 });
                }

                console.log(`[API][PATCH /orders] Rider ${deliveryBoyId} capacity check passed (${activeCount}/${MAX_ACTIVE_ORDERS} orders).`);

                // ✅ REMOVED: Status update in subcollection
                // Rider status is now ONLY managed in drivers/{uid}.status
                // This prevents dual-storage sync bugs
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
            if ((newStatus === 'dispatched' || newStatus === 'ready_for_pickup') && deliveryBoyId) {
                updateData.deliveryBoyId = deliveryBoyId;
            }

            if (orderData.deliveryType === 'dine-in' && newStatus === 'confirmed') {
                const newTabId = `tab_${Date.now()}`;
                updateData.dineInTabId = newTabId;
            }

            batch.update(orderRef, updateData);

            // Auto-refund for cancelled/rejected orders with online payment
            if ((newStatus === 'rejected' || newStatus === 'cancelled') && orderData.paymentDetails) {
                const paymentDetailsArray = Array.isArray(orderData.paymentDetails) ? orderData.paymentDetails : [orderData.paymentDetails].filter(Boolean);
                const razorpayPayment = paymentDetailsArray.find(p => p.method === 'razorpay' && p.razorpay_payment_id);

                if (razorpayPayment && !orderData.refundStatus) {
                    // Check if vendor chose to refund (default true for backward compatibility)
                    const shouldProcessRefund = shouldRefund !== undefined ? shouldRefund : true;

                    if (shouldProcessRefund) {
                        console.log(`[API][PATCH /orders] Auto-refunding order ${id} due to ${newStatus} status`);

                        try {
                            // Initialize Razorpay
                            const razorpay = new Razorpay({
                                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                                key_secret: process.env.RAZORPAY_KEY_SECRET,
                            });

                            // Process full refund
                            const refundAmount = orderData.totalAmount || orderData.grandTotal || 0;
                            const paymentId = razorpayPayment.razorpay_payment_id;

                            const refundData = await razorpay.payments.refund(paymentId, {
                                amount: Math.round(refundAmount * 100), // Convert to paise
                                speed: 'normal',
                                notes: {
                                    orderId: id,
                                    reason: `Order ${newStatus} by vendor`,
                                    refundType: 'full',
                                    autoRefund: true
                                }
                            });

                            console.log(`[API][PATCH /orders] Auto-refund successful: ${refundData.id}`);

                            // Update order with refund info
                            batch.update(orderRef, {
                                refundStatus: 'completed',
                                refundAmount: refundAmount,
                                refundReason: `Order ${newStatus} by vendor`,
                                refundDate: FieldValue.serverTimestamp(),
                                refundId: refundData.id,
                                autoRefunded: true
                            });

                            // Create refund record
                            const refundRecord = {
                                refundId: refundData.id,
                                orderId: id,
                                paymentId,
                                amount: refundAmount,
                                currency: 'INR',
                                status: refundData.status,
                                refundType: 'full',
                                reason: `Order ${newStatus} by vendor`,
                                notes: 'Auto-refund on cancellation',
                                vendorId: businessId,
                                customerId: orderData.customerId || orderData.userId,
                                autoRefund: true,
                                createdAt: FieldValue.serverTimestamp(),
                                processedAt: refundData.created_at ? new Date(refundData.created_at * 1000) : FieldValue.serverTimestamp()
                            };

                            await firestore.collection('refunds').doc(refundData.id).set(refundRecord);
                        } catch (refundError) {
                            console.error(`[API][PATCH /orders] Auto-refund failed for order ${id}:`, refundError);
                            // Don't fail the entire order update if refund fails
                            // Vendor can manually refund later
                        }
                    } else {
                        // Vendor chose NOT to refund
                        console.log(`[API][PATCH /orders] No refund for order ${id} - vendor decision`);
                        batch.update(orderRef, {
                            refundStatus: 'not_applicable',
                            noRefundReason: 'vendor_decision',
                            noRefundDate: FieldValue.serverTimestamp()
                        });
                    }
                }
            }

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
                    // ✅ NEW: Pass deliveryType to allow conditional logic (e.g. suppressing 'ready_for_pickup' for delivery)
                    deliveryType: orderData.deliveryType,
                    trackingToken: orderData.trackingToken // ✅ Pass token for secure URL
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

        // ✅ RTDB Write for Real-time Tracking (NEW!)
        console.log('[RTDB] Starting RTDB write for', idsToUpdate.length, 'orders');
        try {
            const database = await getDatabase();
            console.log('[RTDB] Database instance obtained successfully');

            for (const id of idsToUpdate) {
                console.log(`[RTDB] Processing order ${id}`);
                const orderRef = firestore.collection('orders').doc(id);
                const orderSnap = await orderRef.get();
                const orderData = orderSnap.data();

                if (!orderData) {
                    console.warn(`[RTDB] No orderData found for ${id}`);
                    continue;
                }

                console.log(`[RTDB] Order ${id} deliveryType:`, orderData.deliveryType);

                const isDelivery = orderData.deliveryType === 'delivery' || orderData.deliveryType === 'takeaway';
                const isDineIn = orderData.deliveryType === 'dine-in';

                console.log(`[RTDB] Order ${id} - isDelivery:${isDelivery}, isDineIn:${isDineIn}`);

                if (isDelivery) {
                    const trackingRef = database.ref(`delivery_tracking/${id}`);
                    await trackingRef.set({
                        status: newStatus,
                        updatedAt: Date.now(),
                        token: orderData.trackingToken || 'temp_token' // Use real token from Firestore
                    });
                    console.log(`[RTDB] ✅ Delivery tracking updated for ${id} with status: ${newStatus}`);
                } else if (isDineIn) {
                    const trackingRef = database.ref(`dine_in_tracking/${id}`);
                    await trackingRef.set({
                        status: newStatus,
                        updatedAt: Date.now(),
                        tableNumber: orderData.tableId || 'N/A',
                        token: orderData.trackingToken || 'temp_token' // Use real token from Firestore
                    });
                    console.log(`[RTDB] ✅ Dine-in tracking updated for ${id} with status: ${newStatus}`);
                } else {
                    console.warn(`[RTDB] Order ${id} has unknown deliveryType: ${orderData.deliveryType}`);
                }
            }
            console.log('[RTDB] All RTDB writes completed');
        } catch (rtdbError) {
            // Non-fatal - Firestore is source of truth
            console.error('[API][PATCH /orders] ❌ RTDB write failed:', rtdbError);
            console.error('[RTDB] Error stack:', rtdbError.stack);
        }

        // ✅ CRITICAL FIX: Invalidate cache for all updated orders
        // Without this, customers see stale 'pending' status for 60s after restaurant changes to 'rejected'
        try {
            const { kv } = await import('@vercel/kv');
            const isKvAvailable = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

            if (isKvAvailable) {
                for (const id of idsToUpdate) {
                    const cacheKey = `order_status:${id}`;
                    await kv.del(cacheKey);
                    console.log(`[API][PATCH /orders] ✅ Cache invalidated for ${cacheKey}`);
                }
            }
        } catch (cacheError) {
            console.warn('[API][PATCH /orders] Cache invalidation failed (non-fatal):', cacheError);
            // Non-fatal - status update already succeeded
        }

        return NextResponse.json({ message: 'Order status updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[API][PATCH /orders] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
