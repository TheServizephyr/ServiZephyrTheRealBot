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
                console.log(`[Webhook Transfer] Razorpay Response Status: ${res.statusCode}`);
                console.log(`[Webhook Transfer] Raw response from Razorpay:`, data);
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
        req.write(payload);
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

        // Step 1: Validate the webhook signature to ensure it's from Razorpay
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(body);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn("[Webhook] Invalid signature received.");
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }

        const eventData = JSON.parse(body);
        
        // Step 2: Listen specifically for the 'payment.captured' event
        if (eventData.event === 'payment.captured') {
            const paymentEntity = eventData.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id;
            const paymentAmount = paymentEntity.amount; // Amount in paisa
            
            if (!razorpayOrderId) {
                console.warn("[Webhook] 'order_id' not found in payment entity.");
                return NextResponse.json({ status: 'ok' });
            }

            const firestore = getFirestore();
            const ordersRef = firestore.collection('orders');
            
            // Step 3: Find the order in our database using Razorpay's order_id
            const orderQuery = await ordersRef.where('paymentDetails.razorpay_order_id', '==', razorpayOrderId).limit(1).get();

            if (orderQuery.empty) {
                console.warn(`[Webhook] Order with Razorpay Order ID ${razorpayOrderId} not found in Firestore.`);
                return NextResponse.json({ status: 'ok' });
            }

            const orderDoc = orderQuery.docs[0];
            const orderData = orderDoc.data();

            // Only process if the order is still in 'pending' state to avoid double processing
            if (orderData.status === 'pending') {
                await orderDoc.ref.update({ 
                    status: 'paid',
                    'paymentDetails.razorpay_payment_id': paymentId,
                 });
                console.log(`[Webhook] Order ${orderDoc.id} status updated to 'paid'.`);

                const restaurantDoc = await firestore.collection('restaurants').doc(orderData.restaurantId).get();
                
                if (restaurantDoc.exists) {
                    const restaurantData = restaurantDoc.data();
                    const linkedAccountId = restaurantData.razorpayAccountId;

                    // --- START: RAZORPAY ROUTE TRANSFER LOGIC ---
                    // Step 4: Check if the restaurant has a valid Linked Account ID
                    if (linkedAccountId && linkedAccountId.startsWith('acc_')) {
                        const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
                        const key_secret = process.env.RAZORPAY_KEY_SECRET;
                        const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
                        
                        const transferPayload = JSON.stringify({
                            transfers: [{
                                account: linkedAccountId,
                                amount: paymentAmount, // Use the full payment amount
                                currency: "INR"
                            }]
                        });
                        
                        const transferOptions = {
                            hostname: 'api.razorpay.com',
                            port: 443,
                            path: `/v1/payments/${paymentId}/transfers`,
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Basic ${credentials}`,
                            }
                        };
                        
                        try {
                            // Step 5: Make the API call to Razorpay to transfer funds
                            console.log(`[Webhook] Attempting to transfer ${paymentAmount} to ${linkedAccountId} for payment ${paymentId}`);
                            await makeRazorpayRequest(transferOptions, transferPayload);
                            console.log(`[Webhook] Successfully initiated transfer for payment ${paymentId} to account ${linkedAccountId}.`);
                        } catch (transferError) {
                            console.error(`[Webhook] CRITICAL: Failed to process transfer for payment ${paymentId}. Error:`, JSON.stringify(transferError, null, 2));
                        }
                    } else {
                        console.warn(`[Webhook] Restaurant ${orderData.restaurantId} does not have a valid Linked Account ID. Skipping transfer.`);
                    }
                    // --- END: RAZORPAY ROUTE TRANSFER LOGIC ---

                    // Trigger WhatsApp notification to the owner
                    if (restaurantData.ownerPhone && restaurantData.botPhoneNumberId) {
                      await sendNewOrderToOwner({
                          ownerPhone: restaurantData.ownerPhone,
                          botPhoneNumberId: restaurantData.botPhoneNumberId,
                          customerName: orderData.customerName,
                          totalAmount: orderData.totalAmount,
                          orderId: orderDoc.id
                      });
                    }

                } else {
                    console.error(`[Webhook] Restaurant ${orderData.restaurantId} not found for order ${orderDoc.id}. Cannot process transfer or send notification.`);
                }
            } else {
                 console.log(`[Webhook] Order ${orderDoc.id} status is already '${orderData.status}', no action taken.`);
            }
        }

        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook] Error processing webhook:', error);
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
