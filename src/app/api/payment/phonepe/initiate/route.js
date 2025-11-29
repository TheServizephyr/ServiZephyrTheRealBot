import { NextResponse } from 'next/server';
import axios from 'axios';

// PhonePe API Configuration
const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox";
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "M23Z4Z8YT4OW5";
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID || "M23Z4Z8YT4OW5_2511281822";
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "MzY4MjkwYzctZGM3Mi00NDBjLWJjYjQtNzYyMjY5YWRkNDc0";
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

export async function POST(req) {
    try {
        const { amount, orderId, customerPhone } = await req.json();

        if (!amount || !orderId) {
            return NextResponse.json({ error: "Amount and Order ID are required" }, { status: 400 });
        }

        // Step 1: Generate OAuth Token (inline to avoid fetch issues)
        console.log("[PhonePe Initiate] Generating OAuth token...");
        const tokenRequestBody = new URLSearchParams({
            client_id: CLIENT_ID,
            client_version: CLIENT_VERSION,
            client_secret: CLIENT_SECRET,
            grant_type: "client_credentials"
        }).toString();

        const tokenResponse = await axios.post(PHONEPE_AUTH_URL, tokenRequestBody, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const accessToken = tokenResponse.data.access_token;
        console.log("[PhonePe Initiate] OAuth token generated successfully");
        console.log("[PhonePe Initiate] OAuth token obtained");

        // Step 2: Create Payment Request
        const amountInPaise = Math.round(amount * 100);
        const callbackUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.servizephyr.com'}/api/payment/phonepe/callback`;
        const redirectUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.servizephyr.com'}/order-status/${orderId}`;

        const paymentPayload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: orderId,
            merchantUserId: customerPhone || "GUEST_USER",
            amount: amountInPaise,
            redirectUrl: redirectUrl,
            redirectMode: "REDIRECT",
            callbackUrl: callbackUrl,
            mobileNumber: customerPhone || "9999999999",
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        console.log("[PhonePe Initiate] Payment payload:", JSON.stringify(paymentPayload, null, 2));

        // Step 3: Call PhonePe Payment API
        const paymentResponse = await axios.post(
            `${PHONEPE_BASE_URL}/pg/v1/pay`,
            paymentPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );

        console.log("[PhonePe Initiate] Payment response:", JSON.stringify(paymentResponse.data, null, 2));

        // Step 4: Return redirect URL
        if (paymentResponse.data.success && paymentResponse.data.data?.instrumentResponse?.redirectInfo?.url) {
            return NextResponse.json({
                success: true,
                url: paymentResponse.data.data.instrumentResponse.redirectInfo.url,
                transactionId: paymentResponse.data.data.merchantTransactionId
            });
        } else {
            throw new Error(paymentResponse.data.message || "Payment initiation failed");
        }

    } catch (error) {
        console.error("[PhonePe Initiate] Error:", error.response?.data || error.message);
        return NextResponse.json({
            success: false,
            error: error.response?.data || error.message
        }, { status: 500 });
    }
}
