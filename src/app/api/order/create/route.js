

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
            diningPreference = null,
            packagingCharge = 0,
            existingOrderId // <-- NEW: For adding items to an existing order
        } = body;

        // --- START: ADD-ON ORDER LOGIC ---
        if (existingOrderId && items && items.length > 0) {
            console.log(`[API /order/create] ADD-ON FLOW: Adding items to existing order ${existingOrderId}`);
            console.log(`[API /order/create] ADD-ON FLOW: Payment Method: ${paymentMethod}`);

            // Handle Online Payment for Add-ons
            if (paymentMethod === 'online') {
                try {
                    if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                        throw new Error("Razorpay credentials not configured.");
                    }

                    const razorpay = new Razorpay({
                        key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                        key_secret: process.env.RAZORPAY_KEY_SECRET,
                    });

                    // Create Razorpay Order with items in notes
                    // Note: Razorpay notes have a size limit. For very large orders, this might need a different approach (e.g. pendingAddons collection).
                    // But for typical food orders, it's fine.
                    const razorpayOrderOptions = {
                        amount: Math.round(grandTotal * 100),
                        currency: 'INR',
                        receipt: `addon_${existingOrderId}_${Date.now()}`,
                        notes: {
                            type: 'addon',
                            orderId: existingOrderId,
                            items: JSON.stringify(items), // Store items to add upon payment
                            subtotal: subtotal,
                            cgst: cgst,
                            sgst: sgst,
                            grandTotal: grandTotal
                        }
                    };

                    const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
                    console.log(`[API /order/create] ADD-ON FLOW: Razorpay order created: ${razorpayOrder.id}`);

                    // Fetch token to return (optional, but good for consistency)
                    const orderDoc = await firestore.collection('orders').doc(existingOrderId).get();
                    const trackingToken = orderDoc.exists ? orderDoc.data().trackingToken : null;

                    return NextResponse.json({
                        message: 'Razorpay order created for add-ons. Awaiting payment.',
                        razorpay_order_id: razorpayOrder.id,
                        firestore_order_id: existingOrderId,
                        token: trackingToken,
                    }, { status: 200 });

                } catch (error) {
                    console.error(`[API /order/create] ADD-ON FLOW: Razorpay creation failed:`, error);
                    return NextResponse.json({ message: error.message }, { status: 500 });
                }
            }

            const orderRef = firestore.collection('orders').doc(existingOrderId);

            try {
                await firestore.runTransaction(async (transaction) => {
                    const orderDoc = await transaction.get(orderRef);
                    if (!orderDoc.exists) throw new Error("The original order to add to was not found.");

                    const orderData = orderDoc.data();

                    // Layer 3 Security: Block adding items to non-pending/awaiting_payment orders
                    const allowedStatuses = ['pending', 'awaiting_payment'];
                    if (!allowedStatuses.includes(orderData.status)) {
                        throw new Error(`Cannot add items. Your order is ${orderData.status === 'Ready' ? 'being prepared' : orderData.status}. Please complete your current order first.`);
                    }

                    // Add timestamp to new items being added
                    const currentTimestamp = new Date();
                    const itemsWithTimestamp = items.map(item => ({
                        ...item,
                        addedAt: currentTimestamp,
                        isAddon: true // Mark as add-on item
                    }));

                    // Ensure original items have addedAt timestamp (for backward compatibility)
                    const existingItemsWithTimestamp = orderData.items.map(item => ({
                        ...item,
                        addedAt: item.addedAt || orderData.orderDate?.toDate?.() || new Date(orderData.orderDate) || currentTimestamp,
                        isAddon: item.isAddon || false
                    }));

                    const newItems = [...existingItemsWithTimestamp, ...itemsWithTimestamp];
                    const newSubtotal = orderData.subtotal + subtotal;
                    const newCgst = orderData.cgst + cgst;
                    const newSgst = orderData.sgst + sgst;
                    const newGrandTotal = orderData.totalAmount + grandTotal;

                    const updatePayload = {
                        items: newItems,
                        subtotal: newSubtotal,
                        cgst: newCgst,
                        sgst: newSgst,
                        totalAmount: newGrandTotal,
                        statusHistory: FieldValue.arrayUnion({
                            status: 'updated',
                            timestamp: currentTimestamp,
                            notes: `Added ${items.length} new item(s).`
                        })
                    };

                    if (paymentMethod === 'cod') {
                        updatePayload.paymentDetails = FieldValue.arrayUnion({
                            method: 'cod',
                            amount: grandTotal,
                            status: 'pending',
                            timestamp: new Date(),
                        });

                        // For COD, add items immediately
                        transaction.update(orderRef, updatePayload);
                    }
                    // For split_bill, DON'T add items here - webhook will handle it after payment
                });

                if (paymentMethod === 'split_bill') {
                    // Items will be added by webhook after payment confirmation
                    console.log(`[API /order/create] ADD-ON FLOW: Split bill - items will be added after payment`);
                    const orderDoc = await firestore.collection('orders').doc(existingOrderId).get();
                    const orderData = orderDoc.data();
                    return NextResponse.json({
                        message: 'Items will be added after payment confirmation.',
                        firestore_order_id: existingOrderId,
                        token: orderData.trackingToken,
                        pendingItems: items, // Return pending items for split session
                        pendingSubtotal: subtotal,
                        pendingCgst: cgst,
                        pendingSgst: sgst,
                        pendingTotal: grandTotal,
                    }, { status: 200 });
                }

                console.log(`[API /order/create] ADD-ON FLOW: Transaction committed successfully for order ${existingOrderId}.`);

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

        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();

        // --- PAYMENT METHOD VALIDATION ---
        console.log(`[API /order/create] Validating payment method: ${paymentMethod} for deliveryType: ${deliveryType}`);

        if (paymentMethod === 'cod' || paymentMethod === 'counter') {
            let isCodeEnabled = false;

            if (deliveryType === 'delivery') {
                isCodeEnabled = businessData.deliveryCodEnabled;
            } else if (deliveryType === 'pickup') {
                isCodeEnabled = businessData.pickupPodEnabled;
            } else if (deliveryType === 'dine-in') {
                isCodeEnabled = businessData.dineInPayAtCounterEnabled;
            } else if (deliveryType === 'street-vendor-pre-order') {
                isCodeEnabled = true; // Street vendors always allow cash
            }

            if (!isCodeEnabled) {
                console.error(`[API /order/create] Payment method validation failed: COD/Pay at Counter is disabled for ${deliveryType}`);
                return NextResponse.json({
                    message: 'The selected payment method is not available. Please choose a different payment method.'
                }, { status: 400 });
            }
        } else if (paymentMethod === 'online' || paymentMethod === 'split_bill') {
            let isOnlineEnabled = false;

            if (deliveryType === 'delivery') {
                isOnlineEnabled = businessData.deliveryOnlinePaymentEnabled;
            } else if (deliveryType === 'pickup') {
                isOnlineEnabled = businessData.pickupOnlinePaymentEnabled;
            } else if (deliveryType === 'dine-in') {
                isOnlineEnabled = businessData.dineInOnlinePaymentEnabled;
            } else if (deliveryType === 'street-vendor-pre-order') {
                isOnlineEnabled = true; // Street vendors always allow online
            }

            if (!isOnlineEnabled) {
                console.error(`[API /order/create] Payment method validation failed: Online payment is disabled for ${deliveryType}`);
                return NextResponse.json({
                    message: 'The selected payment method is not available. Please choose a different payment method.'
                }, { status: 400 });
            }
        }

        // --- Post-paid Dine-In ---
        if (deliveryType === 'dine-in' && businessData.dineInModel === 'post-paid') {
            console.log("[API /order/create] Handling post-paid dine-in order.");
            const newOrderRef = firestore.collection('orders').doc();
            const trackingToken = await generateSecureToken(firestore, `dine-in-${newOrderRef.id}`);

            await newOrderRef.set({
                restaurantId, businessType, tableId,
                items: items, notes: notes || null,
                subtotal, cgst, sgst, totalAmount: grandTotal,
                deliveryType,
                pax_count: pax_count, tab_name: tab_name,
                status: 'pending',
                dineInTabId: dineInTabId || null,
                diningPreference: diningPreference || null,
                packagingCharge: packagingCharge || 0,
                orderDate: FieldValue.serverTimestamp(),
                trackingToken: trackingToken,
            });

            console.log(`[API /order/create] Post-paid dine-in order created with ID: ${newOrderRef.id}`);
            return NextResponse.json({
                message: "Order placed. Awaiting WhatsApp confirmation.",
                order_id: newOrderRef.id,
                whatsappNumber: businessData.botDisplayNumber || businessData.ownerPhone,
                token: trackingToken
            }, { status: 200 });
        }

        // --- Pre-paid Dine-In ---
        if (deliveryType === 'dine-in') {
            console.log("[API /order/create] Handling pre-paid dine-in order.");
            const firestoreOrderId = firestore.collection('orders').doc().id;

            const servizephyrOrderPayload = {
                order_id: firestoreOrderId,
                user_id: `dine-in|${dineInTabId}`,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify({ name: tab_name, address: { full: `Table ${tableId}` }, phone: `dine-in-${tableId}` }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, tipAmount: 0, pickupTime: '', cgst, sgst, deliveryCharge: 0, tableId, dineInTabId, pax_count, tab_name }),
                notes: notes || null
            };
            console.log("[API /order/create] Generated servizephyr_payload for dine-in:", JSON.stringify(servizephyrOrderPayload, null, 2));

            if (paymentMethod === 'razorpay') {
                console.log("[API /order/create] Dine-in payment method is Razorpay.");
                if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                    console.error("[API /order/create] Razorpay credentials not configured.");
                    return NextResponse.json({ message: 'Payment gateway is not configured.' }, { status: 500 });
                }
                const razorpay = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
                const razorpayOrderOptions = {
                    amount: Math.round(grandTotal * 100),
                    currency: 'INR',
                    receipt: firestoreOrderId,
                    notes: { servizephyr_payload: JSON.stringify(servizephyrOrderPayload) }
                };
                const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
                console.log(`[API /order/create] Razorpay order created for dine-in: ${razorpayOrder.id}`);
                return NextResponse.json({
                    message: 'Razorpay order created for dine-in.',
                    razorpay_order_id: razorpayOrder.id,
                    firestore_order_id: firestoreOrderId,
                    dine_in_tab_id: dineInTabId
                }, { status: 200 });
            } else { // Pay at Counter for dine-in
                console.log("[API /order/create] Dine-in payment method is 'Pay at Counter'.");
                const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);
                const trackingToken = await generateSecureToken(firestore, `dine-in-${firestoreOrderId}`);
                const batch = firestore.batch();

                batch.set(newOrderRef, {
                    customerName: tab_name, customerId: `dine-in|${dineInTabId}`, customerAddress: `Table ${tableId}`,
                    restaurantId, businessType, deliveryType, tableId, dineInTabId, items,
                    subtotal, coupon, loyaltyDiscount, discount: coupon?.discount || 0, cgst, sgst,
                    totalAmount: grandTotal, status: 'pending', orderDate: FieldValue.serverTimestamp(),
                    notes: notes || null, paymentDetails: { method: paymentMethod },
                    trackingToken: trackingToken
                });

                await batch.commit();
                console.log(`[API /order/create] Dine-in 'Pay at Counter' order created: ${newOrderRef.id}`);

                return NextResponse.json({
                    message: 'Order added to tab successfully.',
                    firestore_order_id: newOrderRef.id,
                    dine_in_tab_id: dineInTabId,
                    token: trackingToken,
                }, { status: 200 });
            }
        }

        // --- Regular Delivery/Pickup/StreetVendor Flow ---
        console.log("[API /order/create] Handling regular delivery/pickup/street-vendor flow.");
        let userId = normalizedPhone || `anon_${nanoid(10)}`;
        let isNewUser = true;

        if (normalizedPhone) {
            console.log(`[API /order/create] Normalized phone exists: ${normalizedPhone}. Checking for existing user.`);
            const usersRef = firestore.collection('users');
            const existingUserQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();
            if (!existingUserQuery.empty) {
                isNewUser = false;
                userId = existingUserQuery.docs[0].id;
                console.log(`[API /order/create] Existing user found. UID: ${userId}, Is New User: ${isNewUser}`);
            } else {
                console.log(`[API /order/create] No existing user found for phone. Is New User: ${isNewUser}`);
            }
        }

        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number' && typeof address.longitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;
        console.log(`[API /order/create] Customer location set: ${!!customerLocation}`);

        if (paymentMethod === 'razorpay') {
            console.log("[API /order/create] Payment method is Razorpay.");
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[API /order/create] Razorpay credentials not configured.");
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });

            const firestoreOrderId = firestore.collection('orders').doc().id;
            console.log(`[API /order/create] Generated Firestore Order ID: ${firestoreOrderId}`);

            const trackingToken = await generateSecureToken(firestore, normalizedPhone || firestoreOrderId);

            const servizephyrOrderPayload = {
                customerDetails: { name, phone: normalizedPhone, address },
                billDetails: { subtotal, loyaltyDiscount, grandTotal, cgst, sgst, deliveryCharge, tipAmount, coupon },
                items,
                restaurantId,
                userId,
                businessType,
                deliveryType,
                isStreetVendorOrder: businessType === 'street-vendor',
                customNotes: notes,
                trackingToken,
                isNewUser
            };

            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100),
                currency: 'INR',
                receipt: firestoreOrderId,
                notes: {
                    servizephyr_payload: JSON.stringify(servizephyrOrderPayload),
                    restaurantName: businessData.name
                }
            };

            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
            console.log(`[API /order/create] Razorpay order created: ${razorpayOrder.id}`);

            return NextResponse.json({
                message: 'Razorpay order created. Awaiting payment confirmation.',
                razorpay_order_id: razorpayOrder.id,
                firestore_order_id: firestoreOrderId,
                token: trackingToken,
            }, { status: 200 });
        }

        if (paymentMethod === 'split_bill') {
            console.log("[API /order/create] Payment method is Split Bill. Creating pending order.");
            const firestoreOrderId = firestore.collection('orders').doc().id;
            const trackingToken = await generateSecureToken(firestore, normalizedPhone || firestoreOrderId);

            const batch = firestore.batch();
            const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);

            const finalOrderData = {
                customerName: name, customerId: userId, customerAddress: address?.full || null, customerPhone: normalizedPhone,
                customerLocation: customerLocation,
                restaurantId: restaurantId, restaurantName: businessData.name,
                businessType, deliveryType, pickupTime: pickupTime || '', tipAmount: tipAmount || 0,
                items: items,
                subtotal: subtotal || 0,
                coupon: coupon || null,
                loyaltyDiscount: loyaltyDiscount || 0,
                discount: 0,
                cgst: cgst || 0,
                sgst: sgst || 0,
                deliveryCharge: deliveryCharge || 0,
                diningPreference: diningPreference || null,
                packagingCharge: packagingCharge || 0,
                totalAmount: grandTotal,
                status: 'awaiting_payment', // Hidden from dashboard until payment completes
                orderDate: FieldValue.serverTimestamp(),
                notes: notes || null,
                paymentDetails: [],
                trackingToken: trackingToken,
            };

            batch.set(newOrderRef, finalOrderData);
            await batch.commit();

            return NextResponse.json({
                message: 'Split bill order initialized.',
                firestore_order_id: firestoreOrderId,
                token: trackingToken,
            }, { status: 200 });
        }

        // --- Handle Online Payment (Razorpay OR PhonePe) ---
        if (paymentMethod === 'online' || paymentMethod === 'razorpay') {
            console.log("[API /order/create] Handling Online Payment for standard order.");

            const firestoreOrderId = firestore.collection('orders').doc().id;
            const trackingToken = await generateSecureToken(firestore, normalizedPhone || firestoreOrderId);

            // Generate order token for street vendors (same as COD flow)
            let dineInToken = null;
            if (isStreetVendorOrder) {
                try {
                    const lastToken = businessData.lastOrderToken || 0;
                    const newTokenNumber = lastToken + 1;
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;
                    console.log(`[API /order/create] Generated Order Token: ${dineInToken}`);
                } catch (e) {
                    console.error(`[API /order/create] Error generating order token:`, e);
                }
            }

            // Create Firestore order FIRST (same as Razorpay flow)
            const batch = firestore.batch();
            const newOrderRef = firestore.collection('orders').doc(firestoreOrderId);

            const finalOrderData = {
                customerName: name,
                customerId: userId,
                customerAddress: address?.full || null,
                customerPhone: normalizedPhone,
                customerLocation: customerLocation,
                restaurantId: restaurantId,
                restaurantName: businessData.name,
                businessType,
                deliveryType,
                pickupTime: pickupTime || '',
                tipAmount: tipAmount || 0,
                items: items,
                dineInToken: dineInToken,
                subtotal: subtotal || 0,
                coupon: coupon || null,
                loyaltyDiscount: loyaltyDiscount || 0,
                discount: 0,
                cgst: cgst || 0,
                sgst: sgst || 0,
                deliveryCharge: deliveryCharge || 0,
                diningPreference: diningPreference || null,
                packagingCharge: packagingCharge || 0,
                totalAmount: grandTotal,
                status: 'awaiting_payment',
                orderDate: FieldValue.serverTimestamp(),
                notes: notes || null,
                paymentDetails: [],
                trackingToken: trackingToken,
            };

            batch.set(newOrderRef, finalOrderData);

            // Update business lastOrderToken if street vendor
            if (isStreetVendorOrder && dineInToken) {
                const lastToken = businessData.lastOrderToken || 0;
                batch.update(businessRef, { lastOrderToken: lastToken + 1 });
            }

            await batch.commit();
            console.log(`[API /order/create] Order ${firestoreOrderId} created in Firestore`);

            // Now create Razorpay order
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[API /order/create] Razorpay credentials not configured.");
                return NextResponse.json({ message: 'Payment gateway is not configured.' }, { status: 500 });
            }

            const razorpay = new Razorpay({ key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100),
                currency: 'INR',
                receipt: firestoreOrderId,
                notes: {
                    firestore_order_id: firestoreOrderId,
                    restaurant_id: restaurantId
                }
            };

            try {
                const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
                console.log(`[API /order/create] Razorpay order created: ${razorpayOrder.id}`);

                return NextResponse.json({
                    message: 'Razorpay order created.',
                    razorpay_order_id: razorpayOrder.id,
                    firestore_order_id: firestoreOrderId,
                    token: trackingToken,
                }, { status: 200 });
            } catch (err) {
                console.error("[API /order/create] Failed to create Razorpay order:", err);
                return NextResponse.json({ message: 'Failed to initiate payment.' }, { status: 500 });
            }
        }

        // --- "Pay at Counter" logic for Street Vendor ---
        console.log("[API /order/create] Handling 'Pay at Counter' flow for Street Vendor.");
        const batch = firestore.batch();

        if (isNewUser && normalizedPhone && businessType !== 'street-vendor') {
            console.log(`[API /order/create] New user detected (${normalizedPhone}), creating unclaimed profile.`);
            const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
            const newOrderedFrom = { restaurantId, restaurantName: businessData.name, businessType };
            const addressesToSave = (deliveryType === 'delivery' && address) ? [{ ...address, full: address.full }] : [];
            batch.set(unclaimedUserRef, {
                name: name, phone: normalizedPhone, addresses: addressesToSave,
                createdAt: FieldValue.serverTimestamp(),
                orderedFrom: FieldValue.arrayUnion(newOrderedFrom)
            }, { merge: true });
        }

        const couponDiscountAmount = coupon?.discount || 0;
        const finalLoyaltyDiscount = loyaltyDiscount || 0;
        const finalDiscount = couponDiscountAmount + finalLoyaltyDiscount;

        const pointsEarned = Math.floor(subtotal / 100) * 10;
        const pointsSpent = finalLoyaltyDiscount > 0 ? finalLoyaltyDiscount / 0.5 : 0;

        if (normalizedPhone && businessType !== 'street-vendor') {
            console.log(`[API /order/create] Updating customer stats for ${normalizedPhone} at business ${restaurantId}`);
            const restaurantCustomerRef = businessRef.collection('customers').doc(userId);
            batch.set(restaurantCustomerRef, {
                name: name, phone: normalizedPhone, status: isNewUser ? 'unclaimed' : 'verified',
                totalSpend: FieldValue.increment(subtotal),
                loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                lastOrderDate: FieldValue.serverTimestamp(),
                totalOrders: FieldValue.increment(1),
            }, { merge: true });

            if (!isNewUser) {
                const usersRef = firestore.collection('users');
                const userRestaurantLinkRef = usersRef.doc(userId).collection('joined_restaurants').doc(restaurantId);

                batch.set(userRestaurantLinkRef, {
                    restaurantName: businessData.name,
                    joinedAt: FieldValue.serverTimestamp()
                }, { merge: true });

                batch.update(userRestaurantLinkRef, {
                    totalSpend: FieldValue.increment(subtotal),
                    loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
                    lastOrderDate: FieldValue.serverTimestamp(),
                    totalOrders: FieldValue.increment(1),
                });
            }
        }

        if (coupon && coupon.id) {
            console.log(`[API /order/create] Incrementing usage count for coupon ${coupon.id}`);
            const couponRef = businessRef.collection('coupons').doc(coupon.id);
            batch.update(couponRef, { timesUsed: FieldValue.increment(1) });
        }

        const newOrderRef = firestore.collection('orders').doc();
        const trackingToken = await generateSecureToken(firestore, normalizedPhone || newOrderRef.id);
        console.log(`[API /order/create] Creating final order document with ID ${newOrderRef.id}`);

        let dineInToken = null;
        if (isStreetVendorOrder) {
            console.log(`[API /order/create] Generating token for street vendor order.`);
            try {
                const lastToken = businessData.lastOrderToken || 0;
                const newTokenNumber = lastToken + 1;

                const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];

                dineInToken = `${String(newTokenNumber)}-${randomChar1}${randomChar2}`;

                batch.update(businessRef, { lastOrderToken: newTokenNumber });
                console.log(`[API /order/create] Generated Street Vendor Token: ${dineInToken}`);
            } catch (e) {
                console.error(`[API /order/create] Error generating street vendor token:`, e);
            }
        }

        const finalOrderData = {
            customerName: name, customerId: userId, customerAddress: address?.full || null, customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: restaurantId, restaurantName: businessData.name,
            businessType, deliveryType, pickupTime: pickupTime || '', tipAmount: tipAmount || 0,
            items: items,
            dineInToken: dineInToken,
            subtotal: subtotal || 0,
            coupon: coupon || null,
            loyaltyDiscount: loyaltyDiscount || 0,
            discount: finalDiscount || 0,
            cgst: cgst || 0,
            sgst: sgst || 0,
            deliveryCharge: deliveryCharge || 0,
            diningPreference: diningPreference || null,
            packagingCharge: packagingCharge || 0,
            totalAmount: grandTotal,
            status: 'pending', // Always start as pending
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            paymentDetails: [{
                method: 'cod',
                amount: grandTotal,
                status: 'pending',
                timestamp: new Date()
            }],
            trackingToken: trackingToken,
        };

        batch.set(newOrderRef, finalOrderData);

        await batch.commit();
        console.log(`[API /order/create] Batch committed successfully. Order ${newOrderRef.id} created.`);

        if (businessData && businessData.ownerPhone && businessData.botPhoneNumberId) {
            console.log(`[API /order/create] Sending new order notification to owner.`);
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
        if (error.error && error.error.code === 'BAD_REQUEST_ERROR') {
            console.error("[API /order/create] Razorpay BAD_REQUEST_ERROR:", error.error.description);
            return NextResponse.json({ message: `Payment Gateway Error: ${error.error.description}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

