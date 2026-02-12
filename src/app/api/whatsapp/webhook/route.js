
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { sendWhatsAppMessage, downloadWhatsAppMedia, sendSystemMessage } from '@/lib/whatsapp';
import { sendOrderStatusUpdateToCustomer, sendNewOrderToOwner } from '@/lib/notifications';
import axios from 'axios';
import { nanoid } from 'nanoid';
import { getOrCreateGuestProfile, obfuscateGuestId } from '@/lib/guest-utils';


const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES = 30;

/**
 * Normalizes phone numbers to 10 digits (removes +91 or 91 prefix)
 */
const normalizePhone = (phone) => {
    if (!phone) return '';
    // Remove +91 or 91 prefix and keep last 10 digits
    const cleaned = phone.replace(/^\+?91/, '').replace(/\D/g, '');
    return cleaned.length > 10 ? cleaned.slice(-10) : cleaned;
};

const coerceDate = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') {
        const parsed = value.toDate();
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getDirectChatTimeoutMinutes = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_DIRECT_CHAT_TIMEOUT_MINUTES;
    }
    return parsed;
};

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

const generateSecureToken = async (firestore, userId) => {
    console.log(`[Webhook WA] generateSecureToken: Generating for userId: ${userId}`);
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity
    const authTokenRef = firestore.collection('auth_tokens').doc(token);
    await authTokenRef.set({
        userId: userId, // Store User ID (UID or Guest ID)
        expiresAt: expiry,
        type: 'tracking'
    });
    console.log("[Webhook WA] generateSecureToken: Token generated linked to User ID.");
    return token;
};

/**
 * Transitions a conversation to direct_chat state and sends the Standard Welcome Message.
 */
const activateDirectChat = async (fromNumber, business, botPhoneNumberId) => {
    const fromPhoneNumber = normalizePhone(fromNumber);
    const firestore = await getFirestore();
    const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);

    console.log(`[Webhook WA] Activating Direct Chat for ${fromPhoneNumber}`);

    await conversationRef.set({
        state: 'direct_chat',
        enteredDirectChatAt: FieldValue.serverTimestamp(),
        directChatTimeoutMinutes: 30
    }, { merge: true });

    const restaurantName = business.data.name || 'the restaurant';
    const activationBody = `Now you are connected to *${restaurantName}* directly. Put up your queries.\n\n⏱️ The chat is active for 30 minutes.\n\n💬 You can end chat any time by typing *'end chat'* or clicking the button below.`;

    const helpMessage = {
        type: "interactive",
        interactive: {
            type: "button",
            body: {
                text: activationBody
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: `action_end_chat`, title: "End Chat" } }
                ]
            }
        }
    };
    await sendWhatsAppMessage(fromNumber, helpMessage, botPhoneNumberId);

    // Log activation message to Firestore transcript
    await conversationRef.collection('messages').add({
        sender: 'system',
        type: 'system',
        text: activationBody,
        timestamp: FieldValue.serverTimestamp(),
        status: 'sent',
        isSystem: true
    });
};


const sendWelcomeMessageWithOptions = async (
    customerPhoneWithCode,
    business,
    botPhoneNumberId,
    customMessage = null,
    options = {}
) => {
    console.log(`[Webhook WA] Preparing to send welcome message to ${customerPhoneWithCode}`);

    // Standardize phone number for Firestore
    const fromPhoneNumber = normalizePhone(customerPhoneWithCode);
    const firestore = await getFirestore();
    const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);
    const bypassRateLimit = options?.bypassRateLimit === true;

    // Rate limiting: Don't send more than one welcome menu every 10 seconds to same user
    if (!bypassRateLimit) {
        const conversationDoc = await conversationRef.get();
        if (conversationDoc.exists) {
            const lastSent = conversationDoc.data().lastWelcomeSent;
            if (lastSent && (Date.now() - lastSent.toDate().getTime()) < 10000) {
                console.log(`[Webhook WA] Welcome message rate-limited for ${fromPhoneNumber}`);
                return;
            }
        }
    }

    console.log(`[Webhook WA] Sending interactive welcome message to ${customerPhoneWithCode}`);

    const welcomeBody = customMessage || `Welcome to ${business.data.name}!\n\nWhat would you like to do today?`;

    const payload = {
        type: "interactive",
        interactive: {
            type: "button",
            body: {
                text: welcomeBody
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

    const response = await sendWhatsAppMessage(customerPhoneWithCode, payload, botPhoneNumberId);

    // ✅ PERSISTENCE: Save Welcome Message to Firestore
    if (response && response.messages && response.messages[0]) {
        const wamid = response.messages[0].id;
        await conversationRef.collection('messages').doc(wamid).set({
            id: wamid,
            sender: 'system',
            type: 'system',
            text: welcomeBody, // Simplify for display
            interactive_type: 'welcome_menu',
            timestamp: FieldValue.serverTimestamp(),
            status: 'sent',
            isSystem: true
        });
        console.log(`[Webhook WA] Welcome message saved to Firestore: ${wamid}`);
    }

    // ✅ Update timestamp to prevent duplicates
    await conversationRef.set({ lastWelcomeSent: FieldValue.serverTimestamp() }, { merge: true });
}


const handleDineInConfirmation = async (firestore, text, fromNumber, business, botPhoneNumberId) => {
    // Standardize phone number
    const normalizedFrom = normalizePhone(fromNumber);

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

        const collectionName = business.ref.parent.id;
        await sendSystemMessage(fromNumber, `Thanks, your order request has been received!\n\n*Your Token is: ${dineInToken}*\n\nPlease show this token at the counter.\n\nTrack its live status here:\n${trackingUrl}`, botPhoneNumberId, business.id, business.data.name, collectionName);

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
            const collectionName = business.ref.parent.id;
            await sendSystemMessage(fromNumber, "Sorry, this order ID is invalid. Please try placing your order again.", botPhoneNumberId, business.id, business.data.name, collectionName);
        } else {
            const collectionName = business.ref.parent.id;
            await sendSystemMessage(fromNumber, "Sorry, we couldn't process your request at the moment. Please try again or contact staff.", botPhoneNumberId, business.id, business.data.name, collectionName);
        }
        return true;
    }
};


const handleButtonActions = async (firestore, buttonId, fromNumber, business, botPhoneNumberId) => {
    const [action, type, ...payloadParts] = buttonId.split('_');

    if (action !== 'action') return;

    const customerPhone = normalizePhone(fromNumber);
    const conversationRef = business.ref.collection('conversations').doc(customerPhone);

    console.log(`[Webhook WA] Handling button action: '${type}' for customer ${customerPhone}`);

    // ✅ PERSISTENCE: Save User Selection Logic
    // We infer the text based on button type
    let userSelectionText = '';
    switch (type) {
        case 'order': userSelectionText = 'Selected: \uD83C\uDF7D\uFE0F Order Food'; break;
        case 'track': userSelectionText = 'Selected: \uD83D\uDCE6 Track Last Order'; break;
        case 'help': userSelectionText = 'Selected: \u2753 Need Help?'; break;
        case 'end': userSelectionText = 'Selected: \uD83D\uDED1 End Chat'; break;
        case 'report': userSelectionText = 'Selected: Admin Support'; break;
        default: userSelectionText = `Selected: ${type}`;
    }

    await conversationRef.collection('messages').add({
        sender: 'customer', // It was a user action
        type: 'system_event', // Different styling if needed, otherwise 'text'
        text: userSelectionText, // Show what they clicked
        id: `evt_${Date.now()}_${nanoid(6)}`, // Virtual ID
        timestamp: FieldValue.serverTimestamp(),
        status: 'read',
        isSystem: true // Treat as system event for display
    });


    try {
        switch (type) {
            case 'order': {
                const businessId = payloadParts.join('_');
                console.log(`[Webhook WA] 🔍 ORDER ACTION - BusinessId: ${businessId}, Phone: ${customerPhone}`);

                // 1. Get User ID (UID for logged-in, guest ID for non-logged-in)
                const profileResult = await getOrCreateGuestProfile(firestore, customerPhone);
                const { userId } = profileResult;
                console.log(`[Webhook WA] ✅ Profile Result - userId: ${userId}, isGuest: ${profileResult.isGuest}, isNew: ${profileResult.isNew}`);

                // 🔒 CRITICAL: Verify this is a customer profile, not a restaurant owner
                if (!profileResult.isGuest) {
                    // If UID (logged-in user), verify role is 'customer'
                    const userDoc = await firestore.collection('users').doc(userId).get();
                    if (userDoc.exists) {
                        const userRole = userDoc.data().role;
                        if (userRole !== 'customer') {
                            console.error(`[Webhook WA] ❌ BLOCKED: User ${userId} has role='${userRole}', not 'customer'. Cannot send link.`);
                            await sendSystemMessage(fromNumber, `Sorry, this phone number is registered as a business account. Please use a different number for ordering.`, botPhoneNumberId, business.id, business.data.name, collectionName);
                            break;
                        }
                        console.log(`[Webhook WA] ✅ Role verified: customer`);
                    }
                }

                // 2. Obfuscate User ID for URL (no token needed - ref provides security)
                const publicRef = obfuscateGuestId(userId);
                console.log(`[Webhook WA] ✅ Obfuscated Ref: ${publicRef} ← from userId: ${userId}`);

                // 3. Generate Link with only ref (no token)
                const link = `https://servizephyr.com/order/${businessId}?ref=${publicRef}`;

                const collectionName = business.ref.parent.id;
                await sendSystemMessage(fromNumber, `Here is your personal secure link to place an order:\n\n${link}`, botPhoneNumberId, business.id, business.data.name, collectionName);
                break;
            }
            case 'track': {
                console.log(`[Webhook WA] 'track' action initiated for ${customerPhone}.`);

                // Get user ID (UID if logged-in, guest ID if not)
                const { userId } = await getOrCreateGuestProfile(firestore, customerPhone);

                const ordersRef = firestore.collection('orders');
                // CRITICAL FIX: Use existing composite index (restaurantId + userId + orderDate DESC)
                // without this filter, it requires a missing index (userId + orderDate DESC)
                const q = ordersRef
                    .where('restaurantId', '==', business.id)
                    .where('userId', '==', userId)
                    .orderBy('orderDate', 'desc')
                    .limit(1);

                const querySnapshot = await q.get();

                if (querySnapshot.empty) {
                    console.log(`[Webhook WA] No recent orders found for userId ${userId}.`);
                    const collectionName = business.ref.parent.id;
                    await sendSystemMessage(fromNumber, `You don't have any recent orders to track.`, botPhoneNumberId, business.id, business.data.name, collectionName);
                } else {
                    const latestOrderDoc = querySnapshot.docs[0];
                    const latestOrder = latestOrderDoc.data();

                    if (!latestOrder.trackingToken) {
                        console.error(`[Webhook WA] CRITICAL: Tracking token missing for latest order ${latestOrderDoc.id} of userId ${userId}.`);
                        const collectionName = business.ref.parent.id;
                        await sendSystemMessage(fromNumber, `We couldn't find tracking information for your last order. Please contact support.`, botPhoneNumberId, business.id, business.data.name, collectionName);
                        return;
                    }
                    const orderId = latestOrderDoc.id;
                    const token = latestOrder.trackingToken;
                    console.log(`[Webhook WA] Found latest order ${orderId} with tracking token for userId ${userId}.`);

                    // Generate Obfuscated Ref for guest/user
                    const publicRef = obfuscateGuestId(userId);

                    let trackingPath = 'delivery/'; // Default to delivery
                    if (latestOrder.deliveryType === 'dine-in') {
                        trackingPath = 'dine-in/';
                    } else if (latestOrder.deliveryType === 'pickup') {
                        trackingPath = 'pickup/'; // Assuming pickup exists, otherwise delivery/ is safe fallback or specific page
                    }

                    // Format: /track/[type]/[orderId]?token=...&ref=...&activeOrderId=...
                    const link = `https://www.servizephyr.com/track/${trackingPath}${orderId}?token=${token}&ref=${publicRef}&activeOrderId=${orderId}`;

                    const displayOrderId = latestOrder.customerOrderId ? `#${latestOrder.customerOrderId}` : `#${orderId.substring(0, 8)}`;
                    const collectionName = business.ref.parent.id;
                    await sendSystemMessage(fromNumber, `Here is the tracking link for your latest order (${displayOrderId}):\n\n${link}`, botPhoneNumberId, business.id, business.data.name, collectionName);
                }
                break;
            }
            case 'help': {
                await activateDirectChat(fromNumber, business, botPhoneNumberId);
                break;
            }
            case 'end': {
                if (payloadParts[0] === 'chat') {
                    await conversationRef.set({ state: 'menu' }, { merge: true });
                    await sendWhatsAppMessage(fromNumber, `Chat has ended.`, botPhoneNumberId);
                    await conversationRef.collection('messages').add({
                        sender: 'system',
                        timestamp: FieldValue.serverTimestamp(), // Consistent with customer message
                        type: 'system',
                        text: 'Chat ended by customer',
                        isSystem: true
                    });
                    await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
                }
                break;
            }
            case 'report': {
                if (payloadParts[0] === 'admin') {
                    console.log(`[Webhook WA] Admin Report triggered by ${customerPhone} for business ${business.id}`);
                    const collectionName = business.ref.parent.id;
                    await sendSystemMessage(fromNumber, `Thank you. Your request to speak with an admin has been noted. We will review the conversation and get back to you shortly.`, botPhoneNumberId, business.id, business.data.name, collectionName);
                }
                break;
            }
            default:
                console.warn(`[Webhook WA] Unhandled button action type: ${type}`);
        }
    } catch (e) {
        console.error(`[Webhook WA] Error handling button action '${type}':`, e);
        const collectionName = business.ref.parent.id;
        await sendSystemMessage(fromNumber, `Sorry, we couldn't process your request right now. Please try again.`, botPhoneNumberId, business.id, business.data.name, collectionName);
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

        // ✅ HANDLE PERMANENT PUBLIC ACCESS
        // We make the file public and use a permanent URL to avoid 403 errors and expiry issues.
        try {
            await file.makePublic();
        } catch (err) {
            console.error("[Webhook WA] Failed to make file public, falling back to signed URL:", err);
            const [signedUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
            });
            return signedUrl;
        }

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
        return publicUrl;
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

        const restaurantName = business.data.name || 'the restaurant';

        console.log("[Webhook WA] Change Value:", JSON.stringify(change.value, null, 2));

        if (change.value.statuses && change.value.statuses.length > 0) {
            console.log(`[Webhook WA] 🔍 Processing ${change.value.statuses.length} status updates`);

            // Iterate through ALL statuses in the batch
            for (const statusUpdate of change.value.statuses) {
                const messageId = statusUpdate.id;
                const status = statusUpdate.status;
                const recipientId = statusUpdate.recipient_id;
                const customerPhone = normalizePhone(recipientId);

                console.log(`  > Processing Status: ${status} for WAMID: ${messageId}`);

                // Shadow Logging for Debugging (Disabled for Production)
                // const debugRef = firestore.collection('_debug_whatsapp_statuses').doc(messageId + "_" + status);
                // debugRef.set({
                //     wamid: messageId,
                //     status: status,
                //     recipientId: recipientId,
                //     customerPhone: customerPhone,
                //     timestamp: FieldValue.serverTimestamp(),
                //     raw: JSON.stringify(statusUpdate)
                // }).catch(e => console.error("Debug log failed", e));

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
            console.log(`[Webhook WA] 📩 Processing batch of ${change.value.messages.length} messages`);

            for (const message of change.value.messages) {
                console.log(`[Webhook WA] Processing Message ID: ${message.id}, Type: ${message.type}`);
                const fromNumber = message.from;
                const fromPhoneNumber = normalizePhone(fromNumber);

                const conversationRef = business.ref.collection('conversations').doc(fromPhoneNumber);
                const conversationSnap = await conversationRef.get();
                let conversationData = conversationSnap.exists ? conversationSnap.data() : { state: 'menu' };

                // ✅ 0. TIMEOUT CHECK: Reset direct_chat if 30 mins passed
                if (conversationData.state === 'direct_chat') {
                    const enteredAt = coerceDate(conversationData.enteredDirectChatAt);
                    const timeoutMinutes = getDirectChatTimeoutMinutes(conversationData.directChatTimeoutMinutes);
                    const timeoutMessage = `Your chat has been closed automatically due to ${timeoutMinutes} minutes of inactivity.\n\nIf your issue is not resolved, tap *Need Help?* to start direct chat again.`;

                    if (!enteredAt) {
                        console.warn(`[Webhook WA] Missing/invalid enteredDirectChatAt for ${fromPhoneNumber}. Resetting state.`);
                        await conversationRef.set({
                            state: 'menu',
                            autoExpiredAt: FieldValue.serverTimestamp(),
                        }, { merge: true });
                        conversationData.state = 'menu';
                        await sendWelcomeMessageWithOptions(
                            fromNumber,
                            business,
                            botPhoneNumberId,
                            timeoutMessage,
                            { bypassRateLimit: true }
                        );
                    } else {
                        const elapsedMinutes = (Date.now() - enteredAt.getTime()) / 60000;
                        if (elapsedMinutes >= timeoutMinutes) {
                            console.log(`[Webhook WA] Session EXPIRED for ${fromPhoneNumber}. Resetting to menu.`);

                            await conversationRef.set({
                                state: 'menu',
                                autoExpiredAt: FieldValue.serverTimestamp(),
                            }, { merge: true });
                            conversationData.state = 'menu';
                            await sendWelcomeMessageWithOptions(
                                fromNumber,
                                business,
                                botPhoneNumberId,
                                timeoutMessage,
                                { bypassRateLimit: true }
                            );
                        }
                    }
                }

                // ✅ 1. UNIVERSAL LOGGING: Save EVERY incoming message to Firestore FIRST
                const messageRef = conversationRef.collection('messages').doc(message.id);

                // ✅ TIMESTAMP: Use WhatsApp's provided timestamp (in seconds)
                const waTimestamp = message.timestamp ? new Date(parseInt(message.timestamp) * 1000) : new Date();

                let messageContent = '';
                let messageType = message.type;
                let mediaId = null;

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
                } else if (message.type === 'interactive') {
                    messageContent = message.interactive.button_reply?.title || message.interactive.list_reply?.title || '[Interactive]';
                }

                // Skip logging specific technical signals if needed, but for now log everything
                await messageRef.set({
                    id: message.id,
                    sender: 'customer',
                    timestamp: waTimestamp, // Use converted WA timestamp
                    status: mediaId ? 'media_pending' : 'received',
                    type: messageType,
                    text: messageContent,
                    mediaId: mediaId,
                    rawPayload: JSON.stringify(message)
                }, { merge: true });

                const customerNameFromPayload = change.value.contacts?.[0]?.profile?.name || fromPhoneNumber;
                const shouldIncrementUnreadForOwner = conversationData.state === 'direct_chat';
                const conversationUpdate = {
                    customerName: customerNameFromPayload,
                    customerPhone: fromPhoneNumber,
                    lastMessage: messageContent,
                    lastMessageType: messageType,
                    lastMessageTimestamp: FieldValue.serverTimestamp(),
                };

                // Owner-side unread notifications should ONLY come from direct chat mode.
                if (shouldIncrementUnreadForOwner) {
                    conversationUpdate.unreadCount = FieldValue.increment(1);
                }

                await conversationRef.set(conversationUpdate, { merge: true });

                console.log(`[Webhook WA] Message ${message.id} logged for ${fromPhoneNumber}`);

                // ✅ 2. COMMAND PROCESSING: Handle specific keywords after logging
                if (message.type === 'text') {
                    const textBody = message.text.body.trim().toLowerCase();

                    // End Chat (Flexible Regex: handle case, spaces, and optional quotes)
                    const endChatMatch = textBody.match(/^["]?\s*end\s*chat\s*["]?$/i);
                    if (endChatMatch) {
                        await conversationRef.set({ state: 'menu' }, { merge: true });
                        await sendWhatsAppMessage(fromNumber, `Chat has ended.`, botPhoneNumberId);
                        await conversationRef.collection('messages').add({
                            sender: 'system',
                            timestamp: waTimestamp, // Consistent with customer message
                            type: 'system',
                            text: 'Chat ended by customer',
                            isSystem: true
                        });
                        await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId);
                        continue; // Process next message in batch
                    }

                    // Dine-in
                    const isDineInHandled = await handleDineInConfirmation(firestore, message.text.body, fromNumber, business, botPhoneNumberId);
                    if (isDineInHandled) continue;
                }

                // ✅ 3. Media Processing
                if (mediaId) {
                    processIncomingMedia(mediaId, business.id).then(async (mediaUrl) => {
                        await messageRef.update({
                            mediaUrl: mediaUrl,
                            status: mediaUrl ? 'received' : 'media_failed'
                        });
                    }).catch(err => console.error("Media processing bg error", err));
                }

                // ✅ 4. STATE-BASED RESPONSES
                // Handle interactive button clicks (ALWAYS process button actions, even if state is silent)
                if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
                    await handleButtonActions(firestore, message.interactive.button_reply.id, fromNumber, business, botPhoneNumberId);
                }
                // If in direct_chat or browsing_order, bot stays quiet for other types of messages
                else if (conversationData.state === 'direct_chat' || conversationData.state === 'browsing_order') {
                    console.log(`[Webhook WA] Bot SILENT (State: ${conversationData.state}) for ${fromPhoneNumber}`);
                }
                // Treat Media as Chat Ignition in Menu mode
                else if (mediaId) {
                    console.log(`[Webhook WA] Media received in Menu mode. Triggering Direct Chat.`);
                    await activateDirectChat(fromNumber, business, botPhoneNumberId);
                }
                // Handle text messages in Menu mode (Strict Enforcement)
                else if (message.type === 'text') {
                    const promptText = `Please select an option from the menu below to proceed:`;
                    await sendWelcomeMessageWithOptions(fromNumber, business, botPhoneNumberId, promptText);
                }
            }
            return NextResponse.json({ message: 'Messages processed' }, { status: 200 });
        }

        console.log("[Webhook WA] POST request processed successfully.");
        return NextResponse.json({ message: 'Event received' }, { status: 200 });

    } catch (error) {
        console.error('[Webhook WA] CRITICAL Error processing POST request:', error);
        return NextResponse.json({ message: 'Error processing request, but acknowledged.' }, { status: 200 });
    }
}
