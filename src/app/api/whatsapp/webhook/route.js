
// A simple, robust webhook handler for Next.js App Router, optimized for Vercel.
import { NextResponse } from 'next/server';
import axios from 'axios';

// These are your secret tokens and IDs. In production, Vercel will provide these.
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Handles GET requests for webhook verification
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    console.log("[Vercel Webhook] Received verification request.");
    console.log("Mode:", mode, "Token:", token, "Challenge:", challenge);

    // Checks if a token and mode is in the query string of the request
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // Responds with the challenge token from the request
      console.log('[Vercel Webhook] Verification successful. Responding with challenge.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      // Responds with '403 Forbidden' if verify tokens do not match
      console.error("[Vercel Webhook] Verification FAILED. Mode or Token did not match.");
      return new NextResponse('Verification Failed', { status: 403 });
    }
  } catch (error) {
    console.error('[Vercel Webhook] Error in GET handler:', error);
    return new NextResponse('Server Error', { status: 500 });
  }
}

// Handles POST requests for incoming messages
export async function POST(request) {
  try {
    const body = await request.json();
    console.log("[Vercel Webhook] POST request received (incoming message).");
    console.log("[Vercel Webhook] Request Body:", JSON.stringify(body, null, 2));

    // --- Start Processing Logic ---
    // Check if it's a message notification
    if (body.object === 'whatsapp_business_account' && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        const message = body.entry[0].changes[0].value.messages[0];
        const from = message.from; // Customer's phone number
        const msg_body = message.text.body; // The message text

        // TODO: Add your AI or business logic here.
        // For now, we will just echo the message back.
        const reply_body = `You said: "${msg_body}"`;

        // Send the reply message using the Graph API
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: from,
                text: { body: reply_body }
            }
        });
        
        console.log(`[Vercel Webhook] Sent reply to ${from}`);
    }
    // --- End Processing Logic ---

    // Acknowledge receipt of the event
    return NextResponse.json({ message: 'Event received' }, { status: 200 });
  } catch (error) {
    console.error('[Vercel Webhook] Error processing POST request:', error.response ? error.response.data : error.message);
    // Even if we fail to process, we should still return a 200 OK to Meta to avoid being disabled.
    return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
  }
}
