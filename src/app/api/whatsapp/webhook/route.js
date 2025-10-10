
// A simple, robust webhook handler for Next.js App Router, optimized for Vercel.
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getFirestore, getAuth } from '@/lib/firebase-admin';
import { firestore as adminFirestore } from 'firebase-admin';

// These are your secret tokens and IDs. In production, Vercel will provide these.
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// Main function to send a message
const sendMessage = async (phoneNumber, payload, businessPhoneNumberId) => {
    try {
        const messagePayload = typeof payload === 'string' ? { text: { body: payload } } : payload;
        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${businessPhoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: phoneNumber,
                ...messagePayload
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
        console.log("[Webhook] POST request received.");
        console.log("[Webhook] Request Body:", JSON.stringify(body, null, 2));

        if (body.object !== 'whatsapp_business_account') {
            return NextResponse.json({ message: 'Not a WhatsApp event' }, { status: 200 });
        }

        const firestore = getFirestore();
        const change = body.entry?.[0]?.changes?.[0];
        
        // --- Logic for Interactive Button Presses ---
        if (change?.value?.messages?.[0]?.interactive?.button_reply) {
            const message = change.value.messages[0];
            const buttonReply = message.interactive.button_reply;
            const buttonId = buttonReply.id; // e.g., "accept_order_ORDER_ID" or "reject_order_ORDER_ID"
            const fromNumber = message.from; // Owner's number

            const [action, orderId] = buttonId.split('_order_');
            
            if (!orderId || !['accept', 'reject'].includes(action)) {
                console.log(`[Webhook] Ignoring invalid button ID: ${buttonId}`);
                return NextResponse.json({ message: 'Invalid button ID' }, { status: 200 });
            }

            const orderRef = firestore.collection('orders').doc(orderId);
            
            if (action === 'accept') {
                await orderRef.update({ status: 'confirmed' });
                console.log(`[Webhook] Order ${orderId} accepted by owner.`);
                
                // Now, notify the customer
                const orderDoc = await orderRef.get();
                if (orderDoc.exists) {
                    const orderData = orderDoc.data();
                    const customerPhoneWithCode = '91' + orderData.customerPhone; // Assuming Indian numbers
                    const restaurant = await firestore.collection('restaurants').doc(orderData.restaurantId).get();
                    const restaurantData = restaurant.data();

                    const confirmationMessage = `🎉 Your order #${orderId.substring(0, 5)} from *${orderData.restaurantName}* has been confirmed!\n\nWe've started preparing your meal. We will notify you at every step.`;
                    await sendMessage(customerPhoneWithCode, confirmationMessage, restaurantData.botPhoneNumberId);
                }

            } else if (action === 'reject') {
                await orderRef.delete();
                console.log(`[Webhook] Order ${orderId} rejected and deleted by owner.`);
                // Optionally, notify the owner that the order was rejected.
                // You could also notify the customer about the rejection.
            }
            
            // Acknowledge the button press to the owner
            const metadata = change.value.metadata;
            await sendMessage(fromNumber, { text: { body: `✅ Action complete: Order ${action.charAt(0).toUpperCase() + action.slice(1)}ed.` } }, metadata.phone_number_id);

        } 
        // --- Logic for Standard Text Messages (Customer Welcome) ---
        else if (change?.value?.messages?.[0]?.text) {
            const message = change.value.messages[0];
            const fromWithCode = message.from;
            const from = fromWithCode.startsWith('91') ? fromWithCode.substring(2) : fromWithCode;
            console.log(`[Webhook] Normalized phone number from ${fromWithCode} to ${from}`);

            const botPhoneNumberId = change.value.metadata.phone_number_id;

            const restaurantsRef = firestore.collection('restaurants');
            const restaurantQuery = await restaurantsRef.where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();

            if (restaurantQuery.empty) {
                console.error(`[Webhook] No restaurant found for Bot Phone Number ID: ${botPhoneNumberId}`);
                await sendMessage(fromWithCode, "We're sorry, we couldn't identify the restaurant you're trying to reach.", botPhoneNumberId);
                return NextResponse.json({ message: 'Restaurant not found' }, { status: 404 });
            }
            
            const restaurantDoc = restaurantQuery.docs[0];
            const restaurantId = restaurantDoc.id;
            const restaurantName = restaurantDoc.data().name;

            const usersRef = firestore.collection('users');
            const userQuery = await usersRef.where('phone', '==', from).limit(1).get();

            let welcomeMessage = '';
            if (!userQuery.empty) {
                const user = userQuery.docs[0].data();
                welcomeMessage = `Welcome back to ${restaurantName}, ${user.name}! 🥳`;
            } else {
                welcomeMessage = `Welcome to ${restaurantName}! 😃`;
            }

            const menuUrl = `https://servizephyr.com/order/${restaurantId}?phone=${from}`;
            const reply_body = `${welcomeMessage}\n\nWhat would you like to order today? You can view our full menu and place your order by clicking the link below:\n\n${menuUrl}`;
            
            await sendMessage(fromWithCode, reply_body, botPhoneNumberId);
        }
        
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook] Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
