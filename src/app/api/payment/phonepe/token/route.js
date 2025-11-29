import { NextResponse } from 'next/server';
import axios from 'axios';

// PhonePe OAuth Credentials
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID || "M23Z4Z8YT4OW5_2511281822";
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "MzY4MjkwYzctZGM3Mi00NDBjLWJjYjQtNzYyMjY5YWRkNDc0";
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const PHONEPE_AUTH_URL = process.env.PHONEPE_AUTH_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

// In-memory token cache (simple implementation)
let tokenCache = {
    access_token: null,
    expires_at: null
};

export async function GET(req) {
    try {
        // Check if cached token is still valid
        const now = Math.floor(Date.now() / 1000);
        if (tokenCache.access_token && tokenCache.expires_at && tokenCache.expires_at > now + 60) {
            console.log("[PhonePe Token] Using cached token");
            return NextResponse.json({
                success: true,
                access_token: tokenCache.access_token,
                expires_at: tokenCache.expires_at
            });
        }

        // Generate new token
        console.log("[PhonePe Token] Generating new token...");

        const requestBody = new URLSearchParams({
            client_id: CLIENT_ID,
            client_version: CLIENT_VERSION,
            client_secret: CLIENT_SECRET,
            grant_type: "client_credentials"
        }).toString();

        const response = await axios.post(PHONEPE_AUTH_URL, requestBody, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const { access_token, expires_at } = response.data;

        // Cache the token
        tokenCache = {
            access_token,
            expires_at
        };

        console.log("[PhonePe Token] New token generated successfully");

        return NextResponse.json({
            success: true,
            access_token,
            expires_at
        });

    } catch (error) {
        console.error("[PhonePe Token] Error:", error.response?.data || error.message);
        return NextResponse.json({
            success: false,
            error: error.response?.data || error.message
        }, { status: 500 });
    }
}
