/**
 * PAYMENT SERVICE
 * 
 * Unified payment gateway orchestrator.
 * Handles Razorpay, PhonePe, and other payment methods.
 * 
 * Phase 5 Step 2.5
 */

import { RazorpayProvider } from './razorpay.provider';
import { PhonePeProvider } from './phonepe.provider';

export class PaymentService {
    constructor() {
        this.razorpay = new RazorpayProvider();
        this.phonepe = new PhonePeProvider();
    }

    /**
     * Create payment order based on gateway
     */
    async createPaymentOrder({ gateway, amount, orderId, metadata = {} }) {
        console.log(`[PaymentService] Creating ${gateway} payment for order ${orderId}`);

        switch (gateway) {
            case 'razorpay':
            case 'online': // Default to Razorpay
                return await this.razorpay.createOrder({ amount, orderId, metadata });

            case 'phonepe':
                return await this.phonepe.createOrder({ amount, orderId, metadata });

            default:
                throw new Error(`Unknown payment gateway: ${gateway}`);
        }
    }

    /**
     * Determine payment gateway from request
     */
    determineGateway(paymentMethod) {
        if (paymentMethod === 'phonepe') {
            return 'phonepe';
        }

        if (paymentMethod === 'online' || paymentMethod === 'razorpay') {
            return 'razorpay';
        }

        return null; // Non-online payments (COD, counter)
    }
}

// Singleton export
export const paymentService = new PaymentService();
