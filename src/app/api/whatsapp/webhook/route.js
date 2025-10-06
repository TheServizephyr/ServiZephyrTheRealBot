
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
        const from = message.from; // Customer's phone number
        const msg_body = message.text?.body || ''; // The message text
        const botPhoneNumberId = body.entry[0].changes[0].value.metadata.phone_number_id;

        const firestore = getFirestore();

        // 1. Find the restaurant using the bot's phone number ID
        const restaurantsRef = firestore.collection('restaurants');
        const restaurantQuery = await restaurantsRef.where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();

        if (restaurantQuery.empty) {
            console.error(`[Webhook] No restaurant found for Bot Phone Number ID: ${botPhoneNumberId}`);
            await sendMessage(from, "We're sorry, we couldn't identify the restaurant you're trying to reach.");
            return NextResponse.json({ message: 'Restaurant not found' }, { status: 404 });
        }
        
        const restaurantDoc = restaurantQuery.docs[0];
        const restaurantId = restaurantDoc.id;
        const restaurantName = restaurantDoc.data().name;

        // 2. Check if the user is registered (in 'users' collection)
        const usersRef = firestore.collection('users');
        const userQuery = await usersRef.where('phone', '==', from).limit(1).get();

        let reply_body = '';

        if (!userQuery.empty) {
            // User is registered and exists in the master 'users' list
            const user = userQuery.docs[0].data();
            reply_body = `Welcome back to ${restaurantName}, ${user.name}! 🥳\n\nWhat would you like to order today? You can view our menu here: https://servizephyr.com/order/${restaurantId}`;
        } else {
            // User is not in master list, check for an unclaimed profile
            const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(from);
            const unclaimedProfileDoc = await unclaimedProfileRef.get();

            if (unclaimedProfileDoc.exists) {
                // Unclaimed profile exists, means they registered via a form from another restaurant
                 reply_body = `Welcome back, ${unclaimedProfileDoc.data().name}! To complete your signup and start ordering from ${restaurantName}, please click here: https://servizephyr.com/complete-profile?phone=${from}`;
            } else {
                // Brand new customer, never seen before.
                const registrationUrl = `https://servizephyr.com/customer-form?restaurantId=${restaurantId}&phone=${from}`;
                reply_body = `Welcome to ${restaurantName}! 😃\n\nTo get started, please quickly tell us your name and address by clicking the link below:\n\n${registrationUrl}\n\nWe only need this once!`;
            }
        }
        
        // Send the reply message
        await sendMessage(from, reply_body);
    }
    
    return NextResponse.json({ message: 'Event received' }, { status: 200 });

  } catch (error) {
    console.error('[Webhook] Error processing POST request:', error);
    return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
  }
}
