

import { getFirestore, FieldValue, GeoPoint } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { sendNewOrderToOwner } from '@/lib/notifications';


const generateSecureToken = async (firestore, customerPhone) => {
    console.log(`[API /order/create] generateSecureToken for phone: ${customerPhone}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity for tracking link
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry,
        type: 'tracking'
    });
     console.log(`[API /order/create] Token generated: ${token}`);
    return token;
};


export async function POST(req) {
    console.log("[API /order/create] POST request received.");
    try {
        const firestore = await getFirestore();
        const body = await req.json();
        console.log("[API /order/create] Request body parsed:", JSON.stringify(body, null, 2));
        
        const { 
            name, address, phone, restaurantId, items, notes, 
            coupon = null, 
            loyaltyDiscount = 0, 
            grandTotal, 
            paymentMethod, 
            businessType = 'restaurant', 
            deliveryType = 'delivery', 
            pickupTime = '', 
            tipAmount = 0, 
            subtotal, 
            cgst, 
            sgst, 
            deliveryCharge = 0, 
            tableId = null, 
            pax_count, 
            tab_name, 
            dineInTabId,
            existingOrderId // <-- NEW: For adding items to an existing order
        } = body;

        // --- START: ADD-ON ORDER LOGIC ---
        if (existingOrderId && items && items.length > 0) {
            console.log(`[API /order/create] ADD-ON FLOW: Adding items to existing order ${existingOrderId}`);
            const orderRef = firestore.collection('orders').doc(existingOrderId);
            
            try {
                await firestore.runTransaction(async (transaction) => {
                    const orderDoc = await transaction.get(orderRef);
                    if (!orderDoc.exists) throw new Error("The original order to add to was not found.");
                    
                    const orderData = orderDoc.data();
                    
                    const newItems = [...orderData.items, ...items];
                    const newSubtotal = orderData.subtotal + subtotal;
                    const newCgst = orderData.cgst + cgst;
                    const newSgst = orderData.sgst + sgst;
                    const newGrandTotal = orderData.totalAmount + grandTotal;

                    const newPaymentDetail = {
                        method: paymentMethod,
                        amount: grandTotal,
                        timestamp: new Date(), // FIX: Use new Date() instead of FieldValue.serverTimestamp()
                        status: paymentMethod === 'cod' ? 'pending' : 'awaiting_confirmation'
                    };

                    const updatePayload = {
                        items: newItems,
                        subtotal: newSubtotal,
                        cgst: newCgst,
                        sgst: newSgst,
                        totalAmount: newGrandTotal,
                        paymentDetails: FieldValue.arrayUnion(newPaymentDetail),
                        statusHistory: FieldValue.arrayUnion({
                            status: 'updated',
                            timestamp: new Date(),
                            notes: `Added ${items.length} new item(s).`
                        })
                    };

                    transaction.update(orderRef, updatePayload);
                });
                console.log(`[API /order/create] ADD-ON FLOW: Successfully added items to order ${existingOrderId}.`);
                 return NextResponse.json({ 
                    message: 'Items added to your existing order successfully!',
                    order_id: existingOrderId,
                }, { status: 200 });

            } catch (error) {
                console.error(`[API /order/create] ADD-ON FLOW: Transaction failed for order ${existingOrderId}:`, error);
                return NextResponse.json({ message: error.message }, { status: 400 });
            }
        }
        // --- END: ADD-ON ORDER LOGIC ---

        // --- VALIDATION ---
        const isStreetVendorOrder = deliveryType === 'street-vendor-pre-order';
        console.log(`[API /order/create] Is Street Vendor Order? ${isStreetVendorOrder}`);

        if (deliveryType !== 'dine-in' && !name) {
            console.error("[API /order/create] Validation Error: Name is required for non-dine-in orders.");
            return NextResponse.json({ message: 'Name is required.' }, { status: 400 });
        }
        if (!restaurantId || !items || grandTotal === undefined || subtotal === undefined) {
             const missingFields = `Missing fields: restaurantId=${!!restaurantId}, items=${!!items}, grandTotal=${grandTotal !== undefined}, subtotal=${subtotal !== undefined}`;
             console.error(`[API /order/create] Validation Error: Missing required fields. Details: ${missingFields}`);
             return NextResponse.json({ message: `Missing required fields for order creation. Details: ${missingFields}` }, { status: 400 });
        }
        if (deliveryType === 'delivery' && (!address || !address.full)) {
            console.error("[API /order/create] Validation Error: Full, structured address required for delivery.");
            return NextResponse.json({ message: 'A full, structured address is required for delivery orders.' }, { status: 400 });
        }
        
        const normalizedPhone = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
             console.error(`[API /order/create] Validation Error: Invalid phone number format: ${normalizedPhone}`);
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }
        
        let businessRef;
        let collectionName;
        
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        for (const name of collectionsToTry) {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessRef = docRef;
                collectionName = name;
                console.log(`[API /order/create] Found business in collection: ${collectionName}`);
                break; 
            }
        }
        
        if (!businessRef) {
            console.error(`[API /order/create] Business not found with ID: ${restaurantId}`);
            return NextResponse.json({ message: 'This business does not exist.' }, { status: 404 });
        }
        
        const businessData = businessDoc.data();

        // --- ONLINE PAYMENT FLOW (Razorpay) ---
        if (paymentMethod === 'razorpay') {
            console.log("[API /order/create] Razorpay flow initiated.");
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
            
            const newOrderRef = firestore.collection('orders').doc();
            const trackingToken = await generateSecureToken(firestore, normalizedPhone || newOrderRef.id);
            
            await newOrderRef.set({
                id: newOrderRef.id,
                restaurantId: restaurantId,
                status: 'awaiting_payment',
                trackingToken: trackingToken,
                orderDate: FieldValue.serverTimestamp(),
            });
            console.log(`[API /order/create] Created incomplete order ${newOrderRef.id} with tracking token for online payment.`);

            const servizephyrOrderPayload = {
                order_id: newOrderRef.id,
                user_id: normalizedPhone || `anon_${nanoid(10)}`,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify({ name, address: address || null, phone: normalizedPhone || '' }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ 
                    subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, 
                    tipAmount, pickupTime, cgst, sgst, deliveryCharge 
                }),
                notes: notes || null
            };

            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100), 
                currency: 'INR',
                receipt: newOrderRef.id,
                notes: { servizephyr_payload: JSON.stringify(servizephyrOrderPayload) }
            };

            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
            console.log(`[API /order/create] Razorpay order ${razorpayOrder.id} created for Firestore order ${newOrderRef.id}.`);
            
            return NextResponse.json({ 
                message: 'Razorpay order created.',
                razorpay_order_id: razorpayOrder.id,
                firestore_order_id: newOrderRef.id,
                token: trackingToken,
            }, { status: 200 });
        }


        // --- COD / PAY AT COUNTER FLOW ---
        console.log("[API /order/create] COD/Pay at Counter flow initiated.");
        const newOrderRef = firestore.collection('orders').doc();
        const trackingToken = await generateSecureToken(firestore, normalizedPhone || newOrderRef.id);
        
        let dineInToken = null;
        if (isStreetVendorOrder) {
            console.log(`[API /order/create] Generating token for street vendor order.`);
            const vendorRef = firestore.collection('street_vendors').doc(restaurantId);
            try {
                const vendorDoc = await vendorRef.get();
                if (vendorDoc.exists) {
                    dineInToken = await firestore.runTransaction(async (transaction) => {
                        const freshVendorDoc = await transaction.get(vendorRef);
                        const vendorData = freshVendorDoc.data();
                        const lastToken = vendorData.lastOrderToken || 0;
                        const newTokenNumber = lastToken + 1;
                        
                        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        const token = `${newTokenNumber}-${randomChar1}${randomChar2}`;
                        
                        transaction.update(vendorRef, { lastOrderToken: newTokenNumber });
                        return token;
                    });
                     console.log(`[API /order/create] Generated Street Vendor Token: ${dineInToken}`);
                } else {
                     console.warn(`[API /order/create] Street vendor document ${restaurantId} not found, cannot generate token.`);
                }
            } catch (e) {
                console.error(`[API /order/create] Error in token generation transaction:`, e);
            }
        }
        
        const finalOrderData = {
            id: newOrderRef.id,
            customerName: name,
            customerId: normalizedPhone || `anon_${nanoid(10)}`,
            customerAddress: address?.full || null,
            customerPhone: normalizedPhone,
            customerLocation: (deliveryType === 'delivery' && address?.latitude) ? new GeoPoint(address.latitude, address.longitude) : null,
            restaurantId,
            restaurantName: businessData.name,
            businessType,
            deliveryType,
            pickupTime: pickupTime || '',
            tipAmount: tipAmount || 0,
            items,
            dineInToken,
            subtotal: subtotal || 0,
            coupon,
            loyaltyDiscount: loyaltyDiscount || 0,
            discount: (coupon?.discount || 0) + loyaltyDiscount,
            cgst: cgst || 0,
            sgst: sgst || 0,
            deliveryCharge: deliveryCharge || 0,
            totalAmount: grandTotal,
            status: 'pending',
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            trackingToken,
            paymentDetails: [{
                method: paymentMethod,
                amount: grandTotal,
                timestamp: FieldValue.serverTimestamp(),
                status: 'pending'
            }]
        };
        
        await newOrderRef.set(finalOrderData);
        console.log(`[API /order/create] COD order ${newOrderRef.id} created successfully.`);

        if (businessData.ownerPhone && businessData.botPhoneNumberId) {
            await sendNewOrderToOwner({
                ownerPhone: businessData.ownerPhone, botPhoneNumberId: businessData.botPhoneNumberId,
                customerName: name, totalAmount: grandTotal, orderId: newOrderRef.id, restaurantName: businessData.name
            });
        }
        
        return NextResponse.json({ 
            message: 'Order created successfully.',
            firestore_order_id: newOrderRef.id,
            token: trackingToken
        }, { status: 200 });

    } catch (error) {
        console.error("CREATE ORDER API CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
