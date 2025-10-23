

import axios from 'axios';

const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Sends a WhatsApp message using the Meta Graph API.
 * This is the centralized function for all outgoing WhatsApp messages.
 * @param {string} phoneNumber The recipient's phone number (with country code).
 * @param {object|string} payload The message payload. Can be a string for simple text or a complex object for templates.
 * @param {string} businessPhoneNumberId The ID of the WhatsApp Business phone number sending the message.
 */
export const sendWhatsAppMessage = async (phoneNumber, payload, businessPhoneNumberId) => {
    console.log(`[WhatsApp Lib] Preparing to send message to ${phoneNumber} from Bot ID ${businessPhoneNumberId}.`);
    
    if (!ACCESS_TOKEN || !businessPhoneNumberId) {
        const errorMessage = "WhatsApp credentials (Access Token or Business Phone ID) are not configured in environment variables.";
        console.error(`[WhatsApp Lib] CRITICAL: ${errorMessage}`);
        // Do not throw, just log and return to avoid crashing the caller function.
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
    } catch (error) {
        console.error(`[WhatsApp Lib] FAILED to send message to ${phoneNumber}.`);
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('[WhatsApp Lib] Error Data:', JSON.stringify(error.response.data, null, 2));
            console.error('[WhatsApp Lib] Error Status:', error.response.status);
            console.error('[WhatsApp Lib] Error Headers:', error.response.headers);
        } else if (error.request) {
            // The request was made but no response was received
            console.error('[WhatsApp Lib] No response received:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('[WhatsApp Lib] Error setting up request:', error.message);
        }
    }
};
