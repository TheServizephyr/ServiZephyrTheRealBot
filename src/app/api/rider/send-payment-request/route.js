import { NextResponse } from 'next/server';
import { FieldValue, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { sanitizeUpiId, sendManualPaymentRequestToCustomer } from '@/lib/manual-upi-payment';

function getBusinessCollectionFromType(businessType = 'restaurant') {
    if (businessType === 'shop') return 'shops';
    if (businessType === 'street-vendor') return 'street_vendors';
    return 'restaurants';
}

async function invalidateOrderStatusCache(orderId) {
    try {
        const { kv } = await import('@vercel/kv');
        if (process.env.KV_REST_API_URL) {
            await kv.del(`order_status:${orderId}`);
        }
    } catch (cacheErr) {
        console.warn('[Rider Send Payment Request] Cache invalidation failed:', cacheErr?.message || cacheErr);
    }
}

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const uid = await verifyAndGetUid(req);
        const requestBaseUrl = new URL(req.url).origin;

        const { orderId } = await req.json();
        if (!orderId) {
            return NextResponse.json({ message: 'Order ID is required.' }, { status: 400 });
        }

        const orderRef = firestore.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) {
            return NextResponse.json({ message: 'Order not found.' }, { status: 404 });
        }

        const orderData = orderSnap.data() || {};
        if (orderData.deliveryBoyId !== uid) {
            return NextResponse.json({ message: 'You are not assigned to this order.' }, { status: 403 });
        }
        if (orderData.paymentStatus === 'paid') {
            return NextResponse.json({ message: 'Order payment is already marked as paid.' }, { status: 400 });
        }

        const businessId = orderData.restaurantId;
        if (!businessId) {
            return NextResponse.json({ message: 'Business ID is missing on this order.' }, { status: 400 });
        }

        const collectionName = getBusinessCollectionFromType(orderData.businessType || 'restaurant');
        const businessRef = firestore.collection(collectionName).doc(businessId);
        const businessSnap = await businessRef.get();
        if (!businessSnap.exists) {
            return NextResponse.json({ message: 'Business not found for this order.' }, { status: 404 });
        }

        const businessData = businessSnap.data() || {};
        const configuredUpiId = sanitizeUpiId(businessData?.upiId);
        if (!configuredUpiId || !configuredUpiId.includes('@')) {
            return NextResponse.json({ message: 'Restaurant UPI ID is not configured yet.' }, { status: 400 });
        }

        const paymentRequest = await sendManualPaymentRequestToCustomer({
            orderData,
            orderId,
            businessData,
            businessId,
            collectionName,
            baseUrl: requestBaseUrl
        });

        await orderRef.update({
            paymentRequestSentAt: FieldValue.serverTimestamp(),
            paymentRequestSentBy: uid,
            paymentRequestSentByRole: 'rider',
            paymentRequestStatus: 'sent',
            paymentRequestLink: paymentRequest.upiLink,
            paymentRequestImage: paymentRequest.qrCardUrl,
            paymentRequestAmount: paymentRequest.amount,
            paymentRequestCount: FieldValue.increment(1)
        });

        await invalidateOrderStatusCache(orderId);

        return NextResponse.json({
            success: true,
            message: 'Payment QR and Pay Now CTA sent to customer on WhatsApp.',
            orderId,
            upiLink: paymentRequest.upiLink
        });
    } catch (error) {
        console.error('[Rider Send Payment Request] Error:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to send payment request.' },
            { status: 500 }
        );
    }
}

export async function PATCH(req) {
    return POST(req);
}
