
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendOrderStatusUpdateToCustomer } from '@/lib/notifications';
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


const handleButtonActions = async (firestore, buttonId, fromNumber, business, botPhoneNumberId) => {
    const [action, type, ...payloadParts] = buttonId.split('_');

    if (action !== 'action') return;
    
    const customerPhone = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;
    
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
                    const orderId = latestOrder.id;

                    const token = await generateSecureToken(firestore, customerPhone);
                    const link = `https://servizephyr.com/track/${orderId}?phone=${customerPhone}&token=${token}`;
                    await sendWhatsAppMessage(fromNumber, `Here is the tracking link for your latest order (#${orderId.substring(0, 6)}):\n\n${link}`, botPhoneNumberId);
                }
                break;
            }
            case 'help': {
                const conversationRef = business.ref.collection('conversations').doc(customerPhone);
                await conversationRef.set({ state: 'direct_chat' }, { merge: true });
                await sendWhatsAppMessage(fromNumber, `You are now connected directly with a representative from ${business.data.name}. You can ask your questions here.\n\nWhen your query is resolved, the restaurant will end the chat.`, botPhoneNumberId);
                break;
            }
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

        const firestore = getFirestore();
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

            const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);
            const conversationSnap = await conversationRef.get();
            const conversationData = conversationSnap.exists ? conversationSnap.data() : { state: 'menu' };
            
            if (conversationData.state === 'direct_chat') {
                const messageRef = conversationRef.collection('messages').doc(message.id);
                let messageContent = { type: message.type, text: message.type === 'text' ? message.text.body : `Unsupported type: ${message.type}` };
                
                await messageRef.set({
                    id: message.id,
                    sender: 'customer',
                    timestamp: FieldValue.serverTimestamp(),
                    status: 'received',
                    ...messageContent
                });
                
                await conversationRef.set({
                    customerName: change.value.contacts[0].profile.name,
                    customerPhone: fromPhoneNumber,
                    lastMessage: messageContent.text,
                    lastMessageType: messageContent.type,
                    lastMessageTimestamp: FieldValue.serverTimestamp(),
                    unreadCount: FieldValue.increment(1)
                }, { merge: true });
                
                console.log(`[Webhook] Message from ${fromPhoneNumber} forwarded to owner.`);
                return NextResponse.json({ message: 'Forwarded to owner' }, { status: 200 });
            }

            if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
                const buttonReply = message.interactive.button_reply;
                const buttonId = buttonReply.id;
                
                console.log(`[Webhook] Button click detected. Button ID: "${buttonId}", From: ${fromNumber}`);
                
                if (buttonId.startsWith('action_')) {
                    await handleButtonActions(firestore, buttonId, fromNumber, business, botPhoneNumberId);
                } else {
                     const [action, ...payloadParts] = buttonId.split('_');

                     if (action === 'accept' || action === 'reject') {
                        const orderId = payloadParts.join('_').replace('order_', '');
                        console.log(`[Webhook] Order action detected. Action: ${action}, Order ID: ${orderId}`);
                        
                        if (!orderId) {
                            console.warn(`[Webhook] Invalid order button ID format: ${buttonId}`);
                            return NextResponse.json({ message: 'Invalid button ID' }, { status: 200 });
                        }

                        const orderRef = firestore.collection('orders').doc(orderId);
                        const orderDoc = await orderRef.get();

                        if (!orderDoc.exists) {
                            console.error(`[Webhook] Action failed: Order with ID ${orderId} was not found.`);
                            await sendWhatsAppMessage(fromNumber, `⚠️ Action failed: Order with ID ${orderId} was not found.`, botPhoneNumberId);
                            return NextResponse.json({ message: 'Order not found' }, { status: 200 });
                        }
                        
                        const orderData = orderDoc.data();
                        
                        if (action === 'accept') {
                            console.log(`[Webhook] Accepting order ${orderId}. Updating status to 'confirmed'.`);
                            await orderRef.update({ status: 'confirmed' });
                            
                            await sendOrderStatusUpdateToCustomer({
                                customerPhone: orderData.customerPhone,
                                botPhoneNumberId: botPhoneNumberId,
                                customerName: orderData.customerName,
                                orderId: orderId,
                                restaurantName: business.data.name,
                                status: 'confirmed',
                                businessType: business.data.businessType || 'restaurant',
                            });
                            
                            console.log(`[Webhook] Sending confirmation back to owner at ${fromNumber}.`);
                            await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been confirmed. You can now start preparing it.`, botPhoneNumberId);

                        } else if (action === 'reject') {
                            console.log(`[Webhook] Rejecting order ${orderId}. Updating status to 'rejected'.`);
                            await orderRef.update({ status: 'rejected' });
                            await sendOrderStatusUpdateToCustomer({
                                customerPhone: orderData.customerPhone,
                                botPhoneNumberId: botPhoneNumberId,
                                customerName: orderData.customerName,
                                orderId: orderId,
                                restaurantName: business.data.name,
                                status: 'rejected',
                                businessType: business.data.businessType || 'restaurant',
                            });
                            console.log(`[Webhook] Sending rejection confirmation back to owner at ${fromNumber}.`);
                            await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been rejected. The customer will be notified.`, botPhoneNumberId);
                        }
                    } 
                    else if (action === 'retain' || action === 'revert') {
                        const [_, __, businessId, status] = payloadParts;
                        console.log(`[Webhook] Restaurant status action detected. Action: ${action}, Business ID: ${businessId}, Status: ${status}`);

                        if(!businessId || !status) {
                            console.warn(`[Webhook] Invalid status button ID format: ${buttonId}`);
                            return NextResponse.json({ message: 'Invalid button ID' }, { status: 200 });
                        }

                        const collectionName = business.data.businessType === 'shop' ? 'shops' : 'restaurants';

                        if (action === 'revert') {
                            const revertToOpen = status === 'open';
                            console.log(`[Webhook] Reverting status for ${businessId}. Setting isOpen to: ${revertToOpen}`);
                            await firestore.collection(collectionName).doc(businessId).update({ isOpen: revertToOpen });
                            await sendWhatsAppMessage(fromNumber, `✅ Action reverted. Your business has been set to **${revertToOpen ? 'OPEN' : 'CLOSED'}**.`, botPhoneNumberId);
                        } else { // retain
                            console.log(`[Webhook] Retaining status for ${businessId}. No change.`);
                            await sendWhatsAppMessage(fromNumber, `✅ Understood. Your business status will remain **${status.toUpperCase()}**.`, botPhoneNumberId);
                        }
                    }
                }
            } else if (message.type === 'text') {
                await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
            }
        }
        
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
    

    








