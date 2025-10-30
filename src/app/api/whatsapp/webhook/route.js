

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

const handleImageMessage = async (firestore, business, message) => {
    const fromWithCode = message.from;
    const customerName = business.data?.contacts?.[0]?.profile?.name || 'Customer'; // Safely access nested property
    const mediaId = message.image.id;
    const whatsAppToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!whatsAppToken) {
        console.error("[Webhook][handleImageMessage] CRITICAL: WHATSAPP_ACCESS_TOKEN is not set.");
        return;
    }

    // 1. Get media URL from Meta
    const mediaUrlRes = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${whatsAppToken}` }
    });
    const mediaUrl = mediaUrlRes.data.url;

    // 2. Download the image
    const imageRes = await axios.get(mediaUrl, {
        headers: { 'Authorization': `Bearer ${whatsAppToken}` },
        responseType: 'arraybuffer'
    });
    const imageBuffer = Buffer.from(imageRes.data, 'binary');
    const mimeType = message.image.mime_type;
    const fileExtension = mimeType.split('/')[1] || 'jpg';
    
    // 3. Upload to Firebase Storage
    const bucket = getStorage().bucket(`gs://${process.env.FIREBASE_PROJECT_ID}.appspot.com`);
    const fileName = `whatsapp_media/${business.id}/${fromWithCode}_${Date.now()}.${fileExtension}`;
    const file = bucket.file(fileName);
    await file.save(imageBuffer, {
        metadata: { contentType: mimeType }
    });
    
    // 4. Get public URL (set to be publicly readable)
    await file.makePublic();
    const publicUrl = file.publicUrl();

    // 5. Save message to Firestore
    const customerPhone = fromWithCode.startsWith('91') ? fromWithCode.substring(2) : fromWithCode;
    const conversationRef = business.ref.collection('conversations').doc(customerPhone);
    const messageRef = conversationRef.collection('messages').doc();

    const batch = firestore.batch();
    
    batch.set(messageRef, {
        id: messageRef.id,
        type: 'image',
        mediaUrl: publicUrl,
        sender: 'customer',
        timestamp: FieldValue.serverTimestamp(),
        status: 'unread'
    });

    batch.set(conversationRef, {
        id: customerPhone,
        customerName: customerName,
        customerPhone: customerPhone,
        lastMessage: '📷 Image',
        lastMessageType: 'image',
        lastMessageTimestamp: FieldValue.serverTimestamp(),
        unreadCount: FieldValue.increment(1),
    }, { merge: true });

    await batch.commit();
}

const generateAndSendAuthLink = async (firestore, customerPhoneWithCode, business, botPhoneNumberId) => {
    const customerPhone = customerPhoneWithCode.startsWith('91') ? customerPhoneWithCode.substring(2) : customerPhoneWithCode;
    const customerName = business.data?.contacts?.[0]?.profile?.name || 'Customer';

    // 1. Generate a secure, unique token
    const token = nanoid(24);

    // 2. Set an expiry time (e.g., 20 minutes from now)
    const expiry = new Date(Date.now() + 20 * 60 * 1000);

    // 3. Save the token, phone number, and expiry to Firestore
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        phone: customerPhone,
        expiresAt: FieldValue.serverTimestamp(expiry)
    });

    // 4. Construct the URL with the token
    const menuLink = `https://servizephyr.com/order/${business.id}?phone=${customerPhone}&token=${token}`;
    const replyText = `Thanks for contacting *${business.data.name}*. We have received your message and will get back to you shortly.\n\nYou can also view our menu and place an order directly here:\n${menuLink}`;

    // 5. Send the message
    await sendWhatsAppMessage(customerPhoneWithCode, replyText, botPhoneNumberId);
    console.log(`[Webhook] Auth link sent to ${customerPhone}.`);
    
    // 6. Save messages to Firestore conversation
    const conversationRef = business.ref.collection('conversations').doc(customerPhone);
    const messagesCollectionRef = conversationRef.collection('messages');
    const batch = firestore.batch();

    // Save bot's reply
    const botMessageRef = messagesCollectionRef.doc();
    batch.set(botMessageRef, {
        id: botMessageRef.id,
        text: replyText,
        sender: 'owner', // Representing the bot as the owner
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent' 
    });
    
    // Update conversation metadata
    batch.set(conversationRef, {
        id: customerPhone,
        customerName: customerName,
        customerPhone: customerPhone,
        lastMessage: replyText,
        lastMessageType: 'text',
        lastMessageTimestamp: FieldValue.serverTimestamp(),
    }, { merge: true });

    await batch.commit();
    console.log(`[Webhook] Saved bot's automatic reply to Firestore for ${customerPhone}.`);
};


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
        
        const message = change.value.messages?.[0];
        if (!message) {
            console.log("[Webhook] No message object found. Skipping.");
            return NextResponse.json({ message: 'Not a message event' }, { status: 200 });
        }

        const businessPhoneNumberId = change.value.metadata.phone_number_id;
        const business = await getBusiness(firestore, businessPhoneNumberId);
        if (!business) {
             console.error(`[Webhook] No business found for Bot Phone Number ID: ${businessPhoneNumberId}`);
             return NextResponse.json({ message: 'Business not found' }, { status: 404 });
        }

        if (message.type === 'image') {
            await handleImageMessage(firestore, business, message);
        }
        else if (message.interactive?.button_reply) {
            const buttonReply = message.interactive.button_reply;
            const buttonId = buttonReply.id;
            const fromNumber = message.from; 
            
            console.log(`[Webhook] Button click detected. Button ID: "${buttonId}", From: ${fromNumber}, Bot ID: ${businessPhoneNumberId}`);
            
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
                     await sendWhatsAppMessage(fromNumber, `⚠️ Action failed: Order with ID ${orderId} was not found.`, businessPhoneNumberId);
                     return NextResponse.json({ message: 'Order not found' }, { status: 200 });
                }
                
                const orderData = orderDoc.data();
                
                if (action === 'accept') {
                    console.log(`[Webhook] Accepting order ${orderId}. Updating status to 'confirmed'.`);
                    await orderRef.update({ status: 'confirmed' });
                    
                    await sendOrderStatusUpdateToCustomer({
                        customerPhone: orderData.customerPhone,
                        botPhoneNumberId: businessPhoneNumberId,
                        customerName: orderData.customerName,
                        orderId: orderId,
                        restaurantName: business.data.name,
                        status: 'confirmed',
                        businessType: business.data.businessType || 'restaurant',
                    });
                    
                    console.log(`[Webhook] Sending confirmation back to owner at ${fromNumber}.`);
                    await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been confirmed. You can now start preparing it.`, businessPhoneNumberId);

                } else if (action === 'reject') {
                    console.log(`[Webhook] Rejecting order ${orderId}. Updating status to 'rejected'.`);
                    await orderRef.update({ status: 'rejected' });
                    await sendOrderStatusUpdateToCustomer({
                        customerPhone: orderData.customerPhone,
                        botPhoneNumberId: businessPhoneNumberId,
                        customerName: orderData.customerName,
                        orderId: orderId,
                        restaurantName: business.data.name,
                        status: 'rejected',
                         businessType: business.data.businessType || 'restaurant',
                    });
                    console.log(`[Webhook] Sending rejection confirmation back to owner at ${fromNumber}.`);
                    await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been rejected. The customer will be notified.`, businessPhoneNumberId);
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
                    await sendWhatsAppMessage(fromNumber, `✅ Action reverted. Your business has been set to **${revertToOpen ? 'OPEN' : 'CLOSED'}**.`, businessPhoneNumberId);
                } else { // retain
                    console.log(`[Webhook] Retaining status for ${businessId}. No change.`);
                    await sendWhatsAppMessage(fromNumber, `✅ Understood. Your business status will remain **${status.toUpperCase()}**.`, businessPhoneNumberId);
                }
            }
        } 
        else if (message.text) {
            const fromWithCode = message.from;
            const messageBody = message.text.body;

            const customerName = change.value?.contacts?.[0]?.profile?.name || 'Customer';
            const customerPhone = fromWithCode.startsWith('91') ? fromWithCode.substring(2) : fromWithCode;
            
            console.log(`[Webhook] Text message received. From: ${fromWithCode}, Name: ${customerName}, Message: "${messageBody}"`);
            
            const conversationRef = business.ref.collection('conversations').doc(customerPhone);
            const messagesCollectionRef = conversationRef.collection('messages');
            
            const messagesSnap = await messagesCollectionRef.limit(1).get();
            const isNewConversation = messagesSnap.empty;

            const messageRef = messagesCollectionRef.doc();
            console.log(`[Webhook] Saving message to Firestore for customer ${customerPhone} at path: ${messageRef.path}`);
            
            // Save the customer's message first
            await messageRef.set({
                id: messageRef.id,
                text: messageBody,
                sender: 'customer',
                timestamp: FieldValue.serverTimestamp(),
                status: 'unread'
            });
            
            // Then, if it's a new conversation, generate and send the auth link
            if (isNewConversation) {
                console.log(`[Webhook] First message from ${customerPhone}. Sending automatic reply with auth link.`);
                await generateAndSendAuthLink(firestore, fromWithCode, business, businessPhoneNumberId);
            } else {
                 // For existing conversations, just update the last message info
                 await conversationRef.set({
                    lastMessage: messageBody,
                    lastMessageType: 'text',
                    lastMessageTimestamp: FieldValue.serverTimestamp(),
                    unreadCount: FieldValue.increment(1),
                 }, { merge: true });
                 console.log(`[Webhook] Existing conversation with ${customerPhone}. Updated last message.`);
            }

        } else {
            console.log("[Webhook] Received a non-text, non-button, non-image event. Skipping.");
        }
        
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
