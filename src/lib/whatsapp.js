

import axios from 'axios';
import { getFirestore, FieldValue } from './firebase-admin.js';

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Sends a WhatsApp message using the Meta Graph API.
 * @param {string} phoneNumber The recipient's phone number (with country code).
 * @param {object|string} payload The message payload. For simple text, it's a string. For templates or interactive messages, it's an object.
 * @param {string} businessPhoneNumberId The ID of the WhatsApp Business phone number sending the message.
 */
export const sendWhatsAppMessage = async (phoneNumber, payload, businessPhoneNumberId) => {
    console.log(`[WhatsApp Lib] Preparing to send message to ${phoneNumber} from Bot ID ${businessPhoneNumberId}.`);

    if (!ACCESS_TOKEN || !businessPhoneNumberId) {
        const errorMessage = "WhatsApp credentials (Access Token or Business Phone ID) are not configured in environment variables.";
        console.error(`[WhatsApp Lib] CRITICAL: ${errorMessage}`);
        return;
    }

    let dataPayload;
    if (typeof payload === 'string') {
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'text',
            text: { body: payload }
        };
        console.log(`[WhatsApp Lib] Payload is a simple text message.`);
    } else if (['image', 'video', 'audio', 'document', 'interactive'].includes(payload.type)) {
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            ...payload
        };
        console.log(`[WhatsApp Lib] Payload is a ${payload.type} message.`);
    } else {
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'template',
            template: payload
        };
        console.log(`[WhatsApp Lib] Payload is a template message: ${payload.name}`);
    }

    console.log('[WhatsApp Lib] Full request payload:', JSON.stringify(dataPayload, null, 2));

    try {
        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${businessPhoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: dataPayload
        });
        console.log(`[WhatsApp Lib] Successfully initiated message to ${phoneNumber}. Response:`, JSON.stringify(response.data, null, 2));
        return response.data; // ✅ FIX: Return data so we can get the WAMID
    } catch (error) {
        console.error(`[WhatsApp Lib] FAILED to send message to ${phoneNumber}.`);
        if (error.response) {
            console.error('[WhatsApp Lib] Error Data:', JSON.stringify(error.response.data, null, 2));
            console.error('[WhatsApp Lib] Error Status:', error.response.status);
            throw new Error(JSON.stringify(error.response.data.error || { message: "WhatsApp API returned an error" }));
        } else if (error.request) {
            console.error('[WhatsApp Lib] No response received:', error.request);
            throw new Error("No response received from WhatsApp API");
        } else {
            console.error('[WhatsApp Lib] Error setting up request:', error.message);
            throw new Error(error.message);
        }
    }
};

/**
 * Downloads media from WhatsApp using the Media ID.
 * @param {string} mediaId The WhatsApp Media ID.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>} The media buffer and mime type.
 */
export const downloadWhatsAppMedia = async (mediaId) => {
    try {
        console.log(`[WhatsApp Lib] downloadWhatsAppMedia called for ID: ${mediaId}`);
        if (!ACCESS_TOKEN) {
            console.error("[WhatsApp Lib] CRITICAL: ACCESS_TOKEN is missing in downloadWhatsAppMedia");
            throw new Error("Missing ACCESS_TOKEN");
        }

        console.log(`[WhatsApp Lib] Getting media URL for ID: ${mediaId}`);
        // 1. Get Media URL
        const urlResponse = await axios({
            method: 'GET',
            url: `https://graph.facebook.com/v19.0/${mediaId}`,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });

        const mediaUrl = urlResponse.data.url;
        const mimeType = urlResponse.data.mime_type;
        console.log(`[WhatsApp Lib] Media URL found: ${mediaUrl}, Type: ${mimeType}`);

        // 2. Download Binary Data
        const binaryResponse = await axios({
            method: 'GET',
            url: mediaUrl,
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
            responseType: 'arraybuffer'
        });

        return {
            buffer: Buffer.from(binaryResponse.data),
            mimeType: mimeType
        };

    } catch (error) {
        console.error(`[WhatsApp Lib] Failed to download media ${mediaId}:`, error.message);
        throw error;
    }
};

/**
 * Marks a message as read in WhatsApp.
 * @param {string} messageId The WhatsApp Message ID to mark as read.
 * @param {string} businessPhoneNumberId The ID of the WhatsApp Business phone number.
 */
export const markWhatsAppMessageAsRead = async (messageId, businessPhoneNumberId) => {
    try {
        console.log(`[WhatsApp Lib] Marking message ${messageId} as READ.`);

        if (!ACCESS_TOKEN || !businessPhoneNumberId) {
            throw new Error("Missing Credentials");
        }

        const response = await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v19.0/${businessPhoneNumberId}/messages`,
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            }
        });

        console.log(`[WhatsApp Lib] Message ${messageId} marked as read. Response: ${response.data?.success}`);
        return true;
    } catch (error) {
        console.error(`[WhatsApp Lib] Failed to mark message ${messageId} as read:`, error.message);
        // Don't throw here, just log failure. It's a non-critical UX feature.
        return false;
    }
};

/**
 * Sends a system-generated WhatsApp message with header, footer and stores it in Firestore.
 * @param {string} phoneNumber The recipient's phone number (with country code, e.g., '919876543210').
 * @param {string} messageText The message text to send.
 * @param {string} businessPhoneNumberId The WhatsApp Business Phone Number ID.
 * @param {string} businessId The Firestore business document ID (restaurant/shop ID).
 * @param {string} restaurantName The name of the restaurant/business.
 * @param {string} collectionName The Firestore collection name ('restaurants' or 'shops').
 */
export const sendSystemMessage = async (phoneNumber, messageText, businessPhoneNumberId, businessId, restaurantName, collectionName = 'restaurants') => {
    try {
        // Add header and footer to message
        const header = `*${restaurantName} (powered by ServiZephyr)*\n\n`;
        const footer = "\n\n_To end this chat and place an order, type 'end chat'_";
        const fullMessage = header + messageText + footer;

        // Send via WhatsApp API
        const response = await sendWhatsAppMessage(phoneNumber, fullMessage, businessPhoneNumberId);

        if (!response || !response.messages || !response.messages[0]) {
            console.error('[WhatsApp Lib] Failed to get message ID from WhatsApp response');
            return;
        }

        const wamid = response.messages[0].id;

        // Store in Firestore
        const firestore = await getFirestore();
        const cleanPhone = phoneNumber.replace(/^\+?91/, ''); // Remove country code for conversation ID

        const messageData = {
            wamid: wamid,
            type: 'system',
            direction: 'outgoing',
            body: fullMessage,
            timestamp: FieldValue.serverTimestamp(),
            status: 'sent'
        };

        await firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('conversations')
            .doc(cleanPhone)
            .collection('messages')
            .doc(wamid)
            .set(messageData);

        console.log(`[WhatsApp Lib] System message sent and stored: ${wamid}`);
        return response;

    } catch (error) {
        console.error('[WhatsApp Lib] Error in sendSystemMessage:', error);
        throw error;
    }
};
