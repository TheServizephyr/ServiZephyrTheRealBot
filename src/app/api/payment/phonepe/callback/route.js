import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const body = await req.json();

        console.log("[PhonePe Webhook] Received callback:", JSON.stringify(body, null, 2));

        // PhonePe sends the payment status in the body
        const { code, merchantTransactionId, transactionId, amount, state } = body.data || body;

        if (!merchantTransactionId) {
            console.error("[PhonePe Webhook] No merchantTransactionId found");
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        // Handle Payment Success
        if (code === 'PAYMENT_SUCCESS' || state === 'COMPLETED') {
            console.log(`[PhonePe Webhook] Payment SUCCESS for Order: ${merchantTransactionId}`);

            const orderRef = adminDb.collection('orders').doc(merchantTransactionId);
            const orderDoc = await orderRef.get();

            if (orderDoc.exists) {
                await orderRef.update({
                    paymentStatus: 'paid',
                    paymentMethod: 'phonepe',
                    transactionId: transactionId,
                    updatedAt: new Date(),
                    status: 'confirmed'
                });
                console.log(`[PhonePe Webhook] Order ${merchantTransactionId} updated to PAID`);
            } else {
                console.warn(`[PhonePe Webhook] Order ${merchantTransactionId} not found in Firestore`);
            }
        } else {
            console.log(`[PhonePe Webhook] Payment FAILED/PENDING: ${code || state}`);

            const orderRef = adminDb.collection('orders').doc(merchantTransactionId);
            if ((await orderRef.get()).exists) {
                await orderRef.update({
                    paymentStatus: 'failed',
                    paymentFailureReason: code || state,
                    updatedAt: new Date()
                });
            }
        }

        // Acknowledge PhonePe
        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("[PhonePe Webhook] Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
