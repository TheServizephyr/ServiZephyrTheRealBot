
import { firestore as adminFirestore } from 'firebase-admin';
import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { sendNewOrderToOwner } from '@/lib/notifications';


export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { name, address, phone, restaurantId, items, notes, coupon, loyaltyDiscount, grandTotal, paymentMethod, businessType } = await req.json();

        // --- VALIDATION ---
        if (!name || !address || !phone || !restaurantId || !items || !grandTotal || !paymentMethod) {
            return NextResponse.json({ message: 'Missing required fields for order creation.' }, { status: 400 });
        }
        if (!/^\d{10}$/.test(phone)) {
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

        if (paymentMethod === 'razorpay') {
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                console.error("[Order API] Razorpay keys are not configured in environment variables.");
                return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });

            const orderPayloadForNotes = {
                customerDetails: { name, address, phone },
                restaurantDetails: { restaurantId, restaurantName: businessData.name },
                orderItems: items.map(item => ({ name: item.name, qty: item.quantity, price: item.price })),
                billDetails: { coupon, loyaltyDiscount, grandTotal },
                notes: notes || null,
                businessType: businessType
            };
            
            const razorpayOrderOptions = {
                amount: Math.round(grandTotal * 100), // Amount in paisa
                currency: 'INR',
                receipt: `receipt_order_${nanoid()}`,
                payment_capture: 1,
                notes: {
                    servizephyr_order_payload: JSON.stringify(orderPayloadForNotes)
                }
            };

            const razorpayOrder = await razorpay.orders.create(razorpayOrderOptions);
            razorpayOrderId = razorpayOrder.id;
            console.log(`[Order API] Razorpay Order ${razorpayOrderId} created for amount ${grandTotal}. Firestore order creation will wait for payment confirmation.`);
            
            return NextResponse.json({ 
                message: 'Razorpay order created. Awaiting payment confirmation.',
                razorpay_order_id: razorpayOrderId,
            }, { status: 200 });
        }


        // --- FIRESTORE BATCH WRITE FOR COD ---
        const batch = firestore.batch();
        
        const usersRef = firestore.collection('users');
        const existingUserQuery = await usersRef.where('phone', '==', phone).limit(1).get();

        let userId;
        let isNewUser = existingUserQuery.empty;

        if (isNewUser) {
            // New user via COD, create an unclaimed profile, NOT a main user profile.
            const unclaimedUserRef = firestore.collection('unclaimed_profiles').doc(phone);
            userId = phone; // Use phone as temporary ID
            batch.set(unclaimedUserRef, {
                name: name, 
                phone: phone, 
                addresses: [{ id: `addr_${Date.now()}`, full: address }],
                createdAt: adminFirestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        } else {
            // Existing verified user
            userId = existingUserQuery.docs[0].id;
        }
        
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const couponDiscountAmount = coupon?.discount || 0;
        const finalLoyaltyDiscount = loyaltyDiscount || 0;
        const finalDiscount = couponDiscountAmount + finalLoyaltyDiscount;
        const taxableAmount = subtotal - finalDiscount;
        const taxRate = 0.05;
        const cgst = taxableAmount > 0 ? taxableAmount * taxRate : 0;
        const sgst = taxableAmount > 0 ? taxableAmount * taxRate : 0;
        
        const deliveryCharge = (coupon?.code?.includes('FREE')) ? 0 : (businessData.deliveryCharge || 30);
        
        const pointsEarned = Math.floor(subtotal / 100) * 10;
        const pointsSpent = finalLoyaltyDiscount > 0 ? finalLoyaltyDiscount / 0.5 : 0;

        const restaurantCustomerRef = businessRef.collection('customers').doc(userId);
        batch.set(restaurantCustomerRef, {
            name: name, phone: phone, 
            status: isNewUser ? 'unclaimed' : 'verified', // Set status based on user existence
            totalSpend: adminFirestore.FieldValue.increment(subtotal),
            loyaltyPoints: adminFirestore.FieldValue.increment(pointsEarned - pointsSpent),
            lastOrderDate: adminFirestore.FieldValue.serverTimestamp(),
            totalOrders: adminFirestore.FieldValue.increment(1),
        }, { merge: true });
        
        // Only create joined_restaurants if it's a verified user
        if (!isNewUser) {
            const userRestaurantLinkRef = usersRef.doc(userId).collection('joined_restaurants').doc(restaurantId);
            batch.set(userRestaurantLinkRef, {
                 restaurantName: businessData.name, joinedAt: adminFirestore.FieldValue.serverTimestamp(),
                 totalSpend: adminFirestore.FieldValue.increment(subtotal),
                 loyaltyPoints: adminFirestore.FieldValue.increment(pointsEarned - pointsSpent),
                 lastOrderDate: adminFirestore.FieldValue.serverTimestamp(),
                 totalOrders: adminFirestore.FieldValue.increment(1),
            }, { merge: true });
        }
        
        if (coupon && coupon.id) {
            const couponRef = businessRef.collection('coupons').doc(coupon.id);
            batch.update(couponRef, {
                timesUsed: adminFirestore.FieldValue.increment(1)
            });
            console.log(`[Order API] Coupon ${coupon.id} usage count incremented.`);
        }


        const newOrderRef = firestore.collection('orders').doc();
        batch.set(newOrderRef, {
            customerName: name, customerId: userId, customerAddress: address, customerPhone: phone,
            restaurantId: restaurantId, restaurantName: businessData.name,
            businessType,
            items: items.map(item => ({ name: item.name, qty: item.quantity, price: item.price })),
            subtotal, coupon, loyaltyDiscount, discount: finalDiscount, cgst, sgst, deliveryCharge,
            totalAmount: grandTotal,
            status: 'pending',
            orderDate: adminFirestore.FieldValue.serverTimestamp(),
            notes: notes || null,
            paymentDetails: {
                method: paymentMethod,
            }
        });
        
        console.log(`[Order API] COD order ${newOrderRef.id} added to batch for user ${userId}.`);

        await batch.commit();

        if (businessData.ownerPhone && businessData.botPhoneNumberId) {
            await sendNewOrderToOwner({
                ownerPhone: businessData.ownerPhone,
                botPhoneNumberId: businessData.botPhoneNumberId,
                customerName: name,
                totalAmount: grandTotal,
                orderId: newOrderRef.id
            });
        }
        
        return NextResponse.json({ 
            message: 'COD order created successfully.',
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
