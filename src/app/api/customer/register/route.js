

import { firestore as adminFirestore } from 'firebase-admin';
import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';


export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { name, address, phone, restaurantId, items, notes, coupon, loyaltyDiscount, grandTotal } = await req.json();

        // --- VALIDATION ---
        if (!name || !address || !phone || !restaurantId || !items || !grandTotal) {
            return NextResponse.json({ message: 'Missing required fields for order creation.' }, { status: 400 });
        }
        if (!/^\d{10}$/.test(phone)) {
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }

        // --- RAZORPAY ORDER CREATION ---
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error("[Order API] Razorpay keys are not configured in environment variables.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }
        const razorpay = new Razorpay({
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
        const razorpayOrderOptions = {
            amount: Math.round(grandTotal * 100), // Amount in paisa
            currency: 'INR',
            receipt: `receipt_order_${nanoid()}`,
            payment_capture: 1
        };
        const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
        console.log(`[Order API] Razorpay Order ${razorpayOrder.id} created for amount ${grandTotal}.`);


        // --- FIRESTORE BATCH WRITE ---
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        const restaurantDoc = await restaurantRef.get();
        if (!restaurantDoc.exists) {
            return NextResponse.json({ message: 'This restaurant does not exist.' }, { status: 404 });
        }
        const restaurantData = restaurantDoc.data();
        
        const batch = firestore.batch();
        
        const usersRef = firestore.collection('users');
        const existingUserQuery = await usersRef.where('phone', '==', phone).limit(1).get();

        let userId;
        if (!existingUserQuery.empty) {
            userId = existingUserQuery.docs[0].id;
        } else {
            const newUserRef = usersRef.doc();
            userId = newUserRef.id;
            batch.set(newUserRef, {
                name: name, phone: phone, addresses: [{ id: `addr_${Date.now()}`, full: address }],
                role: 'customer', createdAt: adminFirestore.FieldValue.serverTimestamp(),
            });
        }
        
        // --- Calculate order details ---
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const couponDiscountAmount = coupon?.discount || 0;
        const finalLoyaltyDiscount = loyaltyDiscount || 0;
        const finalDiscount = couponDiscountAmount + finalLoyaltyDiscount;
        const taxableAmount = subtotal - finalDiscount;
        const taxRate = 0.05;
        const cgst = taxableAmount > 0 ? taxableAmount * taxRate : 0;
        const sgst = taxableAmount > 0 ? taxableAmount * taxRate : 0;
        const deliveryCharge = (coupon?.code?.includes('FREE')) ? 0 : (restaurantData.deliveryCharge || 30);
        
        const pointsEarned = Math.floor(subtotal / 100) * 10;
        const pointsSpent = finalLoyaltyDiscount > 0 ? finalLoyaltyDiscount / 0.5 : 0;

        // --- Update customer stats in sub-collections ---
        const restaurantCustomerRef = restaurantRef.collection('customers').doc(userId);
        batch.set(restaurantCustomerRef, {
            name: name, phone: phone, status: 'claimed',
            totalSpend: adminFirestore.FieldValue.increment(subtotal),
            loyaltyPoints: adminFirestore.FieldValue.increment(pointsEarned - pointsSpent),
            lastOrderDate: adminFirestore.FieldValue.serverTimestamp(),
            totalOrders: adminFirestore.FieldValue.increment(1),
        }, { merge: true });

        const userRestaurantLinkRef = usersRef.doc(userId).collection('joined_restaurants').doc(restaurantId);
        batch.set(userRestaurantLinkRef, {
             restaurantName: restaurantData.name, joinedAt: adminFirestore.FieldValue.serverTimestamp(),
             totalSpend: adminFirestore.FieldValue.increment(subtotal),
             loyaltyPoints: adminFirestore.FieldValue.increment(pointsEarned - pointsSpent),
             lastOrderDate: adminFirestore.FieldValue.serverTimestamp(),
             totalOrders: adminFirestore.FieldValue.increment(1),
        }, { merge: true });

        // --- Create the pending order document ---
        const newOrderRef = firestore.collection('orders').doc();
        batch.set(newOrderRef, {
            customerName: name, customerId: userId, customerAddress: address, customerPhone: phone,
            restaurantId: restaurantId, restaurantName: restaurantData.name,
            items: items.map(item => ({ name: item.name, qty: item.quantity, price: item.price })),
            subtotal, coupon, loyaltyDiscount, discount: finalDiscount, cgst, sgst, deliveryCharge,
            totalAmount: grandTotal,
            status: 'pending', // Order is created as 'pending'
            priority: Math.floor(Math.random() * 5) + 1,
            orderDate: adminFirestore.FieldValue.serverTimestamp(),
            notes: notes || null,
            paymentDetails: {
                razorpay_payment_id: null, // This will be updated by webhook
                razorpay_order_id: razorpayOrder.id, // SAVE THE RAZORPAY ORDER ID
                razorpay_signature: null,
                method: 'online'
            }
        });
        
        console.log(`[Order API] Pending order ${newOrderRef.id} added to batch with Razorpay Order ID ${razorpayOrder.id}.`);

        await batch.commit();
        
        // --- Respond to Frontend ---
        return NextResponse.json({ 
            message: 'Pending order created. Proceed to payment.',
            razorpay_order_id: razorpayOrder.id,
            firestore_order_id: newOrderRef.id,
        }, { status: 200 });

    } catch (error) {
        console.error('CUSTOMER ORDER/REGISTER ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
