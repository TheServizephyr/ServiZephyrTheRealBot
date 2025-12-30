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

        console.log(`[Settle Payment] Method: ${paymentMethod}, TabId: ${tabId}, Amount: ${grandTotal}`);

        const firestore = await getFirestore();

        // Find business reference (restaurantId is the document ID)
        let businessRef;
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

        for (const collectionName of collectionsToTry) {
            const docRef = firestore.collection(collectionName).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessRef = docRef;
                console.log(`[Settle Payment] Business found in ${collectionName}`);
                break;
            }
        }

        if (!businessRef) {
            console.error(`[Settle Payment] Business not found with ID: ${restaurantId}`);
            return NextResponse.json({ message: 'Business not found' }, { status: 404 });
        }

        const businessDoc = await businessRef.get();
        const businessData = businessDoc.data();
        console.log(`[Settle Payment] Business: ${businessData.name}`);


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
            const ordersQuery = await businessRef.collection('orders')
                .where('dineInTabId', '==', tabId)
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

        // For PhonePe payment
        if (paymentMethod === 'phonepe') {
            console.log('[Settle Payment] PhonePe payment - creating Razorpay order as fallback');
            // PhonePe implementation can be added later, for now use Razorpay
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
                receipt: `settlement_phonepe_${tabId}_${Date.now()}`,
                notes: {
                    type: 'dine-in-settlement',
                    tabId,
                    restaurantId,
                    method: 'phonepe'
                }
            });

            return NextResponse.json({
                message: 'Payment order created',
                razorpay_order_id: razorpayOrder.id,
                tabId,
                amount: grandTotal
            }, { status: 200 });
        }

        // For Split Bill - not supported for settlement yet
        if (paymentMethod === 'split_bill') {
            console.log('[Settle Payment] Split bill requested - not supported for post-paid settlement');
            return NextResponse.json({
                message: 'Split bill is not supported for post-paid orders. Please pay the full amount.',
                tabId
            }, { status: 400 });
        }

        return NextResponse.json({ message: `Unsupported payment method: ${paymentMethod}` }, { status: 400 });

    } catch (error) {
        console.error('[Settle Payment] Error:', error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
