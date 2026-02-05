
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { sendWhatsAppMessage, downloadWhatsAppMedia } from '@/lib/whatsapp';
import { sendOrderStatusUpdateToCustomer, sendNewOrderToOwner } from '@/lib/notifications';
import axios from 'axios';
import { nanoid } from 'nanoid';
import { getOrCreateGuestProfile, obfuscateGuestId } from '@/lib/guest-utils';


const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

export async function GET(request) {
    console.log("[Webhook WA] GET request received for verification.");
    try {
        const { searchParams } = new URL(request.url);

        const mode = searchParams.get('hub.mode');
        const token = searchParams.get('hub.verify_token');
        const challenge = searchParams.get('hub.challenge');

        console.log(`[Webhook WA] Mode: ${mode}, Token: ${token ? 'Present' : 'Missing'}, Challenge: ${challenge ? 'Present' : 'Missing'}`);

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log("[Webhook WA] Verification SUCCESS. Responding with challenge.");
            return new NextResponse(challenge, { status: 200 });
        } else {
            console.error("[Webhook WA] Verification FAILED. Tokens do not match or mode is not 'subscribe'.");
            return new NextResponse('Verification Failed', { status: 403 });
        }
    } catch (error) {
        console.error('[Webhook WA] CRITICAL ERROR in GET handler:', error);
        return new NextResponse('Server Error', { status: 500 });
    }
}

async function getBusiness(firestore, botPhoneNumberId) {
    console.log(`[Webhook WA] getBusiness: Searching for business with botPhoneNumberId: ${botPhoneNumberId}`);
    const restaurantsQuery = await firestore.collection('restaurants').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        console.log(`[Webhook WA] getBusiness: Found business in 'restaurants' collection with ID: ${doc.id}`);
        return { id: doc.id, ref: doc.ref, data: doc.data(), collectionName: 'restaurants' };
    }

    const shopsQuery = await firestore.collection('shops').where('botPhoneNumberId', '==', botPhoneNumberId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        console.log(`[Webhook WA] getBusiness: Found business in 'shops' collection with ID: ${doc.id}`);
        return { id: doc.id, ref: doc.ref, data: doc.data(), collectionName: 'shops' };
    }

    console.warn(`[Webhook WA] getBusiness: No business found for botPhoneNumberId: ${botPhoneNumberId}`);
    return null;
}

const generateSecureToken = async (firestore, guestId) => {
    console.log(`[Webhook WA] generateSecureToken: Generating for guestId: ${guestId}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        guestId: guestId, // Store Guest ID instead of Phone
        expiresAt: expiry,
        type: 'tracking'
    });
    console.log("[Webhook WA] generateSecureToken: Token generated linked to Guest ID.");
    return token;
};


const sendWelcomeMessageWithOptions = async (customerPhoneWithCode, business, botPhoneNumberId) => {
    console.log(`[Webhook WA] Sending interactive welcome message to ${customerPhoneWithCode}`);

    const payload = {
        type: "interactive",
        interactive: {
            type: "button",
            body: {
                text: `Welcome to ${business.data.name}!\n\nWhat would you like to do today?`
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: `action_order_${business.id}`, title: "Order Food" } },
                    { type: "reply", reply: { id: `action_track_${business.id}`, title: "Track Last Order" } },
                    { type: "reply", reply: { id: `action_help`, title: "Need Help?" } }
                ]
            }
        }
    };

    await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);
}


const handleDineInConfirmation = async (firestore, text, fromNumber, business, botPhoneNumberId) => {
    const orderIdMatch = text.match(/order ID: ([a-zA-Z0-9]+)/i);
    if (!orderIdMatch || !orderIdMatch[1]) {
        return false; // Not a dine-in confirmation message
    }

    const orderId = orderIdMatch[1];
    console.log(`[Webhook WA DineIn] Found confirmation request for orderId: ${orderId}`);

    const orderRef = firestore.collection('orders').doc(orderId);
    const businessRef = business.ref;
    let dineInToken;
    let trackingTokenForLink;

    try {
        await firestore.runTransaction(async (transaction) => {
            console.log(`[Webhook WA DineIn] Starting transaction for order ${orderId}`);
            const businessDoc = await transaction.get(businessRef);
            if (!businessDoc.exists) throw new Error("Business document not found.");

            const orderDoc = await transaction.get(orderRef);
            if (!orderDoc.exists) throw new Error("Order document not found.");

            const orderData = orderDoc.data();
            const businessData = businessDoc.data();

            if (orderData.dineInToken && orderData.trackingToken) {
                dineInToken = orderData.dineInToken;
                trackingTokenForLink = orderData.trackingToken;
                console.log(`[Webhook WA DineIn] Token already exists for order ${orderId}. Re-sending.`);
                return;
            }

            const lastToken = businessData.lastDineInToken || 0;
            const newTokenNumber = lastToken + 1;
            const randomChar = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            dineInToken = `#${String(newTokenNumber).padStart(2, '0')}-${randomChar}`;

            const customerPhone = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;
            trackingTokenForLink = orderData.trackingToken;

            transaction.update(businessRef, { lastDineInToken: newTokenNumber });
            transaction.update(orderRef, { customerPhone: customerPhone, dineInToken: dineInToken });
            console.log(`[Webhook WA DineIn] Transaction successful. New token: ${dineInToken}`);
        });

        const trackingUrl = `https://servizephyr.com/track/dine-in/${orderId}?token=${trackingTokenForLink}`;

        await sendWhatsAppMessage(fromNumber, `Thanks, your order request has been received!\n\n*Your Token is: ${dineInToken}*\n\nPlease show this token at the counter.\n\nTrack its live status here:\n${trackingUrl}`, botPhoneNumberId);

        if (business.data.ownerPhone && business.data.botPhoneNumberId) {
            await sendNewOrderToOwner({
                ownerPhone: business.data.ownerPhone,
                botPhoneNumberId: business.data.botPhoneNumberId,
                customerName: `Dine-In (Token: ${dineInToken})`,
                totalAmount: (await orderRef.get()).data().totalAmount,
                orderId: orderId,
                restaurantName: business.data.name
            });
        }

        return true;

    } catch (error) {
        console.error(`[Webhook WA DineIn] CRITICAL error processing confirmation for ${orderId}:`, error);
        if (error.message.includes("Order document not found")) {
            await sendWhatsAppMessage(fromNumber, "Sorry, this order ID is invalid. Please try placing your order again.", botPhoneNumberId);
        } else {
            await sendWhatsAppMessage(fromNumber, "Sorry, we couldn't process your request at the moment. Please try again or contact staff.", botPhoneNumberId);
        }
        return true;
    }
};


const handleButtonActions = async (firestore, buttonId, fromNumber, business, botPhoneNumberId) => {
    const [action, type, ...payloadParts] = buttonId.split('_');

    if (action !== 'action') return;

    const customerPhone = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;
    const conversationRef = business.ref.collection('conversations').doc(customerPhone);

    console.log(`[Webhook WA] Handling button action: '${type}' for customer ${customerPhone}`);

    try {
        switch (type) {
            case 'order': {
                const businessId = payloadParts.join('_');
                // 1. Get or Create Guest Profile (handles migration)
                const { guestId } = await getOrCreateGuestProfile(firestore, customerPhone);

                // 2. Generate Token linked to Guest ID
                const token = await generateSecureToken(firestore, guestId);

                // 3. Obfuscate Guest ID for URL
                const publicRef = obfuscateGuestId(guestId);

                // 4. Generate Link with Guest Ref
                const link = `https://servizephyr.com/order/${businessId}?ref=${publicRef}&token=${token}`;

                await sendWhatsAppMessage(fromNumber, `Here is your personal secure link to place an order (valid for 24 hours):\n\n${link}`, botPhoneNumberId);
                break;
            }
            case 'track': {
                console.log(`[Webhook WA] 'track' action initiated for ${customerPhone}.`);
                const ordersRef = firestore.collection('orders');
                const q = ordersRef.where('customerPhone', '==', customerPhone).orderBy('orderDate', 'desc').limit(1);
                const querySnapshot = await q.get();

                if (querySnapshot.empty) {
                    console.log(`[Webhook WA] No recent orders found for ${customerPhone}.`);
                    await sendWhatsAppMessage(fromNumber, `You don't have any recent orders to track.`, botPhoneNumberId);
                } else {
                    const latestOrderDoc = querySnapshot.docs[0];
                    const latestOrder = latestOrderDoc.data();

                    if (!latestOrder.trackingToken) {
                        console.error(`[Webhook WA] CRITICAL: Tracking token missing for latest order ${latestOrderDoc.id} of customer ${customerPhone}.`);
                        await sendWhatsAppMessage(fromNumber, `We couldn't find tracking information for your last order. Please contact support.`, botPhoneNumberId);
                        return;
                    }
                    const orderId = latestOrderDoc.id;
                    const token = latestOrder.trackingToken;
                    console.log(`[Webhook WA] Found latest order ${orderId} with tracking token.`);

                    const trackingPath = latestOrder.deliveryType === 'dine-in' ? 'dine-in/' : '';
                    const link = `https://servizephyr.com/track/${trackingPath}${orderId}?token=${token}`;

                    await sendWhatsAppMessage(fromNumber, `Here is the tracking link for your latest order (#${orderId.substring(0, 6)}):\n\n${link}`, botPhoneNumberId);
                }
                break;
            }
            case 'help': {
                await conversationRef.set({ state: 'direct_chat' }, { merge: true });
                await sendWhatsAppMessage(fromNumber, `You are now connected directly with a representative from ${business.data.name}. You can ask your questions here.\n\nWhen your query is resolved, the restaurant will end the chat.`, botPhoneNumberId);
                break;
            }
            case 'end': {
                if (payloadParts[0] === 'chat') {
                    await conversationRef.set({ state: 'menu' }, { merge: true });
                    await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
                }
                break;
            }
            case 'report': {
                if (payloadParts[0] === 'admin') {
                    console.log(`[Webhook WA] Admin Report triggered by ${customerPhone} for business ${business.id}`);
                    await sendWhatsAppMessage(fromNumber, `Thank you. Your request to speak with an admin has been noted. We will review the conversation and get back to you shortly.`, botPhoneNumberId);
                }
                break;
            }
            default:
                console.warn(`[Webhook WA] Unhandled button action type: ${type}`);
        }
    } catch (e) {
        console.error(`[Webhook WA] Error handling button action '${type}':`, e);
        await sendWhatsAppMessage(fromNumber, `Sorry, we couldn't process your request right now. Please try again.`, botPhoneNumberId);
    }
}

const processIncomingMedia = async (mediaId, businessId) => {
    try {
        console.log(`[Webhook WA] Processing incoming media: ${mediaId} for business: ${businessId}`);
        const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);

        const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
        const fileName = `${Date.now()}_${nanoid()}.${ext}`;
        const filePath = `whatsapp_media/${businessId}/received/${fileName}`;

        const storage = getStorage();
        // Construct bucket name similarly to other files
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'studio-6552995429-8bffe';
        const bucket = storage.bucket(`${projectId}.firebasestorage.app`);
        const file = bucket.file(filePath);

        await file.save(buffer, {
            contentType: mimeType,
            metadata: {
                metadata: {
                    source: 'whatsapp_direct',
                    businessId: businessId
                }
            }
        });

        console.log(`[Webhook WA] Media uploaded to Storage: ${filePath}`);

        // Generate Signed Read URL
        // ✅ FIX: Expiration: 7 days (standard retention)
        const [readUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        return readUrl;
    } catch (error) {
        console.error("[Webhook WA] Error processing incoming media:", error);
        return null; // Return null on failure so we can fallback to placeholder
    }
};


export async function POST(request) {
    console.log("[Webhook WA] POST request received.");
    try {
        const body = await request.json();

        console.log("[Webhook WA] Request Body Received:", JSON.stringify(body, null, 2));

        if (body.object !== 'whatsapp_business_account') {
            console.log("[Webhook WA] Event is not from a WhatsApp Business Account. Skipping.");
            return NextResponse.json({ message: 'Not a WhatsApp event' }, { status: 200 });
        }

        const firestore = await getFirestore();
        const change = body.entry?.[0]?.changes?.[0];

        if (!change || !change.value) {
            console.log("[Webhook WA] No 'change' or 'value' object found in payload. Skipping.");
            return NextResponse.json({ message: 'No change data' }, { status: 200 });
        }

        const botPhoneNumberId = change.value.metadata.phone_number_id;
        const business = await getBusiness(firestore, botPhoneNumberId);
        if (!business) {
            console.error(`[Webhook WA] No business found for Bot Phone Number ID: ${botPhoneNumberId}`);
            return NextResponse.json({ message: 'Business not found' }, { status: 404 });
        }

        console.log("[Webhook WA] Change Value:", JSON.stringify(change.value, null, 2));

        if (change.value.statuses && change.value.statuses.length > 0) {
            console.log(`[Webhook WA] 🔍 Processing ${change.value.statuses.length} status updates`);

            // Iterate through ALL statuses in the batch
            for (const statusUpdate of change.value.statuses) {
                const messageId = statusUpdate.id;
                const status = statusUpdate.status;
                const recipientId = statusUpdate.recipient_id;
                const customerPhone = recipientId.startsWith('91') ? recipientId.substring(2) : recipientId;

                console.log(`  > Processing Status: ${status} for WAMID: ${messageId}`);

                // Shadow Logging for Debugging (Fire & Forget)
                const debugRef = firestore.collection('_debug_whatsapp_statuses').doc(messageId + "_" + status);
                debugRef.set({
                    wamid: messageId,
                    status: status,
                    recipientId: recipientId,
                    customerPhone: customerPhone,
                    timestamp: FieldValue.serverTimestamp(),
                    raw: JSON.stringify(statusUpdate)
                }).catch(e => console.error("Debug log failed", e));

                if (business) {
                    // Update status with Retry Logic
                    const updateStatusWithRetry = async (phonePath, messageId, status, retries = 5) => {
                        const msgRef = business.ref.collection('conversations').doc(phonePath).collection('messages').doc(messageId);
                        // console.log(`    - Target Path: ${msgRef.path}`);

                        for (let i = 0; i < retries; i++) {
                            try {
                                const doc = await msgRef.get();
                                if (doc.exists) {
                                    await msgRef.update({ status: status });
                                    console.log(`    - ✅ Status updated to '${status}' on attempt ${i + 1}`);
                                    return true;
                                } else {
                                    if (i < retries - 1) await new Promise(r => setTimeout(r, 2000)); // Wait 2s
                                }
                            } catch (err) {
                                console.error(`    - 💥 Error updating Firestore:`, err.message);
                                break;
                            }
                        }
                        return false;
                    };

                    // Try with normalized phone first
                    let success = await updateStatusWithRetry(customerPhone, messageId, status);

                    // If failed, try with raw recipientId
                    if (!success && customerPhone !== recipientId) {
                        console.log(`    - Retrying with raw recipient ID: ${recipientId}`);
                        success = await updateStatusWithRetry(recipientId, messageId, status);
                    }

                    if (!success) {
                        console.error(`    - ❌ FAILED to update status for WAMID: ${messageId}`);
                    }
                } else {
                    console.warn(`  - ❌ Business not found for Bot ID: ${botPhoneNumberId}`);
                }
            }
            return NextResponse.json({ message: 'Statuses processed' }, { status: 200 });
        }

        if (change.value.messages && change.value.messages.length > 0) {
            const message = change.value.messages[0];
            console.log(`[Webhook WA] 📩 INCOMING MESSAGE:`, JSON.stringify(message, null, 2));
            const fromNumber = message.from;
            const fromPhoneNumber = fromNumber.startsWith('91') ? fromNumber.substring(2) : fromNumber;

            if (message.type === 'text') {
                const isDineInHandled = await handleDineInConfirmation(firestore, message.text.body, fromNumber, business, botPhoneNumberId);
                if (isDineInHandled) {
                    console.log(`[Webhook WA] Message handled by Dine-in flow. Skipping further processing.`);
                    return NextResponse.json({ message: 'Dine-in confirmation processed.' }, { status: 200 });
                }
            }

            const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);
            const conversationSnap = await conversationRef.get();
            const conversationData = conversationSnap.exists ? conversationSnap.data() : { state: 'menu' };

            // ✅ FIX: Handle Text (only in direct_chat) AND Media (always)
            // If it's media, we assume user wants to show something to owner, so we treat it as direct chat.
            const isMedia = ['image', 'video', 'document', 'audio'].includes(message.type);

            if (conversationData.state === 'direct_chat' || isMedia) {
                // If it was media and not in direct_chat, switch to direct_chat
                if (isMedia && conversationData.state !== 'direct_chat') {
                    console.log(`[Webhook WA] Media received in '${conversationData.state}' state. Switching to 'direct_chat'.`);
                    await conversationRef.set({ state: 'direct_chat' }, { merge: true });
                }

                const messageRef = conversationRef.collection('messages').doc(message.id);

                let messageContent = '';
                let messageType = message.type;
                let mediaId = null;
                let mediaUrl = null;

                if (message.type === 'text') {
                    messageContent = message.text.body;
                } else if (message.type === 'image') {
                    messageContent = message.image.caption || '[Photo]';
                    mediaId = message.image.id;
                } else if (message.type === 'video') {
                    messageContent = message.video.caption || '[Video]';
                    mediaId = message.video.id;
                } else if (message.type === 'document') {
                    messageContent = message.document.caption || message.document.filename || '[Document]';
                    mediaId = message.document.id;
                } else if (message.type === 'audio') {
                    messageContent = '[Audio]';
                    mediaId = message.audio.id;
                }

                // 1. Save Initial Message (Placeholder)
                await messageRef.set({
                    id: message.id,
                    sender: 'customer',
                    timestamp: FieldValue.serverTimestamp(),
                    status: mediaId ? 'media_pending' : 'received',
                    type: messageType,
                    text: messageContent,
                    mediaId: mediaId,
                    mediaUrl: null, // Initially null
                    rawPayload: JSON.stringify(message)
                });

                await conversationRef.set({
                    customerName: change.value.contacts[0].profile.name,
                    customerPhone: fromPhoneNumber,
                    lastMessage: messageContent,
                    lastMessageType: messageType,
                    lastMessageTimestamp: FieldValue.serverTimestamp(),
                    unreadCount: FieldValue.increment(1)
                }, { merge: true });

                console.log(`[Webhook WA] Saved initial message: ${message.id}`);

                // 2. Download Media (Async processing)
                if (mediaId) {
                    // Do not await this if you want it to be fully background, 
                    // but for now await is safer to ensure function doesn't terminate.
                    // Ideally, we move this to a background trigger, but we'll try sequential first with error handling.
                    try {
                        mediaUrl = await processIncomingMedia(mediaId, business.id);

                        await messageRef.update({
                            mediaUrl: mediaUrl,
                            status: mediaUrl ? 'received' : 'media_failed' // Update status
                        });
                        console.log(`[Webhook WA] Updated message with Media URL: ${mediaUrl}`);
                    } catch (err) {
                        console.error(`[Webhook WA] Failed to update message with media:`, err);
                        await messageRef.update({ status: 'media_failed' });
                    }
                }

                console.log(`[Webhook WA] ${messageType} processing complete for ${fromPhoneNumber}.`);
                return NextResponse.json({ message: 'Forwarded to owner' }, { status: 200 });
            }

            if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
                const buttonReply = message.interactive.button_reply;
                const buttonId = buttonReply.id;

                console.log(`[Webhook WA] Button click detected. Button ID: "${buttonId}", From: ${fromNumber}`);

                await handleButtonActions(firestore, buttonId, fromNumber, business, botPhoneNumberId);
            }
            else if (message.type === 'text' && conversationData.state !== 'direct_chat') {
                await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
            }
        }

        console.log("[Webhook WA] POST request processed successfully.");
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook WA] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
