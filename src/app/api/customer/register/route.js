
import { firestore as adminFirestore } from 'firebase-admin';
import { getFirestore } from '@/lib/firebase-admin';
import { NextResponse } from 'next/server';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export async function POST(req) {
    try {
        const firestore = getFirestore();
        const { name, address, phone, restaurantId, items, notes, coupon, loyaltyDiscount } = await req.json();

        if (!name || !address || !phone || !restaurantId || !items) {
            return NextResponse.json({ message: 'Missing required fields.' }, { status: 400 });
        }
        
        if (!/^\d{10}$/.test(phone)) {
            return NextResponse.json({ message: 'Invalid phone number format. Must be 10 digits.' }, { status: 400 });
        }
        
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        const restaurantDoc = await restaurantRef.get();
        if (!restaurantDoc.exists) {
            return NextResponse_json({ message: 'This restaurant does not exist.' }, { status: 404 });
        }
        const restaurantData = restaurantDoc.data();

        const batch = firestore.batch();
        
        const usersRef = firestore.collection('users');
        const existingUserQuery = await usersRef.where('phone', '==', phone).limit(1).get();

        let userId;
        let userData;

        if (!existingUserQuery.empty) {
            const existingUserDoc = existingUserQuery.docs[0];
            userId = existingUserDoc.id;
            userData = existingUserDoc.data();
            console.log(`[Order API] Existing user found with UID: ${userId} for phone: ${phone}.`);
            
            const userAddresses = userData.addresses || [];
            if (!userAddresses.some(a => a.full === address)) {
                 batch.update(existingUserDoc.ref, {
                    addresses: adminFirestore.FieldValue.arrayUnion({ id: `addr_${Date.now()}`, full: address })
                }, { merge: true });
            }

        } else {
            console.log(`[Order API] No existing user found for phone: ${phone}. Creating new user profile.`);
            const newUserRef = usersRef.doc();
            userId = newUserRef.id;
            
            batch.set(newUserRef, {
                name: name,
                phone: phone,
                addresses: [{ id: `addr_${Date.now()}`, full: address }],
                role: 'customer',
                createdAt: adminFirestore.FieldValue.serverTimestamp(),
            });
            console.log(`[Order API] New user profile created with UID: ${userId}`);
        }
        
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const couponDiscountAmount = coupon?.discount || 0;
        const finalLoyaltyDiscount = loyaltyDiscount || 0;
        const finalDiscount = couponDiscountAmount + finalLoyaltyDiscount;
        
        const taxableAmount = subtotal - finalDiscount;
        const taxRate = 0.05;
        const cgst = taxableAmount > 0 ? taxableAmount * taxRate : 0;
        const sgst = taxableAmount > 0 ? taxableAmount * taxRate : 0;
        
        const deliveryCharge = (coupon?.code?.includes('FREE')) ? 0 : (restaurantData.deliveryCharge || 30);
        const grandTotal = taxableAmount + cgst + sgst + deliveryCharge;

        const pointsEarned = Math.floor(subtotal / 100) * 10;
        const pointsSpent = finalLoyaltyDiscount > 0 ? finalLoyaltyDiscount / 0.5 : 0;

        const restaurantCustomerRef = restaurantRef.collection('customers').doc(userId);
        batch.set(restaurantCustomerRef, {
            name: name,
            phone: phone,
            status: 'claimed',
            totalSpend: adminFirestore.FieldValue.increment(subtotal),
            loyaltyPoints: adminFirestore.FieldValue.increment(pointsEarned - pointsSpent),
            lastOrderDate: adminFirestore.FieldValue.serverTimestamp(),
            totalOrders: adminFirestore.FieldValue.increment(1),
        }, { merge: true });

        const userRestaurantLinkRef = usersRef.doc(userId).collection('joined_restaurants').doc(restaurantId);
        batch.set(userRestaurantLinkRef, {
             restaurantName: restaurantData.name,
             joinedAt: adminFirestore.FieldValue.serverTimestamp(),
             totalSpend: adminFirestore.FieldValue.increment(subtotal),
             loyaltyPoints: adminFirestore.FieldValue.increment(pointsEarned - pointsSpent),
             lastOrderDate: adminFirestore.FieldValue.serverTimestamp(),
             totalOrders: adminFirestore.FieldValue.increment(1),
        }, { merge: true });

        const newOrderRef = firestore.collection('orders').doc();
        batch.set(newOrderRef, {
            customerName: name,
            customerId: userId,
            customerAddress: address,
            customerPhone: phone,
            restaurantId: restaurantId,
            restaurantName: restaurantData.name,
            items: items.map(item => ({ name: item.name, qty: item.quantity, price: item.price })),
            subtotal: subtotal,
            coupon: coupon || null,
            loyaltyDiscount: finalLoyaltyDiscount,
            discount: finalDiscount,
            cgst: cgst,
            sgst: sgst,
            deliveryCharge: deliveryCharge,
            totalAmount: grandTotal,
            status: 'pending',
            priority: Math.floor(Math.random() * 5) + 1,
            orderDate: adminFirestore.FieldValue.serverTimestamp(),
            notes: notes || null
        });
        
        console.log(`[Order API] Order ${newOrderRef.id} created for user ${userId}. Grand total: ${grandTotal}`);

        await batch.commit();

        // --- NEW & CORRECTED WHATSAPP NOTIFICATION LOGIC ---
        const ownerId = restaurantData.ownerId;
        const businessPhoneNumberId = restaurantData.botPhoneNumberId;

        // 1. Get Owner's document from 'users' collection to find their phone number
        let ownerPhone;
        if (ownerId) {
            const ownerRef = firestore.collection('users').doc(ownerId);
            const ownerDoc = await ownerRef.get();
            if (ownerDoc.exists) {
                ownerPhone = ownerDoc.data().phone;
            }
        }
        
        // --- DEBUG CONSOLE LOG ---
        console.log(`[Order API Debug] Attempting to send notification. Owner Phone: ${ownerPhone}, Bot ID: ${businessPhoneNumberId}`);

        // 2. Check if we have both numbers before attempting to send
        if (ownerPhone && businessPhoneNumberId) {
             const ownerPhoneWithCode = '91' + ownerPhone;
             // This is the pre-approved Message Template payload
             const notificationPayload = {
                name: "new_order_notification", // CORRECTED/STANDARD TEMPLATE NAME
                language: { code: "en_US" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: name },
                            { type: "text", text: `₹${grandTotal.toFixed(2)}` },
                            { type: "text", text: newOrderRef.id }
                        ]
                    },
                    {
                        type: "button",
                        sub_type: "quick_reply",
                        index: "0",
                        parameters: [{ type: "payload", payload: `accept_order_${newOrderRef.id}` }]
                    },
                    {
                        type: "button",
                        sub_type: "quick_reply",
                        index: "1",
                        parameters: [{ type: "payload", payload: `reject_order_${newOrderRef.id}` }]
                    }
                ]
            };
            // --- DEBUG CONSOLE LOG ---
            console.log('[Order API Debug] Payload prepared. Sending message to:', ownerPhoneWithCode, 'using bot ID:', businessPhoneNumberId);
            // Use the centralized function to send the message
            await sendWhatsAppMessage(ownerPhoneWithCode, notificationPayload, businessPhoneNumberId);
        } else {
            console.warn(`[Order API] Owner phone or Bot ID not found for restaurant ${restaurantId}. Cannot send notification.`);
        }
        // --- END: CORRECTED LOGIC ---

        return NextResponse.json({ 
            message: 'Order placed successfully! We will notify you on WhatsApp.'
        }, { status: 200 });

    } catch (error) {
        console.error('CUSTOMER ORDER/REGISTER ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
