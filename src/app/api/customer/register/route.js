

import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { sendNewOrderToOwner } from '@/lib/notifications';


export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { name, address, phone, restaurantId, items, notes, coupon, loyaltyDiscount, grandTotal, paymentMethod, businessType = 'restaurant', deliveryType = 'delivery', pickupTime = '', tipAmount = 0, subtotal, cgst, sgst, deliveryCharge, tableId = null } = await req.json();

        // --- VALIDATION ---
        if (!name || !phone || !restaurantId || !items || grandTotal === undefined || subtotal === undefined) {
            return NextResponse.json({ message: 'Missing required fields for order creation.' }, { status: 400 });
        }
        if (deliveryType === 'delivery' && !address) {
            return NextResponse.json({ message: 'Address is required for delivery orders.' }, { status: 400 });
        }

        const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
        if (!/^\d{10}$/.test(normalizedPhone)) {
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }
        
        const collectionName = businessType === 'shop' ? 'shops' : 'restaurants';
        const businessRef = firestore.collection(collectionName).doc(restaurantId);
        const businessDoc = await businessRef.get();
        if (!businessDoc.exists) {
            return NextResponse.json({ message: 'This business does not exist.' }, { status: 404 });
        }
        
        let razorpayOrderId = null;
        const businessData = businessDoc.data();
        
        // Find user ID ahead of time
        const usersRef = firestore.collection('users');
        const existingUserQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();
        const isNewUser = existingUserQuery.empty;
        const userId = isNewUser ? normalizedPhone : existingUserQuery.docs[0].id;


        // This is a placeholder for a real address-to-coordinate conversion
        const getCoordinatesFromAddress = (addr) => {
            if (typeof addr === 'string' && addr.toLowerCase().includes('delhi')) return new (getFirestore().GeoPoint)(28.7041, 77.1025);
            return new (getFirestore().GeoPoint)(28.6692, 77.4538);
        };
        const customerLocation = deliveryType === 'delivery' ? getCoordinatesFromAddress(address) : null;

        if (paymentMethod === 'razorpay') {
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[Order API] Razorpay keys are not configured in environment variables.");
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
            
            const firestoreOrderId = firestore.collection('orders').doc().id;

            const servizephyrOrderPayload = {
                // Key identifiers for webhook processing
                order_id: firestoreOrderId, // Use a pre-generated ID
                user_id: userId,
                restaurant_id: restaurantId,
                business_type: businessType,
                // Full data for record keeping and display on Razorpay dashboard
                customer_details: JSON.stringify({ name, address, phone: normalizedPhone }),
                items: JSON.stringify(items),
                bill_details: JSON.stringify({ subtotal, coupon, loyaltyDiscount, grandTotal, deliveryType, tipAmount, pickupTime, cgst, sgst, deliveryCharge, tableId }),
                notes: notes || null
            };

            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100), // Amount in paisa
                currency: 'INR',
                receipt: firestoreOrderId,
                payment_capture: 1,
                notes: servizephyrOrderPayload
            };

            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
            razorpayOrderId = razorpayOrder.id;
            console.log(`[Order API] Razorpay Order ${razorpayOrderId} created for amount ${grandTotal}.`);
            
            return NextResponse.json({ 
                message: 'Razorpay order created. Awaiting payment confirmation.',
                razorpay_order_id: razorpayOrderId,
                firestore_order_id: firestoreOrderId, // Return the same ID to the client
            }, { status: 200 });
        }


        // --- FIRESTORE BATCH WRITE FOR COD / POD / DINE-IN ---
        const batch = firestore.batch();
        
        if (isNewUser) {
            const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
            const newOrderedFrom = { restaurantId, restaurantName: businessData.name, businessType };
            batch.set(unclaimedUserRef, {
                name: name, phone: normalizedPhone, addresses: [{ id: `addr_${Date.now()}`, full: address }],
                createdAt: firestore.FieldValue.serverTimestamp(),
                orderedFrom: firestore.FieldValue.arrayUnion(newOrderedFrom)
            }, { merge: true });
        }
        
        const couponDiscountAmount = coupon?.discount || 0;
        const finalLoyaltyDiscount = loyaltyDiscount || 0;
        const finalDiscount = couponDiscountAmount + finalLoyaltyDiscount;
        
        const pointsEarned = Math.floor(subtotal / 100) * 10;
        const pointsSpent = finalLoyaltyDiscount > 0 ? finalLoyaltyDiscount / 0.5 : 0;

        const restaurantCustomerRef = businessRef.collection('customers').doc(userId);
        batch.set(restaurantCustomerRef, {
            name: name, phone: normalizedPhone, status: isNewUser ? 'unclaimed' : 'verified',
            totalSpend: firestore.FieldValue.increment(subtotal),
            loyaltyPoints: firestore.FieldValue.increment(pointsEarned - pointsSpent),
            lastOrderDate: firestore.FieldValue.serverTimestamp(),
            totalOrders: firestore.FieldValue.increment(1),
        }, { merge: true });
        
        if (!isNewUser) {
            const userRestaurantLinkRef = usersRef.doc(userId).collection('joined_restaurants').doc(restaurantId);
            batch.set(userRestaurantLinkRef, {
                 restaurantName: businessData.name, joinedAt: firestore.FieldValue.serverTimestamp(),
                 totalSpend: firestore.FieldValue.increment(subtotal),
                 loyaltyPoints: firestore.FieldValue.increment(pointsEarned - pointsSpent),
                 lastOrderDate: firestore.FieldValue.serverTimestamp(),
                 totalOrders: firestore.FieldValue.increment(1),
            }, { merge: true });
        }
        
        if (coupon && coupon.id) {
            const couponRef = businessRef.collection('coupons').doc(coupon.id);
            batch.update(couponRef, { timesUsed: firestore.FieldValue.increment(1) });
        }

        const newOrderRef = firestore.collection('orders').doc();
        batch.set(newOrderRef, {
            customerName: name, customerId: userId, customerAddress: address, customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: restaurantId, restaurantName: businessData.name,
            businessType, deliveryType, pickupTime, tipAmount, tableId,
            items: items,
            subtotal, coupon, loyaltyDiscount, discount: finalDiscount, cgst, sgst, deliveryCharge,
            totalAmount: grandTotal,
            status: deliveryType === 'dine-in' ? 'active_tab' : 'pending',
            orderDate: firestore.FieldValue.serverTimestamp(),
            notes: notes || null,
            paymentDetails: { method: paymentMethod }
        });
        
        await batch.commit();

        if (businessData.ownerPhone && businessData.botPhoneNumberId) {
            await sendNewOrderToOwner({
                ownerPhone: businessData.ownerPhone, botPhoneNumberId: businessData.botPhoneNumberId,
                customerName: name, totalAmount: grandTotal, orderId: newOrderRef.id
            });
        }
        
        return NextResponse.json({ 
            message: 'Order created successfully.',
            firestore_order_id: newOrderRef.id,
        }, { status: 200 });

    } catch (error) {
        console.error('CUSTOMER ORDER/REGISTER ERROR:', error);
        if(error.error && error.error.code === 'BAD_REQUEST_ERROR') {
             return NextResponse.json({ message: `Payment Gateway Error: ${error.error.description}` }, { status: 400 });
        }
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
