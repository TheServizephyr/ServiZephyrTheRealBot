
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendOrderConfirmationToCustomer } from '@/lib/notifications';


const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');


    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log("[Webhook] Verification SUCCESS. Responding with challenge.");
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

export async function POST(request) {
    try {
        const body = await request.json();
        
        if (process.env.NODE_ENV !== 'production') {
            console.log("[Webhook] Request Body:", JSON.stringify(body, null, 2));
        }

        if (body.object !== 'whatsapp_business_account') {
            return NextResponse.json({ message: 'Not a WhatsApp event' }, { status: 200 });
        }

        const firestore = getFirestore();
        const change = body.entry?.[0]?.changes?.[0];
        
        // --- Handler for Owner's Button Clicks ---
        if (change?.value?.messages?.[0]?.interactive?.button_reply) {
            const message = change.value.messages[0];
            const buttonReply = message.interactive.button_reply;
            const buttonId = buttonReply.id;
            const fromNumber = message.from; 
            const businessPhoneNumberId = change.value.metadata.phone_number_id;
            
            const [action, ...orderIdParts] = buttonId.split('_order_');
            const orderId = orderIdParts.join('_order_'); 
            
            if (!orderId || !['accept', 'reject'].includes(action)) {
                console.warn(`[Webhook] Invalid button ID format: ${buttonId}`);
                return NextResponse.json({ message: 'Invalid button ID' }, { status: 200 });
            }

            const orderRef = firestore.collection('orders').doc(orderId);
            const orderDoc = await orderRef.get();

            if (!orderDoc.exists) {
                 await sendWhatsAppMessage(fromNumber, `⚠️ Action failed: Order with ID ${orderId} was not found.`, businessPhoneNumberId);
                 return NextResponse.json({ message: 'Order not found' }, { status: 200 });
            }
            
            if (action === 'accept') {
                await orderRef.update({ status: 'confirmed' });
                
                const orderData = orderDoc.data();
                const restaurantDoc = await firestore.collection('restaurants').doc(orderData.restaurantId).get();
                
                if (restaurantDoc.exists) {
                    const restaurantData = restaurantDoc.data();
                    await sendOrderConfirmationToCustomer({
                        customerPhone: orderData.customerPhone,
                        botPhoneNumberId: businessPhoneNumberId,
                        customerName: orderData.customerName,
                        orderId: orderId,
                        restaurantName: restaurantData.name,
                    });
                }
                await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been confirmed. You can now start preparing it.`, businessPhoneNumberId);

            } else if (action === 'reject') {
                await orderRef.update({ status: 'rejected' });
                await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been rejected. The customer will be notified.`, businessPhoneNumberId);
                // Optionally, notify the customer that the order was rejected
            }
        } 
        // --- Handler for Customer's Text Messages ---
        else if (change?.value?.messages?.[0]?.text) {
            const message = change.value.messages[0];
            const fromWithCode = message.from; 
            const botPhoneNumberId = change.value.metadata.phone_number_id;

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

            // ** NEW ** Check if restaurant is open
            if (!restaurantData.isOpen) {
                const closedMessage = `We apologize, but ${restaurantName} is currently closed. Please check back later.`;
                await sendWhatsAppMessage(fromWithCode, closedMessage, botPhoneNumberId);
                return NextResponse.json({ message: 'Restaurant is closed' }, { status: 200 });
            }


            const customerPhone = fromWithCode.startsWith('91') ? fromWithCode.substring(2) : fromWithCode;
            const usersRef = firestore.collection('users');
            const userQuery = await usersRef.where('phone', '==', customerPhone).limit(1).get();
            
            let welcomeMessage = `Welcome to ${restaurantName}! 😃`;
            if (!userQuery.empty) {
                const user = userQuery.docs[0].data();
                if(user.name) {
                    welcomeMessage = `Welcome back to ${restaurantName}, ${user.name}! 🥳`;
                }
            }

            const menuUrl = `https://servizephyr.com/order/${restaurantId}?phone=${customerPhone}`;
            const reply_body = `${welcomeMessage}\n\nWhat would you like to order today? You can view our full menu and place your order by clicking the link below:\n\n${menuUrl}`;
            
            const customerPhoneForApi = '91' + customerPhone;
            await sendWhatsAppMessage(customerPhoneForApi, reply_body, botPhoneNumberId);
        }
        
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook] Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
