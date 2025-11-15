

import { getFirestore, FieldValue, GeoPoint } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { sendNewOrderToOwner } from '@/lib/notifications';


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


export async function POST(req) {
    try {
        const firestore = await getFirestore();
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
            dineInTabId 
        } = await req.json();

        // --- VALIDATION ---
        if (deliveryType !== 'dine-in' && !name) {
            return NextResponse.json({ message: 'Name is required.' }, { status: 400 });
        }
        if (!restaurantId || !items || grandTotal === undefined || subtotal === undefined) {
             const missingFields = `Missing fields: restaurantId=${!!restaurantId}, items=${!!items}, grandTotal=${grandTotal !== undefined}, subtotal=${subtotal !== undefined}`;
             return NextResponse.json({ message: `Missing required fields for order creation. Details: ${missingFields}` }, { status: 400 });
        }
        if (deliveryType === 'delivery' && (!address || !address.full)) {
            return NextResponse.json({ message: 'A full, structured address is required for delivery orders.' }, { status: 400 });
        }
        
        const normalizedPhone = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
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
                break; 
            }
        }
        
        if (!businessRef) {
            return NextResponse.json({ message: 'This business does not exist.' }, { status: 404 });
        }
        
        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();

        // --- Post-paid Dine-In ---
        if (deliveryType === 'dine-in' && businessData.dineInModel === 'post-paid') {
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
                orderDate: FieldValue.serverTimestamp(),
                trackingToken: trackingToken,
            });
            
            return NextResponse.json({ 
                message: "Order placed. Awaiting WhatsApp confirmation.",
                order_id: newOrderRef.id,
                whatsappNumber: businessData.botDisplayNumber || businessData.ownerPhone,
                token: trackingToken
            }, { status: 200 });
        }
        
        // --- Pre-paid Dine-In ---
        if (deliveryType === 'dine-in') {
            const firestoreOrderId = firestore.collection('orders').doc().id;

             const servizephyrOrderPayload = {
                order_id: firestoreOrderId,
                user_id: `dine-in|${dineInTabId}`,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify({ name: tab_name, address: { full: `Table ${tableId}`}, phone: `dine-in-${tableId}` }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, tipAmount: 0, pickupTime: '', cgst, sgst, deliveryCharge: 0, tableId, dineInTabId, pax_count, tab_name }),
                notes: notes || null
            };

            if (paymentMethod === 'razorpay') {
                if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
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
                return NextResponse.json({ 
                    message: 'Razorpay order created for dine-in.',
                    razorpay_order_id: razorpayOrder.id,
                    firestore_order_id: firestoreOrderId,
                    dine_in_tab_id: dineInTabId
                }, { status: 200 });
            } else { // Pay at Counter for dine-in
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

                return NextResponse.json({
                    message: 'Order added to tab successfully.',
                    firestore_order_id: newOrderRef.id,
                    dine_in_tab_id: dineInTabId,
                    token: trackingToken,
                }, { status: 200 });
            }
        }
        
        // --- Regular Delivery/Pickup/StreetVendor Flow ---
        let userId = normalizedPhone || `anon_${nanoid(10)}`;
        let isNewUser = true;

        if (normalizedPhone) {
            const usersRef = firestore.collection('users');
            const existingUserQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();
            if (!existingUserQuery.empty) {
                isNewUser = false;
                userId = existingUserQuery.docs[0].id;
            }
        }
        
        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number' && typeof address.longitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;

        if (paymentMethod === 'razorpay') {
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
            
            const firestoreOrderId = firestore.collection('orders').doc().id;

            const customerDetailsForPayload = {
                name,
                address: address || { full: "Street Vendor Pre-Order" },
                phone: normalizedPhone || ''
            };

            const servizephyrOrderPayload = {
                order_id: firestoreOrderId,
                user_id: userId,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify(customerDetailsForPayload),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ 
                    subtotal: subtotal || 0,
                    coupon: coupon || null,
                    loyaltyDiscount: loyaltyDiscount || 0,
                    grandTotal: grandTotal || 0,
                    deliveryType,
                    tipAmount: tipAmount || 0,
                    pickupTime: pickupTime || '',
                    cgst: cgst || 0,
                    sgst: sgst || 0,
                    deliveryCharge: deliveryCharge || 0
                }),
                notes: notes || null
            };
            
            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100), 
                currency: 'INR',
                receipt: firestoreOrderId,
                notes: {
                    servizephyr_payload: JSON.stringify(servizephyrOrderPayload)
                }
            };
            
            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
            
            const trackingToken = await generateSecureToken(firestore, normalizedPhone || firestoreOrderId);
            return NextResponse.json({ 
                message: 'Razorpay order created. Awaiting payment confirmation.',
                razorpay_order_id: razorpayOrder.id,
                firestore_order_id: firestoreOrderId,
                token: trackingToken,
            }, { status: 200 });
        }


        // --- "Pay at Counter" logic for Street Vendor ---
        const batch = firestore.batch();
        
        if (isNewUser && normalizedPhone && businessType !== 'street-vendor') {
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
            const couponRef = businessRef.collection('coupons').doc(coupon.id);
            batch.update(couponRef, { timesUsed: FieldValue.increment(1) });
        }
        
        const newOrderRef = firestore.collection('orders').doc();
        const trackingToken = await generateSecureToken(firestore, normalizedPhone || newOrderRef.id);
        
        const finalOrderData = {
            customerName: name, customerId: userId, customerAddress: address?.full || null, customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: restaurantId, restaurantName: businessData.name,
            businessType, deliveryType, pickupTime: pickupTime || '', tipAmount: tipAmount || 0,
            items: items,
            subtotal: subtotal || 0,
            coupon: coupon || null,
            loyaltyDiscount: loyaltyDiscount || 0,
            discount: finalDiscount || 0,
            cgst: cgst || 0,
            sgst: sgst || 0,
            deliveryCharge: deliveryCharge || 0,
            totalAmount: grandTotal,
            status: 'pending', // Always start as pending
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            trackingToken: trackingToken,
            paymentDetails: { method: paymentMethod }
        };
        
        batch.set(newOrderRef, finalOrderData);
        
        await batch.commit();

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
        if(error.error && error.error.code === 'BAD_REQUEST_ERROR') {
             return NextResponse.json({ message: `Payment Gateway Error: ${error.error.description}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
