

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
// **THE FIX**: Removed unused import of sendOrderConfirmationToCustomer
import { sendOrderStatusUpdateToCustomer } from '@/lib/notifications';


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

async function getBusiness(firestore, botPhoneNumberId) {
    const restaurantsQuery = await firestore.collection('restaurants').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        return { id: doc.id, data: doc.data(), collectionName: 'restaurants' };
    }
    
    const shopsQuery = await firestore.collection('shops').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        return { id: doc.id, data: doc.data(), collectionName: 'shops' };
    }
    
    return null;
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
        
        // --- Handler for Button Clicks ---
        if (change?.value?.messages?.[0]?.interactive?.button_reply) {
            const message = change.value.messages[0];
            const buttonReply = message.interactive.button_reply;
            const buttonId = buttonReply.id;
            const fromNumber = message.from; 
            const businessPhoneNumberId = change.value.metadata.phone_number_id;
            
            const [action, ...payloadParts] = buttonId.split('_');

            // --- Handler for Order Accept/Reject ---
            if (action === 'accept' || action === 'reject') {
                const orderId = payloadParts.join('_').replace('order_', '');
                if (!orderId) {
                    console.warn(`[Webhook] Invalid order button ID format: ${buttonId}`);
                    return NextResponse.json({ message: 'Invalid button ID' }, { status: 200 });
                }

                const orderRef = firestore.collection('orders').doc(orderId);
                const orderDoc = await orderRef.get();

                if (!orderDoc.exists) {
                     await sendWhatsAppMessage(fromNumber, `⚠️ Action failed: Order with ID ${orderId} was not found.`, businessPhoneNumberId);
                     return NextResponse.json({ message: 'Order not found' }, { status: 200 });
                }
                
                const orderData = orderDoc.data();
                const business = await getBusiness(firestore, businessPhoneNumberId);
                
                if (!business) {
                     console.error(`[Webhook] No business found for Bot Phone Number ID: ${businessPhoneNumberId}`);
                     await sendWhatsAppMessage(fromNumber, `⚠️ Action failed: Could not identify the business associated with this bot.`, businessPhoneNumberId);
                     return NextResponse.json({ message: 'Business not found' }, { status: 404 });
                }

                if (action === 'accept') {
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
                    
                    await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been confirmed. You can now start preparing it.`, businessPhoneNumberId);

                } else if (action === 'reject') {
                    await orderRef.update({ status: 'rejected' });
                    await sendWhatsAppMessage(fromNumber, `✅ Action complete: Order ${orderId} has been rejected. The customer will be notified.`, businessPhoneNumberId);
                }
            } 
            // --- Handler for Restaurant Status Change ---
            else if (action === 'retain' || action === 'revert') {
                const [_, __, businessId, status] = payloadParts;
                
                if(!businessId || !status) {
                    console.warn(`[Webhook] Invalid status button ID format: ${buttonId}`);
                    return NextResponse.json({ message: 'Invalid button ID' }, { status: 200 });
                }

                const business = await getBusiness(firestore, businessPhoneNumberId);
                if (!business) return NextResponse.json({ message: 'Business not found' }, { status: 404 });
                const collectionName = business.data.businessType === 'shop' ? 'shops' : 'restaurants';

                if (action === 'revert') {
                    const revertToOpen = status === 'open';
                    await firestore.collection(collectionName).doc(businessId).update({ isOpen: revertToOpen });
                    await sendWhatsAppMessage(fromNumber, `✅ Action reverted. Your business has been set to **${revertToOpen ? 'OPEN' : 'CLOSED'}**.`, businessPhoneNumberId);
                } else { // retain
                    await sendWhatsAppMessage(fromNumber, `✅ Understood. Your business status will remain **${status.toUpperCase()}**.`, businessPhoneNumberId);
                }
            }
        } 
        // --- Handler for Customer's Text Messages ---
        else if (change?.value?.messages?.[0]?.text) {
            const message = change.value.messages[0];
            const fromWithCode = message.from; 
            const customerName = change.value?.contacts?.[0]?.profile?.name || 'Customer';
            const botPhoneNumberId = change.value.metadata.phone_number_id;

            const business = await getBusiness(firestore, botPhoneNumberId);
            
            if (!business) {
                console.error(`[Webhook] No business found for Bot Phone Number ID: ${botPhoneNumberId}`);
                await sendWhatsAppMessage(fromWithCode, "We're sorry, we couldn't identify the business you're trying to reach.", botPhoneNumberId);
                return NextResponse.json({ message: 'Business not found' }, { status: 404 });
            }
            
            const businessId = business.id;
            const businessCollection = business.collectionName;

            const customerPhone = fromWithCode.startsWith('91') ? fromWithCode.substring(2) : fromWithCode;

            const conversationRef = firestore.collection(businessCollection).doc(businessId).collection('conversations').doc(customerPhone);
            const messageRef = conversationRef.collection('messages').doc();

            const batch = firestore.batch();
            
            // Save the incoming message
            batch.set(messageRef, {
                id: messageRef.id,
                text: message.text.body,
                sender: 'customer',
                timestamp: FieldValue.serverTimestamp(),
                status: 'unread'
            });

            // Update the conversation summary
            batch.set(conversationRef, {
                id: customerPhone,
                customerName: customerName,
                customerPhone: customerPhone,
                lastMessage: message.text.body,
                lastMessageTimestamp: FieldValue.serverTimestamp(),
                unreadCount: FieldValue.increment(1),
            }, { merge: true });

            await batch.commit();

            // Check if it's the first message or if the business is open, then reply.
            // For now, we will stop auto-replying to allow owners to chat manually.
            // In a future version, this could be a setting.
        }
        
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook] Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
