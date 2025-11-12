

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { sendNewOrderToOwner } from '@/lib/notifications';
import crypto from 'crypto';
import https from 'https';
import { nanoid } from 'nanoid';


const generateSecureToken = async (firestore, customerPhone) => {
    console.log(`[Webhook RZP] generateSecureToken: Generating token for phone: ${customerPhone}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity for tracking link
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry,
        type: 'tracking'
    });
    console.log(`[Webhook RZP] generateSecureToken: Token generated successfully.`);
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
        if(payload) {
          req.write(payload);
        }
        req.end();
    });
}


export async function POST(req) {
    console.log("[Webhook RZP] POST request received.");
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
            console.warn("[Webhook RZP] Invalid signature received.");
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }

        console.log("[Webhook RZP] Signature verified successfully.");
        const eventData = JSON.parse(body);
        
        if (eventData.event === 'payment.captured') {
            console.log("[Webhook RZP] Event 'payment.captured' detected.");
            const paymentEntity = eventData.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id;
            const paymentAmount = paymentEntity.amount; 
            
            if (!razorpayOrderId) {
                console.warn("[Webhook RZP] 'order_id' not found in payment entity. Skipping.");
                return NextResponse.json({ status: 'ok' });
            }
            
            console.log(`[Webhook RZP] Processing Razorpay Order ID: ${razorpayOrderId}`);
            const firestore = await getFirestore();
            
            const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
            const key_secret = process.env.RAZORPAY_KEY_SECRET;
            const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
            const fetchOrderOptions = {
                hostname: 'api.razorpay.com',
                port: 443,
                path: `/v1/orders/${razorpayOrderId}`,
                method: 'GET',
                headers: { 'Authorization': `Basic ${credentials}` }
            };

            console.log(`[Webhook RZP] Fetching order details from Razorpay for ${razorpayOrderId}`);
            const rzpOrder = await makeRazorpayRequest(fetchOrderOptions);
            const payloadString = rzpOrder.notes?.servizephyr_payload;
            
            if (!payloadString) {
                console.error(`[Webhook RZP] CRITICAL: servizephyr_payload not found in notes for Razorpay Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order payload not found in notes.' });
            }
            
            console.log("[Webhook RZP] Found servizephyr_payload in notes.");
            const { 
                order_id: firestoreOrderId,
                user_id: userId,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: customerDetailsString,
                items: itemsString,
                bill_details: billDetailsString,
                notes: customNotes 
            } = JSON.parse(payloadString);
            
            if (!firestoreOrderId || !userId || !restaurantId || !businessType) {
                console.error(`[Webhook RZP] CRITICAL: Missing key identifiers in payload for Razorpay Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order identifier notes missing.' });
            }

            const existingOrderQuery = await firestore.collection('orders').where('paymentDetails.razorpay_order_id', '==', razorpayOrderId).limit(1).get();
            if (!existingOrderQuery.empty) {
                console.log(`[Webhook RZP] Order ${razorpayOrderId} already processed. Skipping.`);
                return NextResponse.json({ status: 'ok', message: 'Order already exists.'});
            }

            const customerDetails = JSON.parse(customerDetailsString);
            const orderItems = JSON.parse(itemsString);
            const billDetails = JSON.parse(billDetailsString);
            
            // --- THE FIX: Generate tracking token ---
            console.log("[Webhook RZP] Generating tracking token...");
            const trackingToken = await generateSecureToken(firestore, customerDetails.phone);

            const batch = firestore.batch();
            const usersRef = firestore.collection('users');
            const existingUserQuery = await usersRef.where('phone', '==', customerDetails.phone).limit(1).get();

            const isNewUser = existingUserQuery.empty;
            console.log(`[Webhook RZP] Is new user: ${isNewUser}`);

            if (isNewUser) {
                const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(customerDetails.phone);
                 batch.set(unclaimedUserRef, {
                    name: customerDetails.name, 
                    phone: customerDetails.phone, 
                    addresses: [customerDetails.address], // Save the full address object
                    createdAt: FieldValue.serverTimestamp(),
                    orderedFrom: FieldValue.arrayUnion({
                        restaurantId: restaurantId,
                        restaurantName: rzpOrder.notes?.restaurantName || 'Unknown',
                        businessType: businessType,
                    })
                }, { merge: true });
                 console.log("[Webhook RZP] Created/updated unclaimed profile.");
            }
            
            const subtotal = billDetails.subtotal || 0;
            const loyaltyDiscount = billDetails.loyaltyDiscount || 0;
            
            const pointsEarned = Math.floor(subtotal / 100) * 10;
            const pointsSpent = loyaltyDiscount > 0 ? loyaltyDiscount / 0.5 : 0;
            
            const businessCollectionName = businessType === 'shop' ? 'shops' : 'restaurants';
            const restaurantCustomerRef = firestore.collection(businessCollectionName).doc(restaurantId).collection('customers').doc(userId);
            
            batch.set(restaurantCustomerRef, {
                name: customerDetails.name, phone: customerDetails.phone, 
                status: isNewUser ? 'unclaimed' : 'verified',
                totalSpend: FieldValue.increment(subtotal),
                loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                lastOrderDate: FieldValue.serverTimestamp(),
                totalOrders: FieldValue.increment(1),
            }, { merge: true });
            
            const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);
            console.log(`[Webhook RZP] Preparing to write order to Firestore doc ID: ${firestoreOrderId}`);
            
            // DINE IN LOGIC: Handle new tab creation if it was a dine-in order
            let finalDineInTabId = billDetails.dineInTabId;
            if (billDetails.deliveryType === 'dine-in' && billDetails.tableId && !finalDineInTabId) {
                const newTabRef = firestore.collection(businessCollectionName).doc(restaurantId).collection('dineInTabs').doc();
                finalDineInTabId = newTabRef.id;

                batch.set(newTabRef, {
                    id: finalDineInTabId,
                    tableId: billDetails.tableId,
                    status: 'active',
                    tab_name: billDetails.tab_name || "Guest",
                    pax_count: billDetails.pax_count || 1,
                    createdAt: FieldValue.serverTimestamp(),
                });
                
                const tableRef = firestore.collection(businessCollectionName).doc(restaurantId).collection('tables').doc(billDetails.tableId);
                batch.update(tableRef, {
                    current_pax: FieldValue.increment(billDetails.pax_count || 1),
                    state: 'occupied'
                });
                 console.log(`[Webhook RZP] Dine-in logic: Created new tab ${finalDineInTabId}`);
            }

            batch.set(newOrderRef, {
                customerName: customerDetails.name, customerId: userId, customerAddress: customerDetails.address.full, customerPhone: customerDetails.phone,
                restaurantId: restaurantId,
                businessType: businessType,
                deliveryType: billDetails.deliveryType || 'delivery',
                pickupTime: billDetails.pickupTime || '',
                tipAmount: billDetails.tipAmount || 0,
                tableId: billDetails.tableId,
                dineInTabId: finalDineInTabId,
                items: orderItems,
                subtotal: billDetails.subtotal, 
                coupon: billDetails.coupon, 
                loyaltyDiscount: billDetails.loyaltyDiscount, 
                discount: (billDetails.coupon?.discount || 0) + (billDetails.loyaltyDiscount || 0), 
                cgst: billDetails.cgst, 
                sgst: billDetails.sgst, 
                deliveryCharge: billDetails.deliveryCharge,
                totalAmount: billDetails.grandTotal,
                status: 'pending', 
                orderDate: FieldValue.serverTimestamp(),
                notes: customNotes || null,
                trackingToken: trackingToken, // --- THE FIX: Save the token ---
                paymentDetails: {
                    razorpay_payment_id: paymentId,
                    razorpay_order_id: razorpayOrderId,
                    method: 'razorpay',
                }
            });
            
            await batch.commit();
            console.log(`[Webhook RZP] Successfully created Firestore order ${newOrderRef.id} from Razorpay Order ${razorpayOrderId}.`);

            const businessDoc = await firestore.collection(businessCollectionName).doc(restaurantId).get();
            if (businessDoc.exists) {
                const businessData = businessDoc.data();
                if(!businessData.name) {
                     await newOrderRef.update({ restaurantName: "Unnamed Business" });
                } else {
                     await newOrderRef.update({ restaurantName: businessData.name });
                }

                const linkedAccountId = businessData.razorpayAccountId;

                if (linkedAccountId && linkedAccountId.startsWith('acc_')) {
                    const transferPayload = JSON.stringify({ transfers: [{ account: linkedAccountId, amount: paymentAmount, currency: "INR" }] });
                    const transferOptions = {
                        hostname: 'api.razorpay.com',
                        port: 443,
                        path: `/v1/payments/${paymentId}/transfers`,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` }
                    };
                    
                    try {
                        await makeRazorpayRequest(transferOptions, transferPayload);
                        console.log(`[Webhook RZP] Initiated transfer for payment ${paymentId} to account ${linkedAccountId}.`);
                    } catch (transferError) {
                        console.error(`[Webhook RZP] CRITICAL: Failed to process transfer for payment ${paymentId}. Error:`, JSON.stringify(transferError, null, 2));
                    }
                } else {
                    console.warn(`[Webhook RZP] Restaurant ${restaurantId} has no Linked Account. Skipping transfer.`);
                }

                if (businessData.ownerPhone && businessData.botPhoneNumberId) {
                    await sendNewOrderToOwner({
                        ownerPhone: businessData.ownerPhone,
                        botPhoneNumberId: businessData.botPhoneNumberId,
                        customerName: customerDetails.name,
                        totalAmount: billDetails.grandTotal,
                        orderId: newOrderRef.id,
                        restaurantName: businessData.name
                    });
                }
            } else {
                console.warn(`[Webhook RZP] Business document not found after order creation for ID: ${restaurantId}`);
            }
        }

        console.log("[Webhook RZP] Event processed successfully. Responding 'ok'.");
        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook RZP] CRITICAL ERROR processing webhook:', error);
        // Acknowledge receipt even on error to prevent Razorpay from retrying indefinitely
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
    