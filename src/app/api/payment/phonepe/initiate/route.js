import { NextResponse } from 'next/server';
import crypto from 'crypto';
import axios from 'axios';

// PhonePe Credentials (from Environment Variables)
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "PGTESTPAYUAT";
const SALT_KEY = process.env.PHONEPE_SALT_KEY || "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399";
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX || 1;
const PHONEPE_HOST_URL = process.env.PHONEPE_HOST_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox"; // Default to Sandbox if not set

export async function POST(req) {
    try {
        const { amount, orderId, customerPhone } = await req.json();

        if (!amount || !orderId) {
            return NextResponse.json({ error: "Amount and Order ID are required" }, { status: 400 });
        }

        // PhonePe expects amount in paise (100 paise = 1 Rupee)
        const amountInPaise = Math.round(amount * 100);

        // Callback URL (where PhonePe will send status updates)
        // Note: In localhost, this won't work perfectly without ngrok, but for redirect it's fine
        const callbackUrl = `https://www.servizephyr.com/api/payment/phonepe/callback`;

        // Redirect URL (where user goes after payment)
        const redirectUrl = `https://www.servizephyr.com/order-status/${orderId}`;

        const payload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: orderId,
            merchantUserId: customerPhone || "MUID123",
            amount: amountInPaise,
            redirectUrl: redirectUrl,
            redirectMode: "REDIRECT",
            callbackUrl: callbackUrl,
            mobileNumber: customerPhone || "9999999999",
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        // 1. Convert payload to JSON string
        const payloadString = JSON.stringify(payload);

        // 2. Encode payload to Base64
        const base64Payload = Buffer.from(payloadString).toString('base64');

        // 3. Generate Checksum (X-VERIFY header)
        // Format: SHA256(base64Payload + "/pg/v1/pay" + saltKey) + ### + saltIndex
        const stringToHash = base64Payload + "/pg/v1/pay" + SALT_KEY;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const checksum = sha256 + "###" + SALT_INDEX;

        // 4. Call PhonePe API
        const options = {
            method: 'POST',
            url: `${PHONEPE_HOST_URL}/pg/v1/pay`,
            headers: {
                accept: 'application/json',
                'Content-Type': 'application/json',
                'X-VERIFY': checksum
            },
            data: {
                request: base64Payload
            }
        };

        const response = await axios.request(options);

        // 5. Return the redirect URL to frontend
        if (response.data.success) {
            return NextResponse.json({
                success: true,
                url: response.data.data.instrumentResponse.redirectInfo.url,
                transactionId: response.data.data.merchantTransactionId
            });
        } else {
            return NextResponse.json({ success: false, error: response.data.message }, { status: 400 });
        }

    } catch (error) {
        console.error("PhonePe Initiation Error:", error.response?.data || error.message);
        return NextResponse.json({
            success: false,
            error: error.response?.data?.message || error.message
        }, { status: 500 });
    }
}
