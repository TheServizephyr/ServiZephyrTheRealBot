/**
 * RAZORPAY PROVIDER
 * 
 * Handles Razorpay payment gateway integration.
 * 
 * Phase 5 Step 2.5
 */

import Razorpay from 'razorpay';

export class RazorpayProvider {
    constructor() {
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.warn('[RazorpayProvider] Credentials not configured');
            this.client = null;
        } else {
            this.client = new Razorpay({
                key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
                key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
        }
    }

    /**
     * Create Razorpay order
     */
    async createOrder({ amount, orderId, metadata = {} }) {
        if (!this.client) {
            throw new Error('Razorpay not configured');
        }

        const options = {
            amount: Math.round(amount * 100), // Convert to paise
            currency: 'INR',
            receipt: orderId,
            notes: {
                ...metadata,
                firestore_order_id: orderId
            }
        };

        console.log(`[RazorpayProvider] Creating order for ₹${amount}`);
        const razorpayOrder = await this.client.orders.create(options);

        console.log(`[RazorpayProvider] Order created: ${razorpayOrder.id}`);
        return {
            id: razorpayOrder.id,
            amount: razorpayOrder.amount / 100, // Convert back to rupees
            currency: razorpayOrder.currency,
            receipt: razorpayOrder.receipt,
            status: razorpayOrder.status
        };
    }

    /**
     * Verify payment signature
     */
    verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
        const crypto = require('crypto');
        const text = `${razorpayOrderId}|${razorpayPaymentId}`;
        const signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(text)
            .digest('hex');

        return signature === razorpaySignature;
    }
}
