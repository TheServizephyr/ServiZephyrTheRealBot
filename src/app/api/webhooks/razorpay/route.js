
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

const handleSplitPayment = async (firestore, paymentEntity) => {
    const { order_id: razorpayOrderId, notes } = paymentEntity;
    const splitId = notes?.split_session_id;

    if (!splitId) {
        return false;
    }
    
    console.log(`[Webhook RZP] Detected split payment for session ${splitId}.`);
    const splitRef = firestore.collection('split_payments').doc(splitId);
    
    try {
        await firestore.runTransaction(async (transaction) => {
            const splitDoc = await transaction.get(splitRef);
            if (!splitDoc.exists) {
                console.error(`[Webhook RZP] CRITICAL: Split session ${splitId} not found.`);
                return;
            }

            const splitData = splitDoc.data();
            const shares = splitData.shares || [];
            const shareIndex = shares.findIndex(s => s.razorpay_order_id === razorpayOrderId);

            if (shareIndex === -1) {
                console.error(`[Webhook RZP] CRITICAL: Razorpay order ${razorpayOrderId} not found in shares.`);
                return;
            }

            shares[shareIndex].status = 'paid';
            shares[shareIndex].razorpay_payment_id = paymentEntity.id;

            const paidShares = shares.filter(s => s.status === 'paid');
            const isFullyPaid = paidShares.length === splitData.splitCount;

            const updateData = { shares };
            if (isFullyPaid) {
                updateData.status = 'completed';
                const baseOrderRef = firestore.collection('orders').doc(splitData.baseOrderId);
                const baseOrderSnap = await transaction.get(baseOrderRef);
                 if(baseOrderSnap.exists){
                    transaction.update(baseOrderRef, { paymentDetails: { ...paymentEntity, method: 'razorpay_split' }, status: 'pending' });
                 }
            }
            transaction.update(splitRef, updateData);
        });
    } catch (error) {
         console.error(`[Webhook RZP] CRITICAL ERROR during split payment transaction for ${splitId}:`, error);
    }
    return true;
};

export async function POST(req) {
    console.log("[Webhook RZP] Received POST request.");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        return NextResponse.json({ message: 'Webhook secret not configured' }, { status: 500 });
    }

    try {
        const body = await req.text();
        const signature = req.headers.get('x-razorpay-signature');

        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(body);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }

        const eventData = JSON.parse(body);
        
        if (eventData.event === 'payment.captured') {
            const paymentEntity = eventData.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id;
            const paymentAmount = paymentEntity.amount; 
            
            if (!razorpayOrderId) {
                return NextResponse.json({ status: 'ok' });
            }
            
            const firestore = await getFirestore();
            
            if (await handleSplitPayment(firestore, paymentEntity)) {
                return NextResponse.json({ status: 'ok', message: 'Split payment processed.' });
            }

            // --- A-GRADE FIX: New logic for completing orders ---
            
            const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
            const key_secret = process.env.RAZORPAY_KEY_SECRET;
            const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
            
            const rzpOrder = await makeRazorpayRequest({
                hostname: 'api.razorpay.com', port: 443, path: `/v1/orders/${razorpayOrderId}`, method: 'GET',
                headers: { 'Authorization': `Basic ${credentials}` }
            });

            const payloadString = rzpOrder.notes?.servizephyr_payload;
            if (!payloadString) {
                console.error(`[Webhook RZP] CRITICAL: servizephyr_payload not found for RZP Order ${razorpayOrderId}`);
                // If it's an add-on order, the payload might not be there. Let's find the base order.
                const orderSnapshot = await firestore.collection('orders').where('paymentDetails', 'array-contains', { razorpay_order_id: razorpayOrderId }).limit(1).get();
                if (!orderSnapshot.empty) {
                    const orderDoc = orderSnapshot.docs[0];
                    console.log(`[Webhook RZP] Found add-on payment for existing order ${orderDoc.id}`);
                    await orderDoc.ref.update({
                        paymentDetails: FieldValue.arrayUnion({ method: 'razorpay', amount: paymentAmount / 100, timestamp: new Date(), razorpay_payment_id: paymentId, status: 'paid' })
                    });
                     return NextResponse.json({ status: 'ok', message: 'Add-on payment processed.' });
                }
                return NextResponse.json({ status: 'error', message: 'Order payload not found.' });
            }
            
            const { 
                order_id: firestoreOrderId, user_id: userId, restaurant_id: restaurantId, business_type: businessType,
                customer_details: customerDetailsString, items: itemsString, bill_details: billDetailsString, notes: customNotes 
            } = JSON.parse(payloadString);

            if (!firestoreOrderId || !userId || !restaurantId || !businessType) {
                return NextResponse.json({ status: 'error', message: 'Order identifier notes missing.' });
            }

            const customerDetails = JSON.parse(customerDetailsString);
            const orderItems = JSON.parse(itemsString);
            const billDetails = JSON.parse(billDetailsString);
            
            // --- The order to update is the one created in the 'order/create' API ---
            const orderRef = firestore.collection('orders').doc(firestoreOrderId);

            let dineInToken = null;
            if (billDetails.deliveryType === 'street-vendor-pre-order') {
                 const vendorRef = firestore.collection('street_vendors').doc(restaurantId);
                 try {
                    const vendorData = (await vendorRef.get()).data();
                    if (vendorData) {
                        const lastToken = vendorData.lastOrderToken || 0;
                        const newTokenNumber = lastToken + 1;
                        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        dineInToken = `${newTokenNumber}-${alphabet[Math.floor(Math.random() * 26)]}${alphabet[Math.floor(Math.random() * 26)]}`;
                        await vendorRef.update({ lastOrderToken: newTokenNumber });
                    }
                 } catch (e) { console.error(`[Webhook RZP] Error generating street vendor token:`, e); }
            }
            
            // --- Update the incomplete order with full details ---
            const fullOrderData = {
                customerName: customerDetails.name,
                customerId: userId,
                customerAddress: customerDetails.address.full,
                customerPhone: customerDetails.phone,
                restaurantId: restaurantId,
                businessType: businessType,
                deliveryType: billDetails.deliveryType,
                pickupTime: billDetails.pickupTime,
                tipAmount: billDetails.tipAmount,
                items: orderItems,
                subtotal: billDetails.subtotal, 
                coupon: billDetails.coupon || null,
                loyaltyDiscount: billDetails.loyaltyDiscount || 0, 
                discount: (billDetails.coupon?.discount || 0) + (billDetails.loyaltyDiscount || 0), 
                cgst: billDetails.cgst, 
                sgst: billDetails.sgst, 
                deliveryCharge: billDetails.deliveryCharge || 0,
                totalAmount: billDetails.grandTotal,
                status: 'pending', // Now it's a real pending order
                orderDate: FieldValue.serverTimestamp(), // Update with final time
                notes: customNotes || null,
                dineInToken: dineInToken,
                paymentDetails: [{
                    method: 'razorpay',
                    amount: paymentAmount / 100,
                    razorpay_payment_id: paymentId,
                    razorpay_order_id: razorpayOrderId,
                    timestamp: FieldValue.serverTimestamp(),
                    status: 'paid'
                }]
            };

            await orderRef.update(fullOrderData);
            console.log(`[Webhook RZP] Successfully completed order ${firestoreOrderId} from RZP Order ${razorpayOrderId}.`);

            const businessDoc = await firestore.collection(businessType === 'shop' ? 'shops' : 'restaurants').doc(restaurantId).get();

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
                        ownerPhone: businessData.ownerPhone,
                        botPhoneNumberId: businessData.botPhoneNumberId,
                        customerName: customerDetails.name,
                        totalAmount: billDetails.grandTotal,
                        orderId: orderRef.id,
                        restaurantName: businessData.name
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
