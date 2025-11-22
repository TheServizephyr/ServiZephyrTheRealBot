
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
            existingOrderId // For adding items to an existing order
        } = body;
        
        const isStreetVendorOrder = deliveryType === 'street-vendor-pre-order';

        // --- START: ADD-ON ORDER LOGIC ---
        if (existingOrderId && items && items.length > 0) {
            console.log(`[API /order/create] ADD-ON FLOW: Adding to order ${existingOrderId}`);
            const orderRef = firestore.collection('orders').doc(existingOrderId);
            
            try {
                 await firestore.runTransaction(async (transaction) => {
                    const orderDoc = await transaction.get(orderRef);
                    if (!orderDoc.exists) throw new Error("The original order was not found.");
                    
                    const orderData = orderDoc.data();
                    
                    const newItems = [...orderData.items, ...items];
                    const newSubtotal = orderData.subtotal + subtotal;
                    const newCgst = orderData.cgst + cgst;
                    const newSgst = orderData.sgst + sgst;
                    const newGrandTotal = orderData.totalAmount + grandTotal;

                    const newPaymentDetail = {
                        method: paymentMethod,
                        amount: grandTotal,
                        timestamp: FieldValue.serverTimestamp()
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
                            notes: `Added ${items.length} new item(s). New total: ${newGrandTotal.toFixed(2)}`
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
                console.error(`[API /order/create] ADD-ON FLOW: Transaction failed:`, error);
                return NextResponse.json({ message: error.message }, { status: 400 });
            }
        }
        // --- END: ADD-ON ORDER LOGIC ---

        // --- VALIDATION ---
        if ((deliveryType !== 'dine-in' || isStreetVendorOrder) && !name) {
            console.error("[API /order/create] Validation Error: Name is required for non-dine-in/street-vendor orders.");
            return NextResponse.json({ message: 'Name is required.' }, { status: 400 });
        }
        if (!restaurantId || !items || grandTotal === undefined || subtotal === undefined) {
             const missingFields = `Missing fields: restaurantId=${!!restaurantId}, items=${!!items}, grandTotal=${grandTotal !== undefined}, subtotal=${subtotal !== undefined}`;
             return NextResponse.json({ message: `Missing required fields. Details: ${missingFields}` }, { status: 400 });
        }
        if (deliveryType === 'delivery' && (!address || !address.full)) {
            return NextResponse.json({ message: 'A full, structured address is required for delivery orders.' }, { status: 400 });
        }
        const normalizedPhone = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }
        
        let businessRef;
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        for (const name of collectionsToTry) {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) { businessRef = docRef; break; }
        }
        
        if (!businessRef) {
            return NextResponse.json({ message: 'This business does not exist.' }, { status: 404 });
        }
        const businessData = (await businessRef.get()).data();
        
        // --- ONLINE PAYMENT FLOW (Razorpay) ---
        if (paymentMethod === 'razorpay') {
            console.log("[API /order/create] Razorpay flow initiated.");
             if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }
            
            const razorpay = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
            
            // --- A-GRADE FIX: Create an incomplete order first to get a tracking token ---
            const newOrderRef = firestore.collection('orders').doc();
            const trackingToken = await generateSecureToken(firestore, normalizedPhone || newOrderRef.id);
            
            await newOrderRef.set({
                id: newOrderRef.id,
                restaurantId: restaurantId,
                status: 'awaiting_payment',
                trackingToken: trackingToken,
                orderDate: FieldValue.serverTimestamp(),
            });
            console.log(`[API /order/create] Created incomplete order ${newOrderRef.id} with tracking token.`);

            const servizephyrOrderPayload = {
                order_id: newOrderRef.id, // Use the pre-generated Firestore ID
                user_id: normalizedPhone || `anon_${nanoid(10)}`,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify({ name: name, address: address || null, phone: normalizedPhone || '' }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, tipAmount, pickupTime, cgst, sgst, deliveryCharge }),
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
                firestore_order_id: newOrderRef.id, // Send back the pre-generated ID
                token: trackingToken, // Send back the pre-generated token
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
                dineInToken = await firestore.runTransaction(async (transaction) => {
                    const vendorDoc = await transaction.get(vendorRef);
                    if (!vendorDoc.exists) {
                         console.warn(`[API /order/create] Street vendor document not found.`);
                         return null;
                    }
                    const vendorData = vendorDoc.data();
                    const lastToken = vendorData.lastOrderToken || 0;
                    const newTokenNumber = lastToken + 1;
                    
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    const token = `${newTokenNumber}-${randomChar1}${randomChar2}`;
                    
                    transaction.update(vendorRef, { lastOrderToken: newTokenNumber });
                    return token;
                });
            } catch (e) {
                console.error(`[API /order/create] Error in token generation transaction:`, e);
            }
        }
        
        const finalOrderData = {
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
                status: 'pending' // For COD, it's pending until collected
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

