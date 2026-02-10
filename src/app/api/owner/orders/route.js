

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, getDatabase, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { sendOrderStatusUpdateToCustomer, sendRestaurantStatusChangeNotification } from '@/lib/notifications';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import Razorpay from 'razorpay';


// (Redundant verifyOwnerAndGetBusiness removed in favor of verifyOwnerWithAudit)

const OWNER_LIKE_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);

function callerHasPermission(callerRole, callerPermissions, permission) {
    if (!permission) return false;
    if (OWNER_LIKE_ROLES.has(callerRole)) return true;
    if (Array.isArray(callerPermissions) && callerPermissions.includes(permission)) return true;
    return hasPermission(callerRole, permission);
}

const VALID_STATUSES = new Set([
    'pending',
    'confirmed',
    'preparing',
    'prepared',
    'ready_for_pickup',
    'dispatched',
    'reached_restaurant',
    'picked_up',
    'on_the_way',
    'delivery_attempted',
    'failed_delivery',
    'returned_to_restaurant',
    'delivered',
    'rejected',
    'ready',
    'Ready',
]);

function getAllowedNextStatuses(orderData = {}) {
    const isPickup = orderData.deliveryType === 'pickup';
    const isDelivery = orderData.deliveryType === 'delivery';

    if (isPickup) {
        return {
            pending: new Set(['confirmed', 'rejected']),
            confirmed: new Set(['preparing']),
            preparing: new Set(['ready_for_pickup']),
            ready_for_pickup: new Set(['picked_up']),
        };
    }

    if (isDelivery) {
        return {
            pending: new Set(['confirmed', 'rejected']),
            confirmed: new Set(['preparing']),
            preparing: new Set(['prepared']),
            prepared: new Set(['ready_for_pickup']),
            ready_for_pickup: new Set(['dispatched']),
            dispatched: new Set(['delivered']),
        };
    }

    // Dine-in / other internal flows remain backward-compatible.
    return {
        pending: new Set(['confirmed', 'rejected']),
        confirmed: new Set(['preparing']),
        preparing: new Set(['ready', 'ready_for_pickup']),
        ready: new Set(['delivered']),
    };
}

function canTransition(orderData, fromStatus, toStatus) {
    if (fromStatus === toStatus) return true;
    if (toStatus === 'rejected') return fromStatus === 'pending';
    const allowedNextStatuses = getAllowedNextStatuses(orderData);
    return !!allowedNextStatuses[fromStatus]?.has(toStatus);
}

function redactOrderForViewer(orderData = {}, canViewCustomerDetails = true, canViewPaymentDetails = true) {
    const redacted = { ...orderData };

    if (!canViewCustomerDetails) {
        delete redacted.customerName;
        delete redacted.customerPhone;
        delete redacted.customerAddress;
        delete redacted.customerId;
        delete redacted.userId;
        delete redacted.customer;
    }

    if (!canViewPaymentDetails) {
        delete redacted.paymentDetails;
        delete redacted.paymentMethod;
        delete redacted.paymentStatus;
        delete redacted.subtotal;
        delete redacted.cgst;
        delete redacted.sgst;
        delete redacted.deliveryCharge;
        delete redacted.discount;
        delete redacted.totalAmount;
        delete redacted.amount;
    }

    return redacted;
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();

        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('id');
        const customerId = searchParams.get('customerId');

        const { uid, businessId, businessSnap, collectionName, callerRole, callerPermissions } = await verifyOwnerWithAudit(
            req,
            orderId ? 'view_order_details' : 'view_orders',
            orderId ? { orderId, customerId } : { customerId }
        );

        if (!callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_ORDERS)) {
            return NextResponse.json({ message: 'Access Denied: You cannot view orders.' }, { status: 403 });
        }

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
            const canViewCustomerDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_CUSTOMERS);
            const canViewPaymentDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_PAYMENTS);

            const redactedOrderData = redactOrderForViewer(orderData, canViewCustomerDetails, canViewPaymentDetails);

            // If customerId is provided, fetch customer details as well
            let customerData = null;
            if (customerId && canViewCustomerDetails) {
                const businessCollectionName = businessData.businessType === 'shop' ? 'shops' : (businessData.businessType === 'street-vendor' ? 'street_vendors' : 'restaurants');
                const customerRef = firestore.collection(businessCollectionName).doc(businessId).collection('customers').doc(customerId);
                const customerSnap = await customerRef.get();
                if (customerSnap.exists) {
                    customerData = customerSnap.data();
                }
            }


            return NextResponse.json({
                order: redactedOrderData,
                restaurant: businessData,
                customer: customerData,
                canViewCustomerDetails,
                canViewPaymentDetails,
            }, { status: 200 });
        }

        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const canViewCustomerDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_CUSTOMERS);
        const canViewPaymentDetails = callerHasPermission(callerRole, callerPermissions, PERMISSIONS.VIEW_PAYMENTS);

        const ordersRef = firestore.collection('orders');
        // Exclude orders with status 'awaiting_payment' (payment not completed yet)
        let query = ordersRef
        if (customerId) {
            console.log(`[API] Fetching orders for customerId: ${customerId} (restaurantId: ${businessId})`);

            // ✅ FIXED: Using indexed query with .orderBy and .limit
            const customerQuery = ordersRef
                .where('restaurantId', '==', businessId)
                .where('customerId', '==', customerId)
                .orderBy('orderDate', 'desc')
                .limit(20);

            let snap = await customerQuery.get();

            // Fallback: If no orders found, try querying by 'userId' (common legacy field name)
            if (snap.empty) {
                console.log(`[API] No orders found with customerId, trying userId...`);
                const userIdQuery = ordersRef
                    .where('restaurantId', '==', businessId)
                    .where('userId', '==', customerId)
                    .orderBy('orderDate', 'desc')
                    .limit(20);
                snap = await userIdQuery.get();
            }

            console.log(`[API] Found ${snap.size} orders for customer via indexed query.`);

            const orders = snap.docs.map(doc => {
                const data = doc.data();
                const statusHistory = (data.statusHistory || []).map(h => ({
                    ...h,
                    timestamp: h.timestamp && typeof h.timestamp.toDate === 'function' ? h.timestamp.toDate().toISOString() : h.timestamp,
                }));
                const itemsWithQty = (data.items || []).map(item => ({
                    ...item,
                    qty: item.quantity || item.qty,
                }));
                return redactOrderForViewer({
                    id: doc.id,
                    ...data,
                    items: itemsWithQty,
                    orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                    customer: data.customerName,
                    amount: data.totalAmount,
                    statusHistory,
                }, canViewCustomerDetails, canViewPaymentDetails);
            });

            return NextResponse.json({ orders }, { status: 200 });

        } else if (startDate && endDate) {
            // Ensure dates are valid Date objects
            const start = new Date(startDate);
            const end = new Date(endDate);
            // ✅ SCIPING: Fixed to include restaurantId
            query = query
                .where('restaurantId', '==', businessId)
                .where('orderDate', '>=', start)
                .where('orderDate', '<=', end)
                .orderBy('orderDate', 'desc');
        } else {
            // ✅ SCIPING: Fixed to include restaurantId
            query = query
                .where('restaurantId', '==', businessId)
                .orderBy('orderDate', 'desc')
                .limit(50);
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


            return redactOrderForViewer({
                id: doc.id,
                ...data,
                items: itemsWithQty,
                orderDate: data.orderDate?.toDate ? data.orderDate.toDate().toISOString() : data.orderDate,
                customer: data.customerName,
                amount: data.totalAmount,
                statusHistory,
            }, canViewCustomerDetails, canViewPaymentDetails);
        });

        return NextResponse.json({ orders }, { status: 200 });

    } catch (error) {
        console.error("GET ORDERS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, businessSnap, uid, callerRole, callerPermissions } = await verifyOwnerWithAudit(req, 'update_orders_patch', {}, true);
        const userRole = callerRole;

        const {
            idsToUpdate = [],
            orderIds = [],
            orderId,
            newStatus,
            deliveryBoyId,
            rejectionReason,
            paymentStatus,
            paymentMethod,
            isCashRefund,
            cashRefundOrderIds = [],
            shouldRefund,
            action // Added action field
        } = await req.json();

        // Support multiple Order ID field names for backward compatibility
        let finalIdsToUpdate = [...idsToUpdate];
        if (finalIdsToUpdate.length === 0 && orderIds.length > 0) finalIdsToUpdate = [...orderIds];
        if (finalIdsToUpdate.length === 0 && orderId) finalIdsToUpdate = [orderId];

        // 🔧 FIX: Map frontend action to backend flag
        const effectiveIsCashRefund = isCashRefund || action === 'markCashRefunded';
        const effectiveCashRefundIds = cashRefundOrderIds.length > 0 ? cashRefundOrderIds : finalIdsToUpdate;

        // Permission guard for payment/refund mutations
        if (paymentStatus && !callerHasPermission(userRole, callerPermissions, PERMISSIONS.PROCESS_PAYMENT)) {
            return NextResponse.json({ message: 'Access Denied: You cannot update payment status.' }, { status: 403 });
        }
        if (effectiveIsCashRefund && !callerHasPermission(userRole, callerPermissions, PERMISSIONS.REFUND_ORDER)) {
            return NextResponse.json({ message: 'Access Denied: You cannot mark refunds.' }, { status: 403 });
        }

        // 1. Gather all unique IDs to pre-fetch in parallel
        const allTargetIds = [...new Set([...finalIdsToUpdate, ...cashRefundOrderIds])];
        if (allTargetIds.length === 0) {
            return NextResponse.json({ message: 'No Order IDs provided.' }, { status: 400 });
        }

        const orderSnaps = await Promise.all(
            allTargetIds.map(id => firestore.collection('orders').doc(id).get())
        );
        const orderMap = new Map(orderSnaps.filter(s => s.exists).map(s => [s.id, s]));

        const batch = firestore.batch();
        const sideEffects = [];
        const businessData = businessSnap.data();

        // --- 2. Handle Cash Refund ---
        if (effectiveIsCashRefund && effectiveCashRefundIds.length > 0) {
            for (const id of effectiveCashRefundIds) {
                const orderSnap = orderMap.get(id);
                if (!orderSnap || orderSnap.data().restaurantId !== businessId) continue;

                batch.update(orderSnap.ref, {
                    cashRefunded: true,
                    cashRefundedAt: FieldValue.serverTimestamp()
                });
            }
        }

        // --- 3. Handle Payment Status Update ---
        if (paymentStatus && finalIdsToUpdate.length > 0) {
            for (const id of finalIdsToUpdate) {
                const orderSnap = orderMap.get(id);
                if (!orderSnap || orderSnap.data().restaurantId !== businessId) continue;

                const updateData = { paymentStatus };
                if (paymentMethod) updateData.paymentMethod = paymentMethod;
                batch.update(orderSnap.ref, updateData);
            }
        }

        // --- 4. Handle Order Status Update (Main Flow) ---
        if (newStatus && finalIdsToUpdate.length > 0) {
            let requiredPermission = PERMISSIONS.UPDATE_ORDER_STATUS;
            if (newStatus === 'rejected') {
                requiredPermission = PERMISSIONS.CANCEL_ORDER;
            } else if (newStatus === 'preparing') {
                requiredPermission = PERMISSIONS.MARK_ORDER_PREPARING;
            } else if (newStatus === 'prepared') {
                requiredPermission = PERMISSIONS.MARK_ORDER_READY;
            } else if (newStatus === 'ready_for_pickup' || newStatus === 'Ready') {
                requiredPermission = deliveryBoyId ? PERMISSIONS.ASSIGN_RIDER : PERMISSIONS.MARK_ORDER_READY;
            }

            if (!callerHasPermission(userRole, callerPermissions, requiredPermission)) {
                return NextResponse.json({
                    message: `Access Denied: Missing permission '${requiredPermission}'.`
                }, { status: 403 });
            }

            if (!VALID_STATUSES.has(newStatus)) {
                return NextResponse.json({ message: 'Invalid status provided.' }, { status: 400 });
            }

            if (deliveryBoyId && newStatus !== 'ready_for_pickup') {
                return NextResponse.json({
                    message: 'Rider can only be assigned while moving order to ready_for_pickup.'
                }, { status: 400 });
            }

            // Optional Rider Capacity Check (Only if assigning rider)
            if ((newStatus === 'dispatched' || newStatus === 'ready_for_pickup') && deliveryBoyId) {
                const activeOrdersSnap = await firestore.collection('orders')
                    .where('deliveryBoyId', '==', deliveryBoyId)
                    .where('status', 'in', ['ready_for_pickup', 'dispatched', 'reached_restaurant', 'picked_up', 'on_the_way', 'delivery_attempted'])
                    .get();

                if (activeOrdersSnap.size >= 5) {
                    return NextResponse.json({
                        message: `Rider already has ${activeOrdersSnap.size} active deliveries (max: 5)`,
                        suggestion: 'Please assign another rider.'
                    }, { status: 400 });
                }
            }

            for (const id of finalIdsToUpdate) {
                const orderSnap = orderMap.get(id);
                if (!orderSnap || orderSnap.data().restaurantId !== businessId) continue;

                const orderData = orderSnap.data();
                const currentStatus = orderData.status;

                if (!canTransition(orderData, currentStatus, newStatus)) {
                    return NextResponse.json({
                        message: `Invalid status transition for order ${id}: ${currentStatus} -> ${newStatus}.`
                    }, { status: 400 });
                }

                if (newStatus === 'ready_for_pickup' && orderData.deliveryType === 'delivery' && !deliveryBoyId) {
                    return NextResponse.json({
                        message: 'Delivery orders require rider assignment before moving to ready_for_pickup.'
                    }, { status: 400 });
                }

                const updateData = {
                    status: newStatus,
                    statusHistory: FieldValue.arrayUnion({
                        status: newStatus,
                        timestamp: new Date()
                    })
                };

                if (newStatus === 'rejected' && rejectionReason) updateData.rejectionReason = rejectionReason;
                if ((newStatus === 'dispatched' || newStatus === 'ready_for_pickup') && deliveryBoyId) updateData.deliveryBoyId = deliveryBoyId;

                if (orderData.deliveryType === 'dine-in' && newStatus === 'confirmed') {
                    updateData.dineInTabId = `tab_${Date.now()}`;
                }

                batch.update(orderSnap.ref, updateData);

                // Queue Side Effects (Notifications, Refunds, RTDB, Cache)
                sideEffects.push((async () => {
                    try {
                        const effects = [];

                        // A. Notifications
                        if (orderData.customerPhone) {
                            effects.push(sendOrderStatusUpdateToCustomer({
                                customerPhone: orderData.customerPhone,
                                botPhoneNumberId: businessData.botPhoneNumberId,
                                customerName: orderData.customerName,
                                orderId: id,
                                customerOrderId: orderData.customerOrderId,
                                restaurantName: businessData.name,
                                status: newStatus,
                                businessType: businessData.businessType || 'restaurant',
                                deliveryType: orderData.deliveryType,
                                trackingToken: orderData.trackingToken,
                                amount: orderData.totalAmount || 0,
                                orderDate: orderData.orderDate
                            }));
                        }

                        // B. Auto-Close Restaurant on Rejection (Only if reason matches)
                        if (newStatus === 'rejected' && rejectionReason === 'restaurant_closed') {
                            const bizCollection = businessData.businessType === 'shop' ? 'shops' : (businessData.businessType === 'street-vendor' ? 'street_vendors' : 'restaurants');
                            effects.push(firestore.collection(bizCollection).doc(businessId).update({ isOpen: false }));
                            effects.push(sendRestaurantStatusChangeNotification({
                                ownerPhone: businessData.ownerPhone,
                                botPhoneNumberId: businessData.botPhoneNumberId,
                                newStatus: false,
                                restaurantId: businessId,
                            }));
                        }

                        // C. Handle Razorpay Auto-Refund
                        if ((newStatus === 'rejected' || newStatus === 'cancelled') && orderData.paymentDetails) {
                            const paymentDetailsArray = Array.isArray(orderData.paymentDetails) ? orderData.paymentDetails : [orderData.paymentDetails].filter(Boolean);
                            const rzp = paymentDetailsArray.find(p => p.method === 'razorpay' && p.razorpay_payment_id);

                            if (rzp && !orderData.refundStatus && (shouldRefund !== false)) {
                                const razorpay = new Razorpay({
                                    key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                                    key_secret: process.env.RAZORPAY_KEY_SECRET,
                                });

                                const refund = await razorpay.payments.refund(rzp.razorpay_payment_id, {
                                    amount: Math.round((orderData.totalAmount || 0) * 100),
                                    notes: { orderId: id, reason: `Vendor ${newStatus} Action` }
                                });

                                effects.push(orderSnap.ref.update({
                                    refundStatus: 'completed',
                                    refundId: refund.id,
                                    refundDate: FieldValue.serverTimestamp()
                                }));
                                effects.push(firestore.collection('refunds').doc(refund.id).set({
                                    orderId: id,
                                    amount: orderData.totalAmount,
                                    status: refund.status,
                                    createdAt: FieldValue.serverTimestamp(),
                                    vendorId: businessId
                                }));
                            }
                        }

                        // D. RTDB Sync
                        const database = await getDatabase();
                        const isDelivery = orderData.deliveryType === 'delivery' || orderData.deliveryType === 'takeaway';
                        const trackingPath = isDelivery ? `delivery_tracking/${id}` : `dine_in_tracking/${id}`;
                        const isFinalized = ['delivered', 'rejected', 'cancelled', 'served', 'paid'].includes(newStatus);

                        if (isFinalized) {
                            effects.push(database.ref(trackingPath).remove());
                        } else {
                            effects.push(database.ref(trackingPath).set({
                                status: newStatus,
                                updatedAt: Date.now(),
                                token: orderData.trackingToken || 'temp_token'
                            }));
                        }

                        // E. Cache Invalidation (KV)
                        const { kv } = await import('@vercel/kv');
                        if (process.env.KV_REST_API_URL) {
                            effects.push(kv.del(`order_status:${id}`));
                        }

                        await Promise.allSettled(effects);
                    } catch (err) {
                        console.error(`[SideEffect Error] Order ${id}:`, err);
                    }
                })());
            }
        }

        await batch.commit();

        // CRITICAL: Await side effects to prevent Vercel execution freeze
        // "Fire-and-forget" is unsafe for refunds/notifications in serverless environment
        const results = await Promise.allSettled(sideEffects);

        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.error(`[API][PATCH /orders] ${failed.length} side effect chains had errors.`);
            failed.forEach((f, idx) => console.error(`   Effect ${idx} error:`, f.reason));
        }

        return NextResponse.json({
            message: 'Orders updated successfully.',
            processedCount: orderMap.size
        }, { status: 200 });

    } catch (error) {
        console.error("[API][PATCH /orders] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
