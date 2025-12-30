import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import Razorpay from 'razorpay';

export const dynamic = 'force-dynamic';

// POST: Settle payment for existing dine-in orders
export async function POST(req) {
    try {
        const { tabId, restaurantId, paymentMethod, grandTotal } = await req.json();

        if (!tabId || !restaurantId) {
            return NextResponse.json({ message: 'TabId and RestaurantId required' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // For online payment, create Razorpay order
        if (paymentMethod === 'razorpay' || paymentMethod === 'online') {
            if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                return NextResponse.json({ message: 'Payment gateway not configured' }, { status: 500 });
            }

            const razorpay = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });

            const razorpayOrder = await razorpay.orders.create({
                amount: Math.round(grandTotal * 100),
                currency: 'INR',
                receipt: `settlement_${tabId}_${Date.now()}`,
                notes: {
                    type: 'dine-in-settlement',
                    tabId,
                    restaurantId
                }
            });

            console.log(`[Settle Payment] Razorpay order created: ${razorpayOrder.id}`);

            return NextResponse.json({
                message: 'Razorpay order created for settlement',
                razorpay_order_id: razorpayOrder.id,
                tabId,
                amount: grandTotal
            }, { status: 200 });
        }

        // For Pay at Counter - just mark as pending payment
        if (paymentMethod === 'cod' || paymentMethod === 'counter') {
            // Update all orders for this tab
            const ordersQuery = await firestore.collection('orders')
                .where('dineInTabId', '==', tabId)
                .where('restaurantId', '==', restaurantId)
                .where('status', 'not-in', ['rejected', 'picked_up'])
                .get();

            const batch = firestore.batch();

            ordersQuery.docs.forEach(doc => {
                batch.update(doc.ref, {
                    paymentStatus: 'pay_at_counter',
                    paymentMethod: 'counter',
                    updatedAt: FieldValue.serverTimestamp()
                });
            });

            await batch.commit();

            return NextResponse.json({
                message: 'Payment marked as pay at counter',
                tabId
            }, { status: 200 });
        }

        return NextResponse.json({ message: 'Invalid payment method' }, { status: 400 });

    } catch (error) {
        console.error('[Settle Payment] Error:', error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
