
// A simple, robust webhook handler for Next.js App Router, optimized for Vercel.
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getFirestore } from '@/lib/firebase-admin';


// These are your secret tokens and IDs. In production, Vercel will provide these.
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// Main function to send a message
const sendMessage = async (phoneNumber, message) => {
    try {
        const payload = typeof message === 'string' ? { text: { body: message } } : message;
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: phoneNumber,
                ...payload
            }
        });
        console.log(`[Webhook] Sent message to ${phoneNumber}`);
    } catch (error) {
        console.error('[Webhook] Error sending message:', error.response ? error.response.data : error.message);
    }
};

// Handles GET requests for webhook verification
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    console.log("[Webhook] Received verification request.");

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Webhook] Verification successful.');
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.error("[Webhook] Verification FAILED. Tokens do not match.");
      return new NextResponse('Verification Failed', { status: 403 });
    }
  } catch (error) {
    console.error('[Webhook] Error in GET handler:', error);
    return new NextResponse('Server Error', { status: 500 });
  }
}

// Handles POST requests for incoming messages
export async function POST(request) {
  try {
    const body = await request.json();
    console.log("[Webhook] POST request received (incoming message).");
    console.log("[Webhook] Request Body:", JSON.stringify(body, null, 2));

    // --- Start Processing Logic ---
    if (body.object === 'whatsapp_business_account' && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
        const message = body.entry[0].changes[0].value.messages[0];
        const fromWithCode = message.from; // Customer's phone number with country code
        
        // --- FIX: Normalize phone number to 10 digits ---
        const from = fromWithCode.startsWith('91') ? fromWithCode.substring(2) : fromWithCode;
        console.log(`[Webhook] Normalized phone number from ${fromWithCode} to ${from}`);

        const msg_body = message.text?.body || ''; // The message text
        const botPhoneNumberId = body.entry[0].changes[0].value.metadata.phone_number_id;

        const firestore = getFirestore();

        // 1. Find the restaurant using the bot's phone number ID
        const restaurantsRef = firestore.collection('restaurants');
        const restaurantQuery = await restaurantsRef.where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();

        if (restaurantQuery.empty) {
            console.error(`[Webhook] No restaurant found for Bot Phone Number ID: ${botPhoneNumberId}`);
            await sendMessage(fromWithCode, "We're sorry, we couldn't identify the restaurant you're trying to reach.");
            return NextResponse.json({ message: 'Restaurant not found' }, { status: 404 });
        }
        
        const restaurantDoc = restaurantQuery.docs[0];
        const restaurantId = restaurantDoc.id;
        const restaurantName = restaurantDoc.data().name;

        // 2. Check if the user is registered (in 'users' collection) using the 10-digit number
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('phone', '==', from).limit(1).get();

        let welcomeMessage = '';

        if (!userQuery.empty) {
            // User is registered and exists in the master 'users' list
            const user = userQuery.docs[0].data();
            welcomeMessage = `Welcome back to ${restaurantName}, ${user.name}! 🥳`;
        } else {
            // Brand new customer or unclaimed profile.
            welcomeMessage = `Welcome to ${restaurantName}! 😃`;
        }

        const menuUrl = `https://servizephyr.com/order/${restaurantId}?phone=${from}`;
        const reply_body = `${welcomeMessage}\n\nWhat would you like to order today? You can view our full menu and place your order by clicking the link below:\n\n${menuUrl}`;
        
        // Send the reply message to the original number with country code
        await sendMessage(fromWithCode, reply_body);
    }
    
    return NextResponse.json({ message: 'Event received' }, { status: 200 });

  } catch (error) {
    console.error('[Webhook] Error processing POST request:', error);
    return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
  }
}
