import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { sendNewOrderToOwner } from '@/lib/notifications';
import crypto from 'crypto';

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
            // We check the status to avoid re-triggering notifications
            if (orderData.status === 'pending') {
                await orderDoc.ref.update({ status: 'paid' });
                console.log(`[Webhook] Order ${orderDoc.id} status updated to 'paid'.`);
                
                // Step 5: Trigger WhatsApp notification to the owner
                const restaurantDoc = await firestore.collection('restaurants').doc(orderData.restaurantId).get();
                if (restaurantDoc.exists) {
                    const restaurantData = restaurantDoc.data();
                    await sendNewOrderToOwner({
                        ownerPhone: restaurantData.ownerPhone,
                        botPhoneNumberId: restaurantData.botPhoneNumberId,
                        customerName: orderData.customerName,
                        totalAmount: orderData.totalAmount,
                        orderId: orderDoc.id
                    });
                } else {
                    console.error(`[Webhook] Restaurant ${orderData.restaurantId} not found for order ${orderDoc.id}. Cannot send notification.`);
                }
            } else {
                 console.log(`[Webhook] Order ${orderDoc.id} status is already '${orderData.status}', no action taken.`);
            }
        }

        // Step 6: Respond with 200 OK
        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook] Error processing webhook:', error);
        // Respond with a 200 OK even on errors to prevent Razorpay from resending.
        // We log the error on the server for debugging.
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
