

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { sendNewOrderToOwner } from '@/lib/notifications';
import crypto from 'crypto';
import https from 'https';
import { nanoid } from 'nanoid';


const generateSecureToken = async (firestore, customerPhone) => {
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity for tracking link
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry,
        type: 'tracking'
    });
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
    const { order_id: razorpayOrderId, amount, notes } = paymentEntity;
    const splitId = notes?.split_session_id;

    if (!splitId) return false;

    console.log(`[Webhook RZP] Detected split payment for session: ${splitId}`);
    const splitRef = firestore.collection('split_payments').doc(splitId);
    
    await firestore.runTransaction(async (transaction) => {
        const splitDoc = await transaction.get(splitRef);
        if (!splitDoc.exists) {
            console.error(`[Webhook RZP] Split session ${splitId} not found in Firestore.`);
            return;
        }

        const splitData = splitDoc.data();
        const shares = splitData.shares;
        const shareIndex = shares.findIndex(s => s.razorpay_order_id === razorpayOrderId);

        if (shareIndex === -1) {
            console.error(`[Webhook RZP] Razorpay order ${razorpayOrderId} not found in shares for split ${splitId}.`);
            return;
        }

        // Update the specific share that was paid
        shares[shareIndex].status = 'paid';
        shares[shareIndex].razorpay_payment_id = paymentEntity.id;

        const paidShares = shares.filter(s => s.status === 'paid');
        const isFullyPaid = paidShares.length === splitData.splitCount;

        const updateData = { shares };
        if (isFullyPaid) {
            updateData.status = 'completed';
        }
        
        transaction.update(splitRef, updateData);
        console.log(`[Webhook RZP] Updated split session ${splitId}. Share ${shareIndex} marked as paid. Fully paid: ${isFullyPaid}`);
    });

    return true; // Indicates this was a split payment and was handled
};


export async function POST(req) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
        console.error("CRITICAL: RAZORPAY_WEBHOOK_SECRET is not set.");
        return NextResponse.json({ message: 'Webhook secret not configured' }, { status: 500 });
    }

    try {
        const body = await req.text();
        const signature = req.headers.get('x-razorpay-signature');

        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(body);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn("Invalid signature received.");
            return NextResponse.json({ message: 'Invalid signature' }, { status: 403 });
        }

        const eventData = JSON.parse(body);
        
        if (eventData.event === 'payment.captured') {
            const paymentEntity = eventData.payload.payment.entity;
            const razorpayOrderId = paymentEntity.order_id;
            const paymentId = paymentEntity.id;
            const paymentAmount = paymentEntity.amount; 
            
            if (!razorpayOrderId) {
                console.warn("'order_id' not found in payment entity. Skipping.");
                return NextResponse.json({ status: 'ok' });
            }
            
            const firestore = await getFirestore();
            
            // --- NEW: Check if this is a split payment ---
            const isSplitPayment = await handleSplitPayment(firestore, paymentEntity);
            if (isSplitPayment) {
                return NextResponse.json({ status: 'ok', message: 'Split payment processed.' });
            }

            // --- Regular Order Processing Continues Below ---

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
            const payloadString = rzpOrder.notes?.servizephyr_payload;
            
            if (!payloadString) {
                console.error(`CRITICAL: servizephyr_payload not found for Razorpay Order ${razorpayOrderId}`);
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
            
            if (!firestoreOrderId || !userId || !restaurantId || !businessType) {
                console.error(`CRITICAL: Missing key identifiers in payload for RZP Order ${razorpayOrderId}`);
                return NextResponse.json({ status: 'error', message: 'Order identifier notes missing.' });
            }

            const customerDetails = JSON.parse(customerDetailsString);
            const orderItems = JSON.parse(itemsString);
            const billDetails = JSON.parse(billDetailsString);
            const isStreetVendorOrder = billDetails.deliveryType === 'street-vendor-pre-order';
            
            const trackingToken = await generateSecureToken(firestore, customerDetails.phone || firestoreOrderId);

            const batch = firestore.batch();

            if (!isStreetVendorOrder && customerDetails.phone) {
                const usersRef = firestore.collection('users');
                const existingUserQuery = await usersRef.where('phone', '==', customerDetails.phone).limit(1).get();
                const isNewUser = existingUserQuery.empty;

                if (isNewUser) {
                    const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(customerDetails.phone);
                    batch.set(unclaimedUserRef, {
                        name: customerDetails.name, 
                        phone: customerDetails.phone, 
                        addresses: [customerDetails.address],
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
            
                const businessCollectionNameForCustomer = businessType === 'shop' ? 'shops' : 'restaurants';
                const restaurantCustomerRef = firestore.collection(businessCollectionNameForCustomer).doc(restaurantId).collection('customers').doc(userId);
            
                batch.set(restaurantCustomerRef, {
                    name: customerDetails.name, phone: customerDetails.phone, 
                    status: isNewUser ? 'unclaimed' : 'verified',
                    totalSpend: FieldValue.increment(subtotal),
                    loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                    lastOrderDate: FieldValue.serverTimestamp(),
                    totalOrders: FieldValue.increment(1),
                }, { merge: true });
            }
            
            const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);
            
            let finalDineInTabId = billDetails.dineInTabId;
            if (billDetails.deliveryType === 'dine-in' && billDetails.tableId && !finalDineInTabId) {
                 const businessCollectionName = businessType === 'shop' ? 'shops' : 'restaurants';
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
                customerName: customerDetails.name,
                customerId: userId,
                customerAddress: customerDetails.address.full,
                customerPhone: customerDetails.phone,
                restaurantId: restaurantId,
                businessType: businessType,
                deliveryType: billDetails.deliveryType || 'delivery',
                pickupTime: billDetails.pickupTime || null,
                tipAmount: billDetails.tipAmount || 0,
                tableId: billDetails.tableId || null,
                dineInTabId: finalDineInTabId || null,
                items: orderItems,
                subtotal: billDetails.subtotal, 
                coupon: billDetails.coupon || null, 
                loyaltyDiscount: billDetails.loyaltyDiscount || 0, 
                discount: (billDetails.coupon?.discount || 0) + (billDetails.loyaltyDiscount || 0), 
                cgst: billDetails.cgst, 
                sgst: billDetails.sgst, 
                deliveryCharge: billDetails.deliveryCharge || 0,
                totalAmount: billDetails.grandTotal,
                status: 'pending',
                orderDate: FieldValue.serverTimestamp(),
                notes: customNotes || null,
                trackingToken: trackingToken,
                paymentDetails: {
                    razorpay_payment_id: paymentId,
                    razorpay_order_id: razorpayOrderId,
                    method: 'razorpay',
                }
            });
            
            await batch.commit();

            const collectionForBusinessLookup = businessType === 'street-vendor' ? 'street_vendors' : (businessType === 'shop' ? 'shops' : 'restaurants');
            const businessDoc = await firestore.collection(collectionForBusinessLookup).doc(restaurantId).get();

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
                    } catch (transferError) {
                        console.error(`CRITICAL: Failed to process transfer for payment ${paymentId}. Error:`, JSON.stringify(transferError, null, 2));
                    }
                } else {
                    console.warn(`Restaurant ${restaurantId} has no Linked Account. Skipping transfer.`);
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
            }
        }

        return NextResponse.json({ status: 'ok' });

    } catch (error) {
        console.error('CRITICAL Error processing webhook:', error);
        return NextResponse.json({ status: 'error', message: 'Internal server error' }, { status: 200 });
    }
}
