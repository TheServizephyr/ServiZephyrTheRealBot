
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { sendNewOrderToOwner } from '@/lib/notifications';
import crypto from 'crypto';
import Razorpay from 'razorpay';

export async function POST(req) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        console.error("[Webhook Error] RAZORPAY_WEBHOOK_SECRET is not set.");
        return NextResponse.json({ message: 'Webhook secret not configured' }, { status: 500 });
    }

    try {
        const body = await req.text();
        const signature = req.headers.get('x-razorpay-signature');

        // Step 1: Verify the webhook signature
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(body);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn("[Webhook] Invalid signature received.");
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }

        // Signature is valid, now process the payload
        const eventData = JSON.parse(body);

        // Step 2: Check for the 'payment.captured' event
        if (eventData.event === 'payment.captured') {
            const paymentEntity = eventData.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id; // Get the payment ID for transfer
            
            if (!razorpayOrderId) {
                console.warn("[Webhook] 'order_id' not found in payment entity.");
                return NextResponse.json({ status: 'ok' }); // Acknowledge receipt, but do nothing
            }

            const firestore = getFirestore();
            const ordersRef = firestore.collection('orders');
            
            // Step 3: Find the order using razorpay_order_id
            const orderQuery = await ordersRef
                .where('paymentDetails.razorpay_order_id', '==', razorpayOrderId)
                .limit(1)
                .get();

            if (orderQuery.empty) {
                console.warn(`[Webhook] Order with Razorpay Order ID ${razorpayOrderId} not found in Firestore.`);
                return NextResponse.json({ status: 'ok' });
            }

            const orderDoc = orderQuery.docs[0];
            const orderData = orderDoc.data();

            // Step 4: Update the order status to 'paid'
            if (orderData.status === 'pending') {
                await orderDoc.ref.update({ 
                    status: 'paid',
                    'paymentDetails.razorpay_payment_id': paymentId,
                 });
                console.log(`[Webhook] Order ${orderDoc.id} status updated to 'paid'.`);
                
                // Step 5: Trigger WhatsApp notification to the owner & Handle payment transfer
                const restaurantDoc = await firestore.collection('restaurants').doc(orderData.restaurantId).get();
                if (restaurantDoc.exists) {
                    const restaurantData = restaurantDoc.data();
                    
                    // --- Handle Payment Transfer ---
                    if (restaurantData.razorpayAccountId && process.env.RAZORPAY_ACCOUNT_ID) {
                        try {
                            const razorpay = new Razorpay({
                                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                                key_secret: process.env.RAZORPAY_KEY_SECRET,
                            });

                            const transferPayload = {
                                transfers: [
                                    {
                                        account: restaurantData.razorpayAccountId,
                                        amount: paymentEntity.amount, 
                                        currency: 'INR',
                                        on_hold: 0,
                                        notes: {
                                            order_id: orderDoc.id,
                                            restaurant_name: restaurantData.name,
                                        }
                                    }
                                ]
                            };
                            
                            console.log(`[Webhook] Initiating transfer for payment ${paymentId} to account ${restaurantData.razorpayAccountId}...`);
                            // Use razorpay.payments.transfer with the platform account header
                            await razorpay.payments.transfer(paymentId, transferPayload, {
                                headers: {
                                   "X-Razorpay-Account": process.env.RAZORPAY_ACCOUNT_ID
                                }
                            });
                            console.log(`[Webhook] Successfully initiated transfer for payment ${paymentId}.`);

                        } catch (transferError) {
                             const errorResponse = transferError.response ? transferError.response.data : transferError;
                             console.error(`[Webhook] CRITICAL: Failed to transfer payment ${paymentId}.`, JSON.stringify(errorResponse, null, 2));
                        }
                    } else {
                        console.warn(`[Webhook] Restaurant ${orderData.restaurantId} does not have a Razorpay Account ID or Platform RAZORPAY_ACCOUNT_ID is not set. Skipping transfer.`);
                    }

                    // --- Send New Order Notification to Owner ---
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
                    console.error(`[Webhook] Restaurant ${orderData.restaurantId} not found for order ${orderDoc.id}. Cannot send notification or transfer.`);
                }
            } else {
                 console.log(`[Webhook] Order ${orderDoc.id} status is already '${orderData.status}', no action taken.`);
            }
        }

        // Step 6: Respond with 200 OK
        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook] Error processing webhook:', error);
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
