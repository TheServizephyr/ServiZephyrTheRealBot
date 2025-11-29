import { NextResponse } from 'next/server';
import axios from 'axios';

// PhonePe API Configuration
const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox";
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID || "M23Z4Z8YT4OW5_2511281822";
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "MzY4MjkwYzctZGM3Mi00NDBjLWJjYjQtNzYyMjY5YWRkNDc0";
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

export async function GET(req, { params }) {
    try {
        const { orderId } = params;

        if (!orderId) {
            return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
        }

        // Step 1: Generate OAuth Token
        console.log("[PhonePe Status] Generating OAuth token...");
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
        console.log("[PhonePe Status] OAuth token generated");

        // Step 2: Check Order Status
        const statusResponse = await axios.get(
            `${PHONEPE_BASE_URL}/checkout/v2/order/${orderId}/status`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `O-Bearer ${accessToken}`
                }
            }
        );

        console.log("[PhonePe Status] Order status:", JSON.stringify(statusResponse.data, null, 2));

        return NextResponse.json({
            success: true,
            data: statusResponse.data
        });

    } catch (error) {
        console.error("[PhonePe Status] Error:", error.response?.data || error.message);
        return NextResponse.json({
            success: false,
            error: error.response?.data || error.message
        }, { status: 500 });
    }
}
