
// A simple, robust webhook handler for Next.js App Router, optimized for Vercel.
import { NextResponse } from 'next/server';

// This is your secret token. In production, use environment variables.
const VERIFY_TOKEN = "123";

// Handles GET requests for webhook verification
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Use .get() to safely access query parameters
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    console.log("[Next.js Webhook] Received verification request on Vercel.");
    console.log("Mode:", mode, "Token:", token, "Challenge:", challenge);

    // On Vercel, parameters should come through correctly.
    // We will do a proper check.
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Next.js Webhook] Verification successful. Responding with challenge.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.error("[Next.js Webhook] Verification FAILED. Mode or Token did not match.");
      return new NextResponse('Verification Failed', { status: 403 });
    }
  } catch (error) {
    console.error('[Next.js Webhook] Error in GET handler:', error);
    return new NextResponse('Server Error', { status: 500 });
  }
}

// Handles POST requests for incoming messages
export async function POST(request) {
  try {
    const body = await request.json();
    console.log("[Next.js Webhook] POST request received (incoming message) on Vercel.");
    console.log("[Next.js Webhook] Request Body:", JSON.stringify(body, null, 2));

    // You would add your message processing logic here.
    // For now, we just acknowledge receipt.

    return NextResponse.json({ message: 'Event received' }, { status: 200 });
  } catch (error) {
    console.error('[Next.js Webhook] Error processing POST request:', error);
    return NextResponse.json({ message: 'Error processing request' }, { status: 500 });
  }
}
