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

    // Check if this is an add-on payment
    if (merchantOrderId.startsWith('addon_')) {
        console.log(`[PhonePe Webhook] Detected ADD-ON payment: ${merchantOrderId}`);

        // Fetch add-on metadata from Firestore
        const addonRef = adminDb.collection('phonepe_pending_addons').doc(merchantOrderId);
        const addonDoc = await addonRef.get();

        if (!addonDoc.exists) {
            console.error(`[PhonePe Webhook] Add-on metadata not found for: ${merchantOrderId}`);
            return;
        }

        const addonData = addonDoc.data();
        const originalOrderId = addonData.orderId;

        console.log(`[PhonePe Webhook] Processing add-on for order: ${originalOrderId}`);

        // Update original order with add-on items
        const orderRef = adminDb.collection('orders').doc(originalOrderId);

        await adminDb.runTransaction(async (transaction) => {
            const orderDoc = await transaction.get(orderRef);

            if (!orderDoc.exists) {
                throw new Error(`Original order ${originalOrderId} not found`);
            }

            const orderData = orderDoc.data();

            // Add timestamp to new items
            const currentTimestamp = new Date();
            const itemsWithTimestamp = addonData.items.map(item => ({
                ...item,
                addedAt: currentTimestamp,
                isAddon: true
            }));

            // Ensure existing items have timestamps
            const existingItemsWithTimestamp = orderData.items.map(item => ({
                ...item,
                addedAt: item.addedAt || orderData.orderDate?.toDate?.() || new Date(orderData.orderDate) || currentTimestamp,
                isAddon: item.isAddon || false
            }));

            const newItems = [...existingItemsWithTimestamp, ...itemsWithTimestamp];
            const newSubtotal = orderData.subtotal + addonData.subtotal;
            const newCgst = orderData.cgst + addonData.cgst;
            const newSgst = orderData.sgst + addonData.sgst;
            const newGrandTotal = orderData.totalAmount + addonData.grandTotal;

            // Update order
            transaction.update(orderRef, {
                items: newItems,
                subtotal: newSubtotal,
                cgst: newCgst,
                sgst: newSgst,
                totalAmount: newGrandTotal,
                paymentDetails: adminDb.FieldValue.arrayUnion({
                    method: 'phonepe',
                    amount: amount / 100,
                    phonePeOrderId: orderId,
                    phonePeTransactionId: paymentDetails?.[0]?.transactionId || null,
                    status: 'paid',
                    timestamp: new Date(),
                    isAddon: true
                }),
                statusHistory: adminDb.FieldValue.arrayUnion({
                    status: 'updated',
                    timestamp: currentTimestamp,
                    notes: `Added ${addonData.items.length} item(s) via PhonePe add-on payment`
                }),
                updatedAt: new Date()
            });

            // Mark add-on as completed
            transaction.update(addonRef, {
                status: 'completed',
                completedAt: adminDb.FieldValue.serverTimestamp()
            });
        });

        console.log(`[PhonePe Webhook] Add-on items added successfully to order ${originalOrderId}`);
        return;
    }

    // Regular order payment (non-add-on)
    const orderRef = adminDb.collection('orders').doc(merchantOrderId);
    const orderDoc = await orderRef.get();

    if (orderDoc.exists) {
        const currentStatus = orderDoc.data().status;
        console.log(`[PhonePe Webhook] Processing regular order ${merchantOrderId}, current status: ${currentStatus}`);

        await orderRef.update({
            paymentStatus: 'paid',
            paymentMethod: 'phonepe',
            phonePeOrderId: orderId,
            phonePeTransactionId: paymentDetails?.[0]?.transactionId || null,
            phonePePaymentMode: paymentDetails?.[0]?.paymentMode || null,
            paidAmount: amount / 100, // Convert paise to rupees
            status: 'pending', // Set to pending so it appears on vendor dashboard
            paymentDetails: adminDb.FieldValue.arrayUnion({
                method: 'phonepe',
                amount: amount / 100,
                phonePeOrderId: orderId,
                phonePeTransactionId: paymentDetails?.[0]?.transactionId || null,
                status: 'paid',
                timestamp: new Date()
            }),
            updatedAt: new Date()
        });
        console.log(`[PhonePe Webhook] Order ${merchantOrderId} updated from ${currentStatus} to PENDING with PAID status`);
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
