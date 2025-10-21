
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
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

            const razorpayOrderDetails = await makeRazorpayRequest(fetchOrderOptions);
            const orderPayloadString = razorpayOrderDetails.notes?.servizephyr_order_payload;
            
            if (!orderPayloadString) {
                console.error(`[Webhook] CRITICAL: servizephyr_order_payload not found in notes for Razorpay Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order payload not found in notes.' });
            }

            const { customerDetails, restaurantDetails, orderItems, billDetails, notes, businessType } = JSON.parse(orderPayloadString);
            const { restaurantId, restaurantName } = restaurantDetails;
            
            const existingOrderQuery = await firestore.collection('orders').where('paymentDetails.razorpay_order_id', '==', razorpayOrderId).limit(1).get();
            if (!existingOrderQuery.empty) {
                console.log(`[Webhook] Order ${razorpayOrderId} already processed. Skipping.`);
                return NextResponse.json({ status: 'ok', message: 'Order already exists.'});
            }

            const batch = firestore.batch();
            const usersRef = firestore.collection('users');
            const existingUserQuery = await usersRef.where('phone', '==', customerDetails.phone).limit(1).get();

            let userId;
            const isNewUser = existingUserQuery.empty;

            if (isNewUser) {
                const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(customerDetails.phone);
                userId = customerDetails.phone; // Use phone as temporary ID for unclaimed profiles
                 batch.set(unclaimedUserRef, {
                    name: customerDetails.name, 
                    phone: customerDetails.phone, 
                    addresses: [{ id: `addr_${Date.now()}`, full: customerDetails.address }],
                    createdAt: firestore.FieldValue.serverTimestamp(),
                    orderedFrom: firestore.FieldValue.arrayUnion({ restaurantId, restaurantName, businessType })
                }, { merge: true });

            } else {
                userId = existingUserQuery.docs[0].id;
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
                totalSpend: firestore.FieldValue.increment(subtotal),
                loyaltyPoints: firestore.FieldValue.increment(pointsEarned - pointsSpent),
                lastOrderDate: firestore.FieldValue.serverTimestamp(),
                totalOrders: firestore.FieldValue.increment(1),
            }, { merge: true });
            
            const newOrderRef = firestore.collection('orders').doc();
            
            // If it's a new Dine-In Tab, create it
            let finalDineInTabId = billDetails.dineInTabId;
            if (billDetails.deliveryType === 'dine-in' && billDetails.tableId && !finalDineInTabId) {
                const newTabRef = firestore.collection(businessCollectionName).doc(restaurantId).collection('dineInTabs').doc();
                finalDineInTabId = newTabRef.id;

                batch.set(newTabRef, {
                    id: finalDineInTabId, tableId: billDetails.tableId, status: 'active',
                    tab_name: billDetails.tab_name || "Guest", pax_count: billDetails.pax_count || 1,
                    createdAt: firestore.FieldValue.serverTimestamp(),
                });
                
                const tableRef = firestore.collection(businessCollectionName).doc(restaurantId).collection('tables').doc(billDetails.tableId);
                batch.update(tableRef, {
                    current_pax: firestore.FieldValue.increment(billDetails.pax_count || 1),
                    state: 'occupied'
                });
            }

            batch.set(newOrderRef, {
                customerName: customerDetails.name, customerId: userId, customerAddress: customerDetails.address, customerPhone: customerDetails.phone,
                restaurantId: restaurantId, restaurantName: restaurantName,
                businessType: businessType,
                deliveryType: billDetails.deliveryType || 'delivery',
                pickupTime: billDetails.pickupTime || '',
                tipAmount: billDetails.tipAmount || 0,
                tableId: billDetails.tableId || null,
                dineInTabId: finalDineInTabId || null,
                items: orderItems,
                subtotal: billDetails.subtotal, 
                coupon: billDetails.coupon, 
                loyaltyDiscount: billDetails.loyaltyDiscount, 
                discount: (billDetails.coupon?.discount || 0) + (billDetails.loyaltyDiscount || 0), 
                cgst: billDetails.cgst, 
                sgst: billDetails.sgst, 
                deliveryCharge: billDetails.deliveryCharge,
                totalAmount: billDetails.grandTotal,
                status: 'paid', // Order is paid online
                orderDate: firestore.FieldValue.serverTimestamp(),
                notes: notes || null,
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
