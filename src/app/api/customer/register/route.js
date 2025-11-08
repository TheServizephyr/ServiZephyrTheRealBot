

import { getFirestore, FieldValue, GeoPoint } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { sendNewOrderToOwner } from '@/lib/notifications';


export async function POST(req) {
    console.log("[DEBUG] /api/customer/register: Received new order request.");
    try {
        const firestore = await getFirestore();
        const { name, address, phone, restaurantId, items, notes, coupon, loyaltyDiscount, grandTotal, paymentMethod, businessType = 'restaurant', deliveryType = 'delivery', pickupTime = '', tipAmount = 0, subtotal, cgst, sgst, deliveryCharge, tableId = null, pax_count, tab_name, dineInTabId } = await req.json();

        // --- VALIDATION ---
        console.log("[DEBUG] /api/customer/register: Validating request data...");
        if ((!name || !phone) && deliveryType !== 'dine-in') {
             console.error(`[DEBUG] /api/customer/register: Validation failed: Name and phone are required for non-dine-in orders.`);
            return NextResponse.json({ message: 'Name and phone are required.' }, { status: 400 });
        }
        if (!restaurantId || !items || grandTotal === undefined || subtotal === undefined) {
             const missingFields = `Missing fields: restaurantId=${!!restaurantId}, items=${!!items}, grandTotal=${grandTotal !== undefined}, subtotal=${subtotal !== undefined}`;
             console.error(`[DEBUG] /api/customer/register: Validation failed: Missing required fields for order creation. Details: ${missingFields}`);
             return NextResponse.json({ message: 'Missing required fields for order creation.' }, { status: 400 });
        }
        if (deliveryType === 'delivery' && (!address || !address.full)) {
            console.error("[DEBUG] /api/customer/register: Validation failed: A full, structured address is required for delivery orders.");
            return NextResponse.json({ message: 'A full, structured address is required for delivery orders.' }, { status: 400 });
        }
        
        const normalizedPhone = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        if (normalizedPhone && !/^\d{10}$/.test(normalizedPhone)) {
            console.error("[DEBUG] /api/customer/register: Validation failed: Invalid phone number format.");
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }
        
        const collectionName = businessType === 'shop' ? 'shops' : 'restaurants';
        console.log(`[DEBUG] /api/customer/register: Looking for business ${restaurantId} in collection '${collectionName}'.`);
        const businessRef = firestore.collection(collectionName).doc(restaurantId);
        const businessDoc = await businessRef.get();
        if (!businessDoc.exists) {
            console.error(`[DEBUG] /api/customer/register: Business with ID ${restaurantId} not found.`);
            return NextResponse.json({ message: 'This business does not exist.' }, { status: 404 });
        }
        console.log("[DEBUG] /api/customer/register: Business found.");
        const businessData = businessDoc.data();

        // --- START: WhatsApp Checkmate Dine-In Logic ---
        if (deliveryType === 'dine-in' && businessData.dineInModel === 'post-paid') {
            console.log("[DEBUG] Post-paid dine-in flow initiated. Creating pending order.");
            const newOrderRef = firestore.collection('orders').doc();
            
            await newOrderRef.set({
                restaurantId, businessType, tableId,
                items: items, notes: notes || null,
                subtotal, cgst, sgst, totalAmount: grandTotal,
                deliveryType,
                pax_count: pax_count, tab_name: tab_name,
                status: 'pending', 
                orderDate: FieldValue.serverTimestamp(),
            });
            
            console.log(`[DEBUG] Pending order created with ID: ${newOrderRef.id}`);
            return NextResponse.json({ 
                requires_confirmation: true, // New flag for the frontend
                order_id: newOrderRef.id,
                botDisplayNumber: businessData.botDisplayNumber || null,
            }, { status: 200 });
        }
        // --- END: WhatsApp Checkmate Dine-In Logic ---
        
        let razorpayOrderId = null;
        
        console.log("[DEBUG] /api/customer/register: Checking for existing user with phone:", normalizedPhone);
        const usersRef = firestore.collection('users');
        const existingUserQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();
        
        let isNewUser = true;
        let userId = normalizedPhone; 

        if (!existingUserQuery.empty) {
            const userDoc = existingUserQuery.docs[0];
            isNewUser = false;
            userId = userDoc.id;
        }
        
        console.log(`[DEBUG] /api/customer/register: User status: ${isNewUser ? 'New/Unclaimed User' : 'Existing Customer'}. User ID will be: ${userId}`);

        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number' && typeof address.longitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;
        console.log(`[DEBUG] /api/customer/register: Customer location extracted:`, customerLocation);


        if (paymentMethod === 'razorpay') {
            console.log("[DEBUG] /api/customer/register: Payment method is Razorpay. Creating Razorpay order...");
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[DEBUG] /api/customer/register: CRITICAL: Razorpay keys are not configured in environment variables.");
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
            
            const firestoreOrderId = firestore.collection('orders').doc().id;
            console.log(`[DEBUG] /api/customer/register: Generated Firestore Order ID: ${firestoreOrderId}`);

            const servizephyrOrderPayload = {
                order_id: firestoreOrderId,
                user_id: userId,
                restaurant_id: restaurantId,
                business_type: businessType,
                customer_details: JSON.stringify({ name, address, phone: normalizedPhone }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, tipAmount, pickupTime, cgst, sgst, deliveryCharge, tableId, pax_count, tab_name, dineInTabId }),
                notes: notes || null
            };

            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100), 
                currency: 'INR',
                receipt: firestoreOrderId,
                payment_capture: 1,
                notes: {
                    servizephyr_payload: JSON.stringify(servizephyrOrderPayload)
                }
            };

            console.log("[DEBUG] /api/customer/register: Razorpay order options:", razorpayOrderOptions);
            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
            razorpayOrderId = razorpayOrder.id;
            console.log(`[DEBUG] /api/customer/register: Razorpay Order ${razorpayOrderId} created for amount ${grandTotal}. Responding to client.`);
            
            return NextResponse.json({ 
                message: 'Razorpay order created. Awaiting payment confirmation.',
                razorpay_order_id: razorpayOrderId,
                firestore_order_id: firestoreOrderId,
            }, { status: 200 });
        }


        console.log(`[DEBUG] /api/customer/register: Payment method is ${paymentMethod}. Starting Firestore batch write.`);
        const batch = firestore.batch();
        
        if (isNewUser) {
            console.log(`[DEBUG] /api/customer/register: Creating unclaimed profile for new user ${normalizedPhone}.`);
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

        console.log(`[DEBUG] /api/customer/register: Updating customer record for ${userId} in ${collectionName}/${restaurantId}/customers.`);
        const restaurantCustomerRef = businessRef.collection('customers').doc(userId);
        batch.set(restaurantCustomerRef, {
            name: name, phone: normalizedPhone, status: isNewUser ? 'unclaimed' : 'verified',
            totalSpend: FieldValue.increment(subtotal),
            loyaltyPoints: FieldValue.increment(pointsEarned - pointsSpent),
            lastOrderDate: FieldValue.serverTimestamp(),
            totalOrders: FieldValue.increment(1),
        }, { merge: true });
        
        if (!isNewUser) {
            console.log(`[DEBUG] /api/customer/register: Updating joined_restaurants for existing user ${userId}.`);
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
        
        if (coupon && coupon.id) {
            console.log(`[DEBUG] /api/customer/register: Incrementing usage count for coupon ${coupon.id}.`);
            const couponRef = businessRef.collection('coupons').doc(coupon.id);
            batch.update(couponRef, { timesUsed: FieldValue.increment(1) });
        }
        
        let finalDineInTabId = dineInTabId;
        if (deliveryType === 'dine-in' && tableId && !finalDineInTabId) {
             console.log(`[DEBUG] /api/customer/register: Dine-in order for new tab on table ${tableId}.`);
             const newTabRef = businessRef.collection('dineInTabs').doc();
             finalDineInTabId = newTabRef.id;

             batch.set(newTabRef, {
                id: finalDineInTabId,
                tableId: tableId,
                status: 'active',
                tab_name: tab_name || "Guest",
                pax_count: pax_count || 1,
                createdAt: FieldValue.serverTimestamp(),
             });
             
             const tableRef = businessRef.collection('tables').doc(tableId);
             batch.update(tableRef, {
                current_pax: FieldValue.increment(pax_count || 1),
                state: 'occupied'
             });
             console.log(`[DEBUG] /api/customer/register: New tab ${finalDineInTabId} created.`);
        }

        console.log("[DEBUG] /api/customer/register: Creating main order document.");
        const newOrderRef = firestore.collection('orders').doc();
        batch.set(newOrderRef, {
            customerName: name, customerId: userId, customerAddress: address?.full || null, customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: restaurantId, restaurantName: businessData.name,
            businessType, deliveryType, pickupTime, tipAmount, tableId, dineInTabId: finalDineInTabId,
            items: items,
            subtotal, coupon, loyaltyDiscount, discount: finalDiscount, cgst, sgst, deliveryCharge,
            totalAmount: grandTotal,
            status: deliveryType === 'dine-in' ? 'active_tab' : 'pending',
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            paymentDetails: { method: paymentMethod }
        });
        
        await batch.commit();
        console.log(`[DEBUG] /api/customer/register: Batch committed successfully. New order ID: ${newOrderRef.id}.`);

        if (businessData.ownerPhone && businessData.botPhoneNumberId) {
            console.log(`[DEBUG] /api/customer/register: Sending new order notification to owner ${businessData.ownerPhone}.`);
            await sendNewOrderToOwner({
                ownerPhone: businessData.ownerPhone, botPhoneNumberId: businessData.botPhoneNumberId,
                customerName: name, totalAmount: grandTotal, orderId: newOrderRef.id, restaurantName: businessData.name
            });
        } else {
             console.warn(`[DEBUG] /api/customer/register: Cannot send notification. Owner phone or Bot ID is missing for business ${restaurantId}.`);
        }
        
        console.log("[DEBUG] /api/customer/register: Responding to client.");
        return NextResponse.json({ 
            message: 'Order created successfully.',
            firestore_order_id: newOrderRef.id,
            dine_in_tab_id: finalDineInTabId,
        }, { status: 200 });

    } catch (error) {
        console.error('[DEBUG] /api/customer/register: CRITICAL ERROR:', error);
        if(error.error && error.error.code === 'BAD_REQUEST_ERROR') {
             return NextResponse.json({ message: `Payment Gateway Error: ${error.error.description}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
