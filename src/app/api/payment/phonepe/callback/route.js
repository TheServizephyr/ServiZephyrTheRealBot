import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';

// PhonePe Credentials (from Environment Variables)
const SALT_KEY = process.env.PHONEPE_SALT_KEY || "368290c7-dc72-440c-bcb4-762269add474";
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX || 1;

export async function POST(req) {
    try {
        // 1. Get the payload and headers
        const { response } = await req.json(); // PhonePe sends { response: "base64..." }
        const xVerify = req.headers.get('x-verify');

        if (!response || !xVerify) {
            return NextResponse.json({ error: "Invalid Request" }, { status: 400 });
        }

        // 2. Verify Checksum (Security Check)
        // Formula: SHA256(response + saltKey) + ### + saltIndex
        const stringToHash = response + SALT_KEY;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const calculatedChecksum = sha256 + "###" + SALT_INDEX;

        if (xVerify !== calculatedChecksum) {
            console.error("[PhonePe Webhook] Checksum Mismatch!", { received: xVerify, calculated: calculatedChecksum });
            return NextResponse.json({ error: "Invalid Signature" }, { status: 401 });
        }

        // 3. Decode Payload
        const decodedBuffer = Buffer.from(response, 'base64');
        const decodedString = decodedBuffer.toString('utf-8');
        const data = JSON.parse(decodedString);

        console.log("[PhonePe Webhook] Received Update:", JSON.stringify(data, null, 2));

        const { code, merchantTransactionId, transactionId, amount } = data.data;

        // 4. Handle Payment Success
        if (code === 'PAYMENT_SUCCESS') {
            console.log(`[PhonePe Webhook] Payment SUCCESS for Order: ${merchantTransactionId}`);

            // Update Firestore Order
            const orderRef = adminDb.collection('orders').doc(merchantTransactionId);
            const orderDoc = await orderRef.get();

            if (orderDoc.exists) {
                await orderRef.update({
                    paymentStatus: 'paid',
                    paymentMethod: 'phonepe',
                    transactionId: transactionId,
                    updatedAt: new Date(),
                    status: 'confirmed' // Auto-confirm order on payment
                });
                console.log(`[PhonePe Webhook] Order ${merchantTransactionId} updated to PAID.`);
            } else {
                console.warn(`[PhonePe Webhook] Order ${merchantTransactionId} not found in Firestore.`);
            }
        } else {
            console.log(`[PhonePe Webhook] Payment FAILED/PENDING: ${code}`);
            // Optionally handle failure (update status to failed)
            const orderRef = adminDb.collection('orders').doc(merchantTransactionId);
            if ((await orderRef.get()).exists) {
                await orderRef.update({
                    paymentStatus: 'failed',
                    paymentFailureReason: code,
                    updatedAt: new Date()
                });
            }
        }

        // 5. Acknowledge PhonePe (Important!)
        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("[PhonePe Webhook] Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
