import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import crypto from 'crypto';

// PhonePe Webhook Credentials (set these in Vercel environment variables)
const WEBHOOK_USERNAME = process.env.PHONEPE_WEBHOOK_USERNAME || "servizephyr_webhook";
const WEBHOOK_PASSWORD = process.env.PHONEPE_WEBHOOK_PASSWORD || "your_secure_password_here";

// Generate expected authorization hash
const expectedAuthHash = crypto
    .createHash('sha256')
    .update(`${WEBHOOK_USERNAME}:${WEBHOOK_PASSWORD}`)
    .digest('hex');

export async function POST(req) {
    try {
        // Step 1: Verify Authorization Header
        const authHeader = req.headers.get('authorization');

        if (!authHeader) {
            console.error("[PhonePe Webhook] No authorization header found");
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Remove "SHA256 " prefix if present and compare
        const receivedHash = authHeader.replace(/^SHA256\s+/i, '').trim();

        if (receivedHash !== expectedAuthHash) {
            console.error("[PhonePe Webhook] Authorization failed");
            console.error("[PhonePe Webhook] Expected:", expectedAuthHash);
            console.error("[PhonePe Webhook] Received:", receivedHash);
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        console.log("[PhonePe Webhook] Authorization verified ✓");

        // Step 2: Parse Webhook Payload
        const body = await req.json();
        console.log("[PhonePe Webhook] Received event:", JSON.stringify(body, null, 2));

        const { event, payload } = body;

        if (!event || !payload) {
            console.error("[PhonePe Webhook] Invalid payload structure");
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        // Step 3: Handle Different Event Types
        switch (event) {
            case 'checkout.order.completed':
                await handleOrderCompleted(payload);
                break;

            case 'checkout.order.failed':
                await handleOrderFailed(payload);
                break;

            case 'pg.refund.completed':
                await handleRefundCompleted(payload);
                break;

            case 'pg.refund.failed':
                await handleRefundFailed(payload);
                break;

            default:
                console.warn(`[PhonePe Webhook] Unknown event type: ${event}`);
        }

        // Acknowledge receipt
        return NextResponse.json({ success: true, message: "Webhook processed" });

    } catch (error) {
        console.error("[PhonePe Webhook] Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// Handler for Order Completed
async function handleOrderCompleted(payload) {
    const { merchantOrderId, orderId, state, amount, paymentDetails } = payload;

    console.log(`[PhonePe Webhook] Order COMPLETED: ${merchantOrderId}`);

    const orderRef = adminDb.collection('orders').doc(merchantOrderId);
    const orderDoc = await orderRef.get();

    if (orderDoc.exists) {
        await orderRef.update({
            paymentStatus: 'paid',
            paymentMethod: 'phonepe',
            phonePeOrderId: orderId,
            phonePeTransactionId: paymentDetails?.[0]?.transactionId || null,
            phonePePaymentMode: paymentDetails?.[0]?.paymentMode || null,
            paidAmount: amount / 100, // Convert paise to rupees
            status: 'confirmed',
            updatedAt: new Date()
        });
        console.log(`[PhonePe Webhook] Order ${merchantOrderId} updated to PAID`);
    } else {
        console.warn(`[PhonePe Webhook] Order ${merchantOrderId} not found in Firestore`);
    }
}

// Handler for Order Failed
async function handleOrderFailed(payload) {
    const { merchantOrderId, orderId, state, errorCode, detailedErrorCode } = payload;

    console.log(`[PhonePe Webhook] Order FAILED: ${merchantOrderId}`);

    const orderRef = adminDb.collection('orders').doc(merchantOrderId);
    const orderDoc = await orderRef.get();

    if (orderDoc.exists) {
        await orderRef.update({
            paymentStatus: 'failed',
            paymentMethod: 'phonepe',
            phonePeOrderId: orderId,
            paymentFailureReason: errorCode || 'Unknown error',
            paymentFailureDetails: detailedErrorCode || '',
            updatedAt: new Date()
        });
        console.log(`[PhonePe Webhook] Order ${merchantOrderId} marked as FAILED`);
    }
}

// Handler for Refund Completed
async function handleRefundCompleted(payload) {
    const { originalMerchantOrderId, refundId, amount, state, timestamp } = payload;

    console.log(`[PhonePe Webhook] Refund COMPLETED: ${refundId} for order ${originalMerchantOrderId}`);

    const orderRef = adminDb.collection('orders').doc(originalMerchantOrderId);
    const orderDoc = await orderRef.get();

    if (orderDoc.exists) {
        await orderRef.update({
            refundStatus: 'completed',
            phonePeRefundId: refundId,
            refundedAmount: amount / 100, // Convert paise to rupees
            refundCompletedAt: new Date(timestamp),
            updatedAt: new Date()
        });
        console.log(`[PhonePe Webhook] Refund ${refundId} completed for order ${originalMerchantOrderId}`);
    }
}

// Handler for Refund Failed
async function handleRefundFailed(payload) {
    const { originalMerchantOrderId, refundId, errorCode, detailedErrorCode } = payload;

    console.log(`[PhonePe Webhook] Refund FAILED: ${refundId} for order ${originalMerchantOrderId}`);

    const orderRef = adminDb.collection('orders').doc(originalMerchantOrderId);
    const orderDoc = await orderRef.get();

    if (orderDoc.exists) {
        await orderRef.update({
            refundStatus: 'failed',
            phonePeRefundId: refundId,
            refundFailureReason: errorCode || 'Unknown error',
            refundFailureDetails: detailedErrorCode || '',
            updatedAt: new Date()
        });
        console.log(`[PhonePe Webhook] Refund ${refundId} failed for order ${originalMerchantOrderId}`);
    }
}
