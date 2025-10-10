
// A simple, robust webhook handler for Next.js App Router, optimized for Vercel.
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendOrderConfirmationToCustomer } from '@/lib/notifications';


const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

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
            const buttonId = buttonReply.id; // e.g., "accept_order_ORDER_ID"
            const fromNumber = message.from; // Owner's number
            const businessPhoneNumberId = change.value.metadata.phone_number_id;
            
            console.log(`[Webhook Debug] Button pressed. ID: ${buttonId}, From: ${fromNumber}`);

            const [action, ...orderIdParts] = buttonId.split('_order_');
            const orderId = orderIdParts.join('_order_'); // Re-join in case order ID has underscores
            
            if (!orderId || !['accept', 'reject'].includes(action)) {
                console.log(`[Webhook] Ignoring invalid button ID: ${buttonId}`);
                return NextResponse.json({ message: 'Invalid button ID' }, { status: 200 });
            }

            const orderRef = firestore.collection('orders').doc(orderId);
            
            if (action === 'accept') {
                await orderRef.update({ status: 'confirmed' });
                console.log(`[Webhook] Order ${orderId} accepted by owner.`);
                
                // Now, notify the customer using the centralized notification service
                const orderDoc = await orderRef.get();
                if (orderDoc.exists) {
                    const orderData = orderDoc.data();
                    
                    // Call the centralized function
                    await sendOrderConfirmationToCustomer({
                        customerPhone: orderData.customerPhone,
                        botPhoneNumberId: businessPhoneNumberId,
                        customerName: orderData.customerName,
                        orderId: orderId,
                        restaurantName: orderData.restaurantName
                    });
                }

            } else if (action === 'reject') {
                // In a real app, you might want to update status to 'rejected' instead of deleting
                await orderRef.delete();
                console.log(`[Webhook] Order ${orderId} rejected and deleted by owner.`);
            }
            
            // Acknowledge the button press to the owner
            await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${action.charAt(0).toUpperCase() + action.slice(1)}ed.`, businessPhoneNumberId);

        } 
        // --- Logic for Standard Text Messages (Customer Welcome) ---
        else if (change?.value?.messages?.[0]?.text) {
            const message = change.value.messages[0];
            const fromWithCode = message.from; // This is the customer's number with country code but no space
            const botPhoneNumberId = change.value.metadata.phone_number_id;

            console.log(`[Webhook] Received text from customer ${fromWithCode} for bot ID ${botPhoneNumberId}`);

            // 1. Find the restaurant using the botPhoneNumberId
            const restaurantsRef = firestore.collection('restaurants');
            const restaurantQuery = await restaurantsRef.where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();

            if (restaurantQuery.empty) {
                console.error(`[Webhook] No restaurant found for Bot Phone Number ID: ${botPhoneNumberId}`);
                await sendWhatsAppMessage(fromWithCode, "We're sorry, we couldn't identify the restaurant you're trying to reach.", botPhoneNumberId);
                return NextResponse.json({ message: 'Restaurant not found' }, { status: 404 });
            }
            
            const restaurantDoc = restaurantQuery.docs[0];
            const restaurantId = restaurantDoc.id;
            const restaurantData = restaurantDoc.data();
            const restaurantName = restaurantData.name;

            console.log(`[Webhook Debug] Matched to restaurant: ${restaurantName} (ID: ${restaurantId})`);

            // 2. Find customer's name for a personalized welcome
            const customerPhone = fromWithCode.startsWith('91') ? fromWithCode.substring(2) : fromWithCode;
            const usersRef = firestore.collection('users');
            const userQuery = await usersRef.where('phone', '==', customerPhone).limit(1).get();
            
            let welcomeMessage = `Welcome to ${restaurantName}! 😃`;
            if (!userQuery.empty) {
                const user = userQuery.docs[0].data();
                welcomeMessage = `Welcome back to ${restaurantName}, ${user.name}! 🥳`;
            }

            const menuUrl = `https://servizephyr.com/order/${restaurantId}?phone=${customerPhone}`;
            const reply_body = `${welcomeMessage}\n\nWhat would you like to order today? You can view our full menu and place your order by clicking the link below:\n\n${menuUrl}`;
            
            const customerPhoneForApi = '91 ' + customerPhone; // Add space for the API call
            console.log(`[Webhook Debug] Sending welcome message to customer: ${customerPhoneForApi}`);
            await sendWhatsAppMessage(customerPhoneForApi, reply_body, botPhoneNumberId);
        }
        
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook] Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
