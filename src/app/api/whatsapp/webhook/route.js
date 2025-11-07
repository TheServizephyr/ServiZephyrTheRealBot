

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendOrderStatusUpdateToCustomer, sendNewOrderToOwner } from '@/lib/notifications';
import axios from 'axios';
import { nanoid } from 'nanoid';


const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

export async function GET(request) {
  console.log("[Webhook] Received GET request for verification.");
  try {
    const { searchParams } = new URL(request.url);
    
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    console.log(`[Webhook] Mode: ${mode}, Token: ${token ? 'Present' : 'Missing'}, Challenge: ${challenge ? 'Present' : 'Missing'}`);

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log("[Webhook] Verification SUCCESS. Responding with challenge.");
      return new NextResponse(challenge, { status: 200 });
    } else {
      console.error("[Webhook] Verification FAILED. Tokens do not match or mode is not 'subscribe'.");
      return new NextResponse('Verification Failed', { status: 403 });
    }
  } catch (error) {
    console.error('[Webhook] CRITICAL ERROR in GET handler:', error);
    return new NextResponse('Server Error', { status: 500 });
  }
}

async function getBusiness(firestore, botPhoneNumberId) {
    console.log(`[Webhook] getBusiness: Searching for business with botPhoneNumberId: ${botPhoneNumberId}`);
    const restaurantsQuery = await firestore.collection('restaurants').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        console.log(`[Webhook] getBusiness: Found business in 'restaurants' collection with ID: ${doc.id}`);
        return { id: doc.id, ref: doc.ref, data: doc.data(), collectionName: 'restaurants' };
    }
    
    const shopsQuery = await firestore.collection('shops').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        console.log(`[Webhook] getBusiness: Found business in 'shops' collection with ID: ${doc.id}`);
        return { id: doc.id, ref: doc.ref, data: doc.data(), collectionName: 'shops' };
    }
    
    console.warn(`[Webhook] getBusiness: No business found for botPhoneNumberId: ${botPhoneNumberId}`);
    return null;
}

const generateSecureToken = async (firestore, customerPhone) => {
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2-hour validity
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: expiry
    });
    return token;
};


const sendWelcomeMessageWithOptions = async (customerPhoneWithCode, business, botPhoneNumberId) => {
    console.log(`[Webhook] Sending interactive welcome message to ${customerPhoneWithCode}`);
    
    const payload = {
        type: "interactive",
        interactive: {
            type: "button",
            body: {
                text: `Welcome to ${business.data.name}!\n\nWhat would you like to do today?`
            },
            action: {
                buttons: [
                    {
                        type: "reply",
                        reply: {
                            id: `action_order_${business.id}`,
                            title: "Order Food"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: `action_track_${business.id}`,
                            title: "Track Last Order"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: `action_help`,
                            title: "Need Help?"
                        }
                    }
                ]
            }
        }
    };
    
    await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);
}

// --- START: Dine-in Post-Paid Confirmation Logic ---
const handleDineInConfirmation = async (firestore, text, fromNumber, business, botPhoneNumberId) => {
    const orderIdMatch = text.match(/\(order_([a-zA-Z0-9]+)\)/);
    if (!orderIdMatch || !orderIdMatch[1]) {
        console.log(`[Webhook DineIn] No orderId found in message: "${text}"`);
        return false; // Not a confirmation message
    }
    const orderId = orderIdMatch[1];
    console.log(`[Webhook DineIn] Found confirmation request for orderId: ${orderId}`);

    const orderRef = firestore.collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists || orderSnap.data().status !== 'pending_confirmation') {
        await sendWhatsAppMessage(fromNumber, "Sorry, this order is invalid or has already been confirmed.", botPhoneNumberId);
        return true;
    }
    
    const orderData = orderSnap.data();
    const customerPhone = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;

    // The "Checkmate" logic
    const activeSessionQuery = firestore.collection('restaurants').doc(orderData.restaurantId)
                                     .collection('tables').doc(orderData.tableId)
                                     .collection('activeSessions')
                                     .where('customerPhone', '==', customerPhone)
                                     .where('status', '==', 'unpaid');
    
    const activeSessionSnap = await activeSessionQuery.get();
    if (!activeSessionSnap.empty) {
        await orderRef.delete(); // Delete the pending order
        await sendWhatsAppMessage(fromNumber, "Sorry, you already have an unpaid bill at this table. Please clear the existing bill before starting a new order.", botPhoneNumberId);
        return true;
    }
    
    // If all good, confirm the order
    const sessionRef = firestore.collection('restaurants').doc(orderData.restaurantId)
                               .collection('tables').doc(orderData.tableId)
                               .collection('activeSessions').doc(customerPhone);
    
    const batch = firestore.batch();
    batch.update(orderRef, { status: 'confirmed', customerId: customerPhone });
    batch.set(sessionRef, {
        customerPhone: customerPhone,
        customerName: orderData.customerName,
        orderId: orderId,
        status: 'unpaid',
        createdAt: FieldValue.serverTimestamp()
    });

    await batch.commit();

    await sendWhatsAppMessage(fromNumber, `Thanks, ${orderData.customerName}! Your order #${orderId.substring(0, 6)} is confirmed and has been sent to the kitchen.`, botPhoneNumberId);
    
    // Notify owner
    if (business.data.ownerPhone && business.data.botPhoneNumberId) {
        await sendNewOrderToOwner({
            ownerPhone: business.data.ownerPhone,
            botPhoneNumberId: business.data.botPhoneNumberId,
            customerName: orderData.customerName,
            totalAmount: orderData.grandTotal,
            orderId: orderId,
            restaurantName: business.data.name
        });
    }
    
    return true; // Indicates the message was handled
};
// --- END: Dine-in Post-Paid Confirmation Logic ---


const handleButtonActions = async (firestore, buttonId, fromNumber, business, botPhoneNumberId) => {
    const [action, type, ...payloadParts] = buttonId.split('_');

    if (action !== 'action') return;
    
    const customerPhone = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;
    const conversationRef = business.ref.collection('conversations').doc(customerPhone);
    
    console.log(`[Webhook] Handling action: '${type}' for customer ${customerPhone}`);

    try {
        switch(type) {
            case 'order': {
                const businessId = payloadParts.join('_');
                const token = await generateSecureToken(firestore, customerPhone);
                const link = `https://servizephyr.com/order/${businessId}?phone=${customerPhone}&token=${token}`;
                await sendWhatsAppMessage(fromNumber, `Here is your personal link to place an order:\n\n${link}\n\nThis link is valid for 2 hours.`, botPhoneNumberId);
                break;
            }
            case 'dashboard': {
                const link = `https://servizephyr.com/`;
                await sendWhatsAppMessage(fromNumber, `To view your dashboard, please visit our website and log in with your Google account:\n\n${link}`, botPhoneNumberId);
                break;
            }
            case 'track': {
                const ordersRef = firestore.collection('orders');
                const q = ordersRef.where('customerPhone', '==', customerPhone);
                const querySnapshot = await q.get();

                if (querySnapshot.empty) {
                    await sendWhatsAppMessage(fromNumber, `You don't have any recent orders to track.`, botPhoneNumberId);
                } else {
                    const allOrders = querySnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));

                    allOrders.sort((a,b) => {
                        const dateA = a.orderDate?.toDate ? a.orderDate.toDate() : new Date(a.orderDate);
                        const dateB = b.orderDate?.toDate ? b.orderDate.toDate() : new Date(b.orderDate);
                        return dateB - dateA;
                    });
                    
                    const latestOrder = allOrders[0];
                    if (!latestOrder || !latestOrder.id) {
                         await sendWhatsAppMessage(fromNumber, `We couldn't find the ID for your last order. Please contact support.`, botPhoneNumberId);
                         return;
                    }
                    const orderId = latestOrder.id;

                    const token = await generateSecureToken(firestore, customerPhone);
                    const link = `https://servizephyr.com/track/${orderId}?phone=${customerPhone}&token=${token}`;
                    await sendWhatsAppMessage(fromNumber, `Here is the tracking link for your latest order (#${orderId.substring(0, 6)}):\n\n${link}`, botPhoneNumberId);
                }
                break;
            }
            case 'help': {
                await conversationRef.set({ state: 'direct_chat' }, { merge: true });
                await sendWhatsAppMessage(fromNumber, `You are now connected directly with a representative from ${business.data.name}. You can ask your questions here.\n\nWhen your query is resolved, the restaurant will end the chat.`, botPhoneNumberId);
                break;
            }
            // --- START FIX: Handle new buttons ---
            case 'end': { // Corresponds to 'action_end_chat'
                if (payloadParts[0] === 'chat') {
                    await conversationRef.set({ state: 'menu' }, { merge: true });
                    await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
                }
                break;
            }
            case 'report': { // Corresponds to 'action_report_admin'
                if (payloadParts[0] === 'admin') {
                    // In a real app, you'd collect more info or forward the chat.
                    // For now, just acknowledge.
                    console.log(`[Webhook] Admin Report triggered by ${customerPhone} for business ${business.id}`);
                    await sendWhatsAppMessage(fromNumber, `Thank you. Your request to speak with an admin has been noted. We will review the conversation and get back to you shortly.`, botPhoneNumberId);
                }
                break;
            }
            // --- END FIX ---
            default:
                 console.warn(`[Webhook] Unhandled action type: ${type}`);
        }
    } catch (e) {
        console.error(`[Webhook] Error handling button action '${type}':`, e);
        await sendWhatsAppMessage(fromNumber, `Sorry, we couldn't process your request right now. Please try again.`, botPhoneNumberId);
    }
}


export async function POST(request) {
    console.log("[Webhook] Received POST request.");
    try {
        const body = await request.json();
        
        console.log("[Webhook] Request Body Received:", JSON.stringify(body, null, 2));

        if (body.object !== 'whatsapp_business_account') {
            console.log("[Webhook] Event is not from a WhatsApp Business Account. Skipping.");
            return NextResponse.json({ message: 'Not a WhatsApp event' }, { status: 200 });
        }

        const firestore = await getFirestore();
        const change = body.entry?.[0]?.changes?.[0];
        
        if (!change || !change.value) {
            console.log("[Webhook] No 'change' or 'value' object found in payload. Skipping.");
            return NextResponse.json({ message: 'No change data' }, { status: 200 });
        }
        
        const botPhoneNumberId = change.value.metadata.phone_number_id;
        const business = await getBusiness(firestore, botPhoneNumberId);
        if (!business) {
             console.error(`[Webhook] No business found for Bot Phone Number ID: ${botPhoneNumberId}`);
             return NextResponse.json({ message: 'Business not found' }, { status: 404 });
        }

        if (change.value.messages && change.value.messages.length > 0) {
            const message = change.value.messages[0];
            const fromNumber = message.from;
            const fromPhoneNumber = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;

            // --- START: Dine-in Check ---
            if (message.type === 'text') {
                const handled = await handleDineInConfirmation(firestore, message.text.body, fromNumber, business, botPhoneNumberId);
                if (handled) {
                    console.log(`[Webhook] Message handled by Dine-in flow. Skipping further processing.`);
                    return NextResponse.json({ message: 'Dine-in confirmation processed.' }, { status: 200 });
                }
            }
            // --- END: Dine-in Check ---

            const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);
            const conversationSnap = await conversationRef.get();
            const conversationData = conversationSnap.exists ? conversationSnap.data() : { state: 'menu' };
            
            // If in direct chat mode, forward message to owner
            if (conversationData.state === 'direct_chat' && message.type === 'text') {
                const messageRef = conversationRef.collection('messages').doc(message.id);
                
                await messageRef.set({
                    id: message.id,
                    sender: 'customer',
                    timestamp: FieldValue.serverTimestamp(),
                    status: 'received',
                    type: 'text',
                    text: message.text.body
                });
                
                await conversationRef.set({
                    customerName: change.value.contacts[0].profile.name,
                    customerPhone: fromPhoneNumber,
                    lastMessage: message.text.body,
                    lastMessageType: 'text',
                    lastMessageTimestamp: FieldValue.serverTimestamp(),
                    unreadCount: FieldValue.increment(1)
                }, { merge: true });
                
                console.log(`[Webhook] Message from ${fromPhoneNumber} forwarded to owner.`);
                return NextResponse.json({ message: 'Forwarded to owner' }, { status: 200 });
            }

            // Handle button clicks
            if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
                const buttonReply = message.interactive.button_reply;
                const buttonId = buttonReply.id;
                
                console.log(`[Webhook] Button click detected. Button ID: "${buttonId}", From: ${fromNumber}`);
                
                await handleButtonActions(firestore, buttonId, fromNumber, business, botPhoneNumberId);
            } 
            // Handle initial text messages when not in direct chat
            else if (message.type === 'text' && conversationData.state !== 'direct_chat') {
                await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
            }
        }
        
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
    
