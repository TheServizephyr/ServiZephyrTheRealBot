
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
    if (!ACCESS_TOKEN || !businessPhoneNumberId) {
        const errorMessage = "WhatsApp credentials (Access Token or Business Phone ID) are not configured in environment variables.";
        console.error(`[WhatsApp Lib] ${errorMessage}`);
        // In a real app, you might want to throw an error or handle this more gracefully.
        return;
    }

    // Determine the final payload structure
    let dataPayload;
    if (typeof payload === 'string') {
        // If payload is a simple string, format it for a text message
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'text',
            text: { body: payload }
        };
    } else {
        // If payload is an object, assume it's a pre-formatted template
        dataPayload = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'template',
            template: payload
        };
    }
    
    console.log("[WhatsApp Lib] Sending payload:", JSON.stringify(dataPayload, null, 2));

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
        console.log(`[WhatsApp Lib] Successfully sent message to ${phoneNumber}. Response:`, JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error(`[WhatsApp Lib] Failed to send message to ${phoneNumber}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        // Optionally re-throw the error if the caller needs to handle it
        // throw error;
    }
};
