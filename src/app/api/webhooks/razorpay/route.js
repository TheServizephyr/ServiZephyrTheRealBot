
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
        if(payload) {
          req.write(payload);
        }
        req.end();
    });
}

// --- NEW HELPER FOR SPLIT PAYMENTS ---
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
                return; // Abort transaction
            }

            const splitData = splitDoc.data();
            const shares = splitData.shares || [];
            console.log(`[Webhook RZP] Found ${shares.length} shares in session ${splitId}.`);
            const shareIndex = shares.findIndex(s => s.razorpay_order_id === razorpayOrderId);

            if (shareIndex === -1) {
                console.error(`[Webhook RZP] CRITICAL: Razorpay order ${razorpayOrderId} not found in shares for split ${splitId}.`);
                return; // Abort transaction
            }
            console.log(`[Webhook RZP] Matched Razorpay Order ID to share index ${shareIndex}.`);

            // Update the specific share that was paid
            shares[shareIndex].status = 'paid';
            shares[shareIndex].razorpay_payment_id = paymentEntity.id;
            console.log(`[Webhook RZP] Share index ${shareIndex} marked as paid.`);

            const paidShares = shares.filter(s => s.status === 'paid');
            const isFullyPaid = paidShares.length === splitData.splitCount;
            console.log(`[Webhook RZP] ${paidShares.length}/${splitData.splitCount} shares are now paid.`);

            const updateData = { shares };
            if (isFullyPaid) {
                console.log(`[Webhook RZP] All shares paid. Marking session ${splitId} as completed.`);
                updateData.status = 'completed';
                
                 const baseOrderRef = firestore.collection('orders').doc(splitData.baseOrderId);
                 const baseOrderSnap = await transaction.get(baseOrderRef);
                 
                 // If the base order exists, update it. If not, this part is skipped.
                 if(baseOrderSnap.exists){
                    console.log(`[Webhook RZP] Base order ${splitData.baseOrderId} found. Updating its status.`);
                    transaction.update(baseOrderRef, { paymentDetails: { ...paymentEntity, method: 'razorpay_split' }, status: 'pending' });
                 } else {
                    console.warn(`[Webhook RZP] Base order ${splitData.baseOrderId} not found for split payment. Cannot update status.`);
                 }
            }
            
            transaction.update(splitRef, updateData);
            console.log(`[Webhook RZP] Transaction update prepared for split session.`);
        });
        console.log(`[Webhook RZP] Firestore transaction for split payment ${splitId} successful.`);
    } catch (error) {
         console.error(`[Webhook RZP] CRITICAL ERROR during split payment transaction for ${splitId}:`, error);
    }

    return true; // Indicates this was a split payment and was handled
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
        console.log("[Webhook RZP] Raw body:", body);
        const signature = req.headers.get('x-razorpay-signature');
        console.log(`[Webhook RZP] Received signature: ${signature}`);

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
                console.log(`[Webhook RZP] Split payment for order ${razorpayOrderId} handled. Ending request.`);
                return NextResponse.json({ status: 'ok', message: 'Split payment processed.' });
            }
            
            const key_id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
            const key_secret = process.env.RAZORPAY_KEY_SECRET;
            const credentials = Buffer.from(`${key_id}:${key_secret}`).toString('base64');
            
            const rzpOrder = await makeRazorpayRequest({
                hostname: 'api.razorpay.com', port: 443, path: `/v1/orders/${razorpayOrderId}`, method: 'GET',
                headers: { 'Authorization': `Basic ${credentials}` }
            });

            const payloadString = rzpOrder.notes?.servizephyr_payload;
            
            if (!payloadString) {
                // --- START ADD-ON PAYMENT LOGIC ---
                const orderSnapshot = await firestore.collection('orders').where('paymentDetails', 'array-contains', { razorpay_order_id: razorpayOrderId }).limit(1).get();
                if (!orderSnapshot.empty) {
                    const orderDoc = orderSnapshot.docs[0];
                    console.log(`[Webhook RZP] Found add-on payment for existing order ${orderDoc.id}`);
                    await orderDoc.ref.update({
                        paymentDetails: FieldValue.arrayUnion({ method: 'razorpay', amount: paymentAmount / 100, timestamp: new Date(), razorpay_payment_id: paymentId, status: 'paid' })
                    });
                     return NextResponse.json({ status: 'ok', message: 'Add-on payment processed.' });
                }
                console.error(`[Webhook RZP] CRITICAL: servizephyr_payload not found for Razorpay Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order payload not found.' });
                 // --- END ADD-ON PAYMENT LOGIC ---
            }

            // --- START RE-INTEGRATED LOGIC FOR NEW ORDERS ---
            const { 
                order_id: firestoreOrderId, user_id: userId, restaurant_id: restaurantId, business_type: businessType,
                customer_details: customerDetailsString, items: itemsString, bill_details: billDetailsString, notes: customNotes 
            } = JSON.parse(payloadString);
            
            if (!firestoreOrderId || !userId || !restaurantId || !businessType) {
                console.error(`[Webhook RZP] CRITICAL: Missing key identifiers in payload for RZP Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order identifier notes missing.' });
            }

            const customerDetails = JSON.parse(customerDetailsString);
            const orderItems = JSON.parse(itemsString);
            const billDetails = JSON.parse(billDetailsString);
            const isStreetVendorOrder = billDetails.deliveryType === 'street-vendor-pre-order';

            const batch = firestore.batch();

            if (!isStreetVendorOrder && customerDetails.phone) {
                const usersRef = firestore.collection('users');
                const existingUserQuery = await usersRef.where('phone', '==', customerDetails.phone).limit(1).get();
                const isNewUser = existingUserQuery.empty;

                if (isNewUser) {
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

            const orderRef = firestore.collection('orders').doc(firestoreOrderId);
            
            let dineInToken = null;
            if (isStreetVendorOrder) {
                const vendorRef = firestore.collection('street_vendors').doc(restaurantId);
                const vendorData = (await vendorRef.get()).data();
                if (vendorData) {
                    const lastToken = vendorData.lastOrderToken || 0;
                    const newTokenNumber = lastToken + 1;
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    dineInToken = `${String(newTokenNumber)}-${alphabet[Math.floor(Math.random() * 26)]}${alphabet[Math.floor(Math.random() * 26)]}`;
                    batch.update(vendorRef, { lastOrderToken: newTokenNumber });
                }
            }

            const fullOrderData = {
                customerName: customerDetails.name, customerId: userId, customerAddress: customerDetails.address.full, customerPhone: customerDetails.phone,
                restaurantId: restaurantId, businessType: businessType, deliveryType: billDetails.deliveryType, pickupTime: billDetails.pickupTime,
                tipAmount: billDetails.tipAmount, items: orderItems, subtotal: billDetails.subtotal, coupon: billDetails.coupon || null,
                loyaltyDiscount: billDetails.loyaltyDiscount || 0, discount: (billDetails.coupon?.discount || 0) + (billDetails.loyaltyDiscount || 0), 
                cgst: billDetails.cgst, sgst: billDetails.sgst, deliveryCharge: billDetails.deliveryCharge || 0, totalAmount: billDetails.grandTotal,
                status: 'pending', notes: customNotes || null, dineInToken: dineInToken,
                paymentDetails: FieldValue.arrayUnion({ method: 'razorpay', amount: paymentAmount / 100, razorpay_payment_id: paymentId, razorpay_order_id: razorpayOrderId, timestamp: FieldValue.serverTimestamp(), status: 'paid' })
            };
            
            // Using update to merge with the existing incomplete order document
            batch.update(orderRef, fullOrderData);
            
            await batch.commit();
            console.log(`[Webhook RZP] Successfully completed order ${orderRef.id} from RZP Order ${razorpayOrderId}.`);

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
             // --- END RE-INTEGRATED LOGIC ---
        }

        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('[Webhook RZP] CRITICAL Error processing webhook:', error);
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
