
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { sendNewOrderToOwner } from '@/lib/notifications';
import crypto from 'crypto';
import https from 'https';
import { nanoid } from 'nanoid';


const generateSecureToken = async (firestore, customerPhone) => {
    console.log(`[Webhook RZP] generateSecureToken for phone: ${customerPhone}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity for tracking link
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry,
        type: 'tracking'
    });
    console.log(`[Webhook RZP] Token generated: ${token}`);
    return token;
};


async function makeRazorpayRequest(options, payload) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedData);
                    } else {
                        reject(parsedData);
                    }
                } catch (e) {
                    reject({ error: { description: `Failed to parse Razorpay response. Raw data: ${data}` } });
                }
            });
        });
        req.on('error', (e) => reject({ error: { description: e.message } }));
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

const handleSplitPayment = async (firestore, paymentEntity) => {
    const { order_id: razorpayOrderId, notes } = paymentEntity;
    const splitId = notes?.split_session_id;

    if (!splitId) {
        console.log(`[Webhook RZP] Not a split payment. No split_session_id found in notes for order ${razorpayOrderId}.`);
        return false;
    }

    console.log(`[Webhook RZP] Detected split payment for session ${splitId}.`);
    const splitRef = firestore.collection('split_payments').doc(splitId);

    try {
        await firestore.runTransaction(async (transaction) => {
            console.log(`[Webhook RZP] Starting Firestore transaction for split payment.`);
            const splitDoc = await transaction.get(splitRef);
            if (!splitDoc.exists) {
                console.error(`[Webhook RZP] CRITICAL: Split session ${splitId} not found in Firestore. Cannot process payment.`);
                return;
            }

            const splitData = splitDoc.data();
            const shares = splitData.shares || [];
            console.log(`[Webhook RZP] Found ${shares.length} shares in session ${splitId}.`);

            // --- FIX FOR PAY REMAINING ---
            const isPayRemaining = notes.type === 'pay_remaining';
            let sharesToUpdate = [];

            if (isPayRemaining) {
                console.log(`[Webhook RZP] 'Pay Remaining' webhook detected. Updating all pending shares.`);
                sharesToUpdate = shares.map((s, index) => s.status !== 'paid' ? index : -1).filter(index => index !== -1);
                console.log(`[Webhook RZP] Pay Remaining: Found ${sharesToUpdate.length} pending shares to update.`);
            } else {
                console.log(`[Webhook RZP] Searching for share with razorpay_order_id: ${razorpayOrderId}`);
                const shareIndex = shares.findIndex(s => s.razorpay_order_id === razorpayOrderId);
                if (shareIndex !== -1) {
                    console.log(`[Webhook RZP] Found matching share at index ${shareIndex}.`);
                    sharesToUpdate.push(shareIndex);
                } else {
                    console.warn(`[Webhook RZP] No share found for razorpay_order_id: ${razorpayOrderId}. Available IDs: ${shares.map(s => s.razorpay_order_id).join(', ')}`);
                }
            }

            if (sharesToUpdate.length === 0) {
                console.error(`[Webhook RZP] CRITICAL: No matching shares found for Razorpay order ${razorpayOrderId} in split ${splitId}. Aborting transaction.`);
                return; // Abort transaction
            }
            console.log(`[Webhook RZP] Matched Razorpay Order ID to share indices: ${sharesToUpdate.join(', ')}.`);

            sharesToUpdate.forEach(index => {
                shares[index].status = 'paid';
                shares[index].razorpay_payment_id = paymentEntity.id;
                console.log(`[Webhook RZP] Marked share ${index} as paid.`);
            });
            console.log(`[Webhook RZP] Shares marked as paid.`);

            const paidShares = shares.filter(s => s.status === 'paid');
            const isFullyPaid = paidShares.length === splitData.splitCount;
            console.log(`[Webhook RZP] ${paidShares.length}/${splitData.splitCount} shares are now paid.`);

            const updateData = { shares };

            // Always update base order with payment details
            const baseOrderRef = firestore.collection('orders').doc(splitData.baseOrderId);
            const baseOrderSnap = await transaction.get(baseOrderRef);

            if (baseOrderSnap.exists) {
                console.log(`[Webhook RZP] Base order ${splitData.baseOrderId} found. Updating payment details.`);
                const baseOrderData = baseOrderSnap.data();

                // Add separate payment details for each paid share
                const paymentDetailsToAdd = sharesToUpdate.map(index => ({
                    method: 'razorpay',
                    amount: shares[index].amount,
                    razorpay_payment_id: paymentEntity.id,
                    razorpay_order_id: shares[index].razorpay_order_id,
                    timestamp: new Date(),
                    status: 'paid',
                    split_share_index: index,
                    payer_name: shares[index].name || `Person ${index + 1}`
                }));

                const orderUpdate = {
                    paymentDetails: FieldValue.arrayUnion(...paymentDetailsToAdd)
                };

                if (isFullyPaid) {
                    console.log(`[Webhook RZP] All shares paid. Marking session ${splitId} as completed.`);
                    updateData.status = 'completed';

                    // Only update status to pending when fully paid
                    orderUpdate.status = 'pending';

                    const restaurantId = baseOrderData.restaurantId;
                    const businessType = baseOrderData.businessType;
                    const trackingToken = baseOrderData.trackingToken;

                    // Generate dineInToken for street vendors ONLY if order doesn't have one yet
                    let dineInToken = baseOrderData.dineInToken || null;
                    if (!dineInToken && businessType === 'street-vendor') {
                        const vendorRef = firestore.collection('street_vendors').doc(restaurantId);
                        const vendorDoc = await transaction.get(vendorRef);
                        if (vendorDoc.exists) {
                            const vendorData = vendorDoc.data();
                            const lastToken = vendorData.lastOrderToken || 0;
                            const newTokenNumber = lastToken + 1;
                            const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                            dineInToken = `${String(newTokenNumber)}-${alphabet[Math.floor(Math.random() * 26)]}${alphabet[Math.floor(Math.random() * 26)]}`;
                            transaction.update(vendorRef, { lastOrderToken: newTokenNumber });
                        }
                    }

                    if (dineInToken) {
                        orderUpdate.dineInToken = dineInToken;
                    }

                    // Add pending items if this is an add-on order
                    if (splitData.pendingItems && splitData.pendingItems.length > 0) {
                        console.log(`[Webhook RZP] Adding ${splitData.pendingItems.length} pending items to order ${splitData.baseOrderId}`);
                        const newItems = [...baseOrderData.items, ...splitData.pendingItems];
                        const newSubtotal = baseOrderData.subtotal + (splitData.pendingSubtotal || 0);
                        const newCgst = baseOrderData.cgst + (splitData.pendingCgst || 0);
                        const newSgst = baseOrderData.sgst + (splitData.pendingSgst || 0);
                        const newGrandTotal = baseOrderData.totalAmount + (splitData.pendingSubtotal + splitData.pendingCgst + splitData.pendingSgst);

                        orderUpdate.items = newItems;
                        orderUpdate.subtotal = newSubtotal;
                        orderUpdate.cgst = newCgst;
                        orderUpdate.sgst = newSgst;
                        orderUpdate.totalAmount = newGrandTotal;
                        orderUpdate.statusHistory = FieldValue.arrayUnion({
                            status: 'updated',
                            timestamp: new Date(),
                            notes: `Added ${splitData.pendingItems.length} item(s) via split payment`
                        });
                    }

                    if (trackingToken) {
                        updateData.trackingToken = trackingToken;
                    }
                    if (restaurantId) {
                        updateData.restaurantId = restaurantId;
                    }
                }

                transaction.update(baseOrderRef, orderUpdate);
            } else {
                console.warn(`[Webhook RZP] Base order ${splitData.baseOrderId} not found for split payment. Cannot update status.`);
            }

            transaction.update(splitRef, updateData);
            console.log(`[Webhook RZP] Transaction update prepared for split session.`);
        });
        console.log(`[Webhook RZP] Firestore transaction for split payment ${splitId} successful.`);
    } catch (error) {
        console.error(`[Webhook RZP] CRITICAL ERROR during split payment transaction for ${splitId}:`, error);
    }

    return true;
};


export async function POST(req) {
    console.log("[Webhook RZP] Received POST request.");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        console.error("[Webhook RZP] CRITICAL: RAZORPAY_WEBHOOK_SECRET is not set.");
        return NextResponse.json({ message: 'Webhook secret not configured' }, { status: 500 });
    }

    try {
        const body = await req.text();
        const signature = req.headers.get('x-razorpay-signature');

        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(body);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn(`[Webhook RZP] Invalid signature. Digest: ${digest}, Signature: ${signature}`);
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }
        console.log("[Webhook RZP] Signature verified successfully.");

        const eventData = JSON.parse(body);
        console.log(`[Webhook RZP] Event received: ${eventData.event}`);

        if (eventData.event === 'payment.captured') {
            const paymentEntity = eventData.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id;
            const paymentAmount = paymentEntity.amount;

            if (!razorpayOrderId) {
                console.warn("[Webhook RZP] 'order_id' not found in payment entity. Skipping.");
                return NextResponse.json({ status: 'ok' });
            }
            console.log(`[Webhook RZP] Processing payment for Razorpay Order ID: ${razorpayOrderId}`);

            const firestore = await getFirestore();

            const isSplitPayment = await handleSplitPayment(firestore, paymentEntity);
            if (isSplitPayment) {
                console.log(`[Webhook RZP] Split payment for order ${razorpayOrderId} handled successfully.`);
                return NextResponse.json({ status: 'ok', message: 'Split payment processed.' });
            } else {
                console.log(`[Webhook RZP] handleSplitPayment returned false for order ${razorpayOrderId}. Proceeding to normal flow.`);
            }

            // Handle Add-on Payment
            const notes = paymentEntity.notes;
            if (notes && notes.type === 'addon') {
                console.log(`[Webhook RZP] Add-on payment detected for order ${notes.orderId}`);
                const orderId = notes.orderId;

                let itemsToAdd = [];
                try {
                    itemsToAdd = JSON.parse(notes.items);
                } catch (e) {
                    console.error("[Webhook RZP] Failed to parse items from notes:", e);
                }

                const addOnAmount = paymentEntity.amount / 100; // Amount in rupees

                const orderRef = firestore.collection('orders').doc(orderId);

                await firestore.runTransaction(async (transaction) => {
                    const orderDoc = await transaction.get(orderRef);
                    if (!orderDoc.exists) throw new Error("Order not found for add-on.");

                    const orderData = orderDoc.data();
                    const newItems = [...(orderData.items || []), ...itemsToAdd];

                    // Update totals
                    const newSubtotal = (orderData.subtotal || 0) + (parseFloat(notes.subtotal) || 0);
                    const newCgst = (orderData.cgst || 0) + (parseFloat(notes.cgst) || 0);
                    const newSgst = (orderData.sgst || 0) + (parseFloat(notes.sgst) || 0);
                    const newGrandTotal = (orderData.totalAmount || 0) + (parseFloat(notes.grandTotal) || 0);

                    const paymentDetail = {
                        method: 'razorpay',
                        amount: addOnAmount,
                        razorpay_payment_id: paymentEntity.id,
                        razorpay_order_id: razorpayOrderId,
                        timestamp: new Date(),
                        status: 'paid',
                        notes: 'Add-on payment'
                    };

                    transaction.update(orderRef, {
                        items: newItems,
                        subtotal: newSubtotal,
                        cgst: newCgst,
                        sgst: newSgst,
                        totalAmount: newGrandTotal,
                        paymentDetails: FieldValue.arrayUnion(paymentDetail),
                        statusHistory: FieldValue.arrayUnion({
                            status: 'updated',
                            timestamp: new Date(),
                            notes: `Added ${itemsToAdd.length} item(s) via online add-on`
                        })
                    });
                });

                console.log(`[Webhook RZP] Add-on items added to order ${orderId} successfully.`);
                return NextResponse.json({ status: 'ok', message: 'Add-on processed.' });
            }

            const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
            const key_secret = process.env.RAZORPAY_KEY_SECRET;
            const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');

            const rzpOrder = await makeRazorpayRequest({
                hostname: 'api.razorpay.com', port: 443, path: `/v1/orders/${razorpayOrderId}`, method: 'GET',
                headers: { 'Authorization': `Basic ${credentials}` }
            });

            // If servizephyr_payload is missing, it's an add-on payment
            if (!rzpOrder.notes?.servizephyr_payload) {
                const orderRef = firestore.collection('orders').doc(rzpOrder.receipt);
                console.log(`[Webhook RZP] No servizephyr_payload. Assuming add-on payment for existing order ${rzpOrder.receipt}.`);
                await orderRef.update({
                    paymentDetails: FieldValue.arrayUnion({ method: 'razorpay', amount: paymentAmount / 100, timestamp: new Date(), razorpay_payment_id: paymentId, status: 'paid' })
                });
                return NextResponse.json({ status: 'ok', message: 'Add-on payment processed.' });
            }

            const payload = JSON.parse(rzpOrder.notes.servizephyr_payload);
            const { customerDetails, billDetails, restaurantId, userId, businessType, isStreetVendorOrder, customNotes, trackingToken } = payload;
            const isNewUser = payload.isNewUser;

            const orderRef = firestore.collection('orders').doc(rzpOrder.receipt);
            const batch = firestore.batch();

            if (trackingToken) {
                // Ensure tracking token matches if provided
                const tokenRef = firestore.collection('auth_tokens').doc(trackingToken);
                batch.set(tokenRef, {
                    phone: customerDetails.phone,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                    type: 'tracking',
                    orderId: orderRef.id
                }, { merge: true });
            }

            if (isNewUser && customerDetails.phone) {
                const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(customerDetails.phone);
                batch.set(unclaimedUserRef, {
                    name: customerDetails.name, phone: customerDetails.phone, addresses: [customerDetails.address],
                    createdAt: FieldValue.serverTimestamp(),
                    orderedFrom: FieldValue.arrayUnion({ restaurantId: restaurantId, restaurantName: rzpOrder.notes?.restaurantName || 'Unknown', businessType: businessType })
                }, { merge: true });
            }

            const subtotal = billDetails.subtotal || 0;
            const loyaltyDiscount = billDetails.loyaltyDiscount || 0;
            const pointsEarned = Math.floor(subtotal / 100) * 10;
            const pointsSpent = loyaltyDiscount > 0 ? loyaltyDiscount / 0.5 : 0;

            if (userId && userId !== 'guest') {
                const businessCollectionNameForCustomer = businessType === 'shop' ? 'shops' : 'restaurants';
                const restaurantCustomerRef = firestore.collection(businessCollectionNameForCustomer).doc(restaurantId).collection('customers').doc(userId);

                batch.set(restaurantCustomerRef, {
                    name: customerDetails.name, phone: customerDetails.phone, status: isNewUser ? 'unclaimed' : 'verified',
                    totalSpend: FieldValue.increment(subtotal),
                    loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                    lastOrderDate: FieldValue.serverTimestamp(),
                    totalOrders: FieldValue.increment(1),
                }, { merge: true });
            }


            let dineInToken = null;
            if (isStreetVendorOrder) {
                const vendorRef = firestore.collection('street_vendors').doc(restaurantId);
                const vendorDoc = await vendorRef.get();
                if (vendorDoc.exists) {
                    const vendorData = vendorDoc.data();
                    const lastToken = vendorData.lastOrderToken || 0;
                    const newTokenNumber = lastToken + 1;
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    dineInToken = `${String(newTokenNumber)}-${alphabet[Math.floor(Math.random() * 26)]}${alphabet[Math.floor(Math.random() * 26)]}`;
                    batch.update(vendorRef, { lastOrderToken: newTokenNumber });
                }
            }

            batch.set(orderRef, {
                customerName: customerDetails.name,
                customerId: userId,
                customerAddress: customerDetails.address?.full || null,
                customerPhone: customerDetails.phone,
                restaurantId: restaurantId,
                businessType: businessType,
                deliveryType: payload.deliveryType,
                items: payload.items || [],
                totalAmount: billDetails.grandTotal,
                subtotal: billDetails.subtotal,
                loyaltyDiscount: billDetails.loyaltyDiscount || 0,
                coupon: billDetails.coupon || null,
                cgst: billDetails.cgst || 0,
                sgst: billDetails.sgst || 0,
                deliveryCharge: billDetails.deliveryCharge || 0,
                tipAmount: billDetails.tipAmount || 0,
                status: 'pending',
                orderDate: FieldValue.serverTimestamp(),
                notes: customNotes || null,
                trackingToken: trackingToken || null,
                dineInToken: dineInToken || null,
                paymentDetails: [{
                    method: 'razorpay',
                    amount: paymentAmount / 100,
                    razorpay_payment_id: paymentId,
                    razorpay_order_id: razorpayOrderId,
                    timestamp: new Date(),
                    status: 'paid'
                }]
            });
            console.log(`[Webhook RZP] Successfully prepared creation for order ${orderRef.id} from RZP Order ${razorpayOrderId}.`);

            await batch.commit();
            console.log(`[Webhook RZP] Batch committed successfully.`);

            const collectionForBusinessLookup = businessType === 'street-vendor' ? 'street_vendors' : (businessType === 'shop' ? 'shops' : 'restaurants');
            const businessDoc = await firestore.collection(collectionForBusinessLookup).doc(restaurantId).get();

            if (businessDoc.exists) {
                const businessData = businessDoc.data();
                await orderRef.update({ restaurantName: businessData.name || "Unnamed Business" });

                const linkedAccountId = businessData.razorpayAccountId;
                if (linkedAccountId && linkedAccountId.startsWith('acc_')) {
                    const transferPayload = JSON.stringify({ transfers: [{ account: linkedAccountId, amount: paymentAmount, currency: "INR" }] });
                    const transferOptions = {
                        hostname: 'api.razorpay.com', port: 443, path: `/v1/payments/${paymentId}/transfers`, method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` }
                    };
                    try {
                        await makeRazorpayRequest(transferOptions, transferPayload);
                    } catch (transferError) {
                        console.error(`[Webhook RZP] CRITICAL: Failed to transfer payment ${paymentId}. Error:`, JSON.stringify(transferError, null, 2));
                    }
                }

                if (businessData.ownerPhone && businessData.botPhoneNumberId) {
                    await sendNewOrderToOwner({
                        ownerPhone: businessData.ownerPhone, botPhoneNumberId: businessData.botPhoneNumberId,
                        customerName: customerDetails.name, totalAmount: billDetails.grandTotal,
                        orderId: orderRef.id, restaurantName: businessData.name
                    });
                }
            }

        }

        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook RZP] CRITICAL Error processing webhook:', error);
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
