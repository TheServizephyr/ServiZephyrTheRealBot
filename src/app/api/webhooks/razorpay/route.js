

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { sendNewOrderToOwner } from '@/lib/notifications';
import crypto from 'crypto';
import https from 'https';


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
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        console.error("[Webhook Error] RAZORPAY_WEBHOOK_SECRET is not set.");
        return NextResponse.json({ message: 'Webhook secret not configured' }, { status: 500 });
    }

    try {
        const body = await req.text();
        const signature = req.headers.get('x-razorpay-signature');

        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(body);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn("[Webhook] Invalid signature received.");
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }

        const eventData = JSON.parse(body);
        
        if (eventData.event === 'payment.captured') {
            const paymentEntity = eventData.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id;
            const paymentAmount = paymentEntity.amount; 
            
            if (!razorpayOrderId) {
                console.warn("[Webhook] 'order_id' not found in payment entity.");
                return NextResponse.json({ status: 'ok' });
            }
            
            const firestore = getFirestore();
            
            // Fetch order notes to get our internal payload
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

            const rzpOrder = await makeRazorpayRequest(fetchOrderOptions);
            // --- FIX: Correctly parse the nested payload string ---
            const payloadString = rzpOrder.notes?.servizephyr_payload;
            
            if (!payloadString) {
                console.error(`[Webhook] CRITICAL: servizephyr_payload not found in notes for Razorpay Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order payload not found in notes.' });
            }
            
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
            // --- END FIX ---
            
            if (!firestoreOrderId || !userId || !restaurantId || !businessType) {
                console.error(`[Webhook] CRITICAL: Missing key identifiers in payload for Razorpay Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order identifier notes missing.' });
            }

            const existingOrderQuery = await firestore.collection('orders').where('paymentDetails.razorpay_order_id', '==', razorpayOrderId).limit(1).get();
            if (!existingOrderQuery.empty) {
                console.log(`[Webhook] Order ${razorpayOrderId} already processed. Skipping.`);
                return NextResponse.json({ status: 'ok', message: 'Order already exists.'});
            }

            // Parse stringified JSON from notes
            const customerDetails = JSON.parse(customerDetailsString);
            const orderItems = JSON.parse(itemsString);
            const billDetails = JSON.parse(billDetailsString);

            const batch = firestore.batch();
            const usersRef = firestore.collection('users');
            const existingUserQuery = await usersRef.where('phone', '==', customerDetails.phone).limit(1).get();

            const isNewUser = existingUserQuery.empty;

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
                status: 'pending', // THE FIX: Always set to 'pending' for consistency
                orderDate: FieldValue.serverTimestamp(),
                notes: customNotes || null,
                paymentDetails: {
                    razorpay_payment_id: paymentId,
                    razorpay_order_id: razorpayOrderId,
                    method: 'razorpay',
                }
            });
            
            await batch.commit();
            console.log(`[Webhook] Successfully created Firestore order ${newOrderRef.id} from Razorpay Order ${razorpayOrderId}.`);

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
                        console.log(`[Webhook] Initiated transfer for payment ${paymentId} to account ${linkedAccountId}.`);
                    } catch (transferError) {
                        console.error(`[Webhook] CRITICAL: Failed to process transfer for payment ${paymentId}. Error:`, JSON.stringify(transferError, null, 2));
                    }
                } else {
                    console.warn(`[Webhook] Restaurant ${restaurantId} has no Linked Account. Skipping transfer.`);
                }

                if (businessData.ownerPhone && businessData.botPhoneNumberId) {
                    await sendNewOrderToOwner({
                        ownerPhone: businessData.ownerPhone,
                        botPhoneNumberId: businessData.botPhoneNumberId,
                        customerName: customerDetails.name,
                        totalAmount: billDetails.grandTotal,
                        orderId: newOrderRef.id
                    });
                }
            }
        }

        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook] Error processing webhook:', error);
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}

    