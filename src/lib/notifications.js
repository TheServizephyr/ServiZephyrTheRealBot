
import { sendWhatsAppMessage } from './whatsapp';

/**
 * Sends a "New Order" notification to the restaurant owner using a WhatsApp template.
 * Now includes a link to the order details page.
 * @param {object} params
 * @param {string} params.ownerPhone - The owner's phone number with country code.
 * @param {string} params.botPhoneNumberId - The WhatsApp Business Phone Number ID.
 * @param {string} params.customerName - The name of the customer who placed the order.
 * @param {number} params.totalAmount - The grand total of the order.
 * @param {string} params.orderId - The unique ID of the new order.
 */
export const sendNewOrderToOwner = async ({ ownerPhone, botPhoneNumberId, customerName, totalAmount, orderId }) => {
    if (!ownerPhone || !botPhoneNumberId) {
        console.warn(`[Notification Lib] Owner phone or Bot ID not found for this restaurant. Cannot send new order notification.`);
        return;
    }
    const ownerPhoneWithCode = '91 ' + ownerPhone;
    const orderDetailsUrl = `https://servizephyr.com/owner-dashboard/bill/${orderId}`;


    // This is the pre-approved Message Template payload for 'new_order_notification'
    // It now includes a 4th variable for the order details link.
    const notificationPayload = {
        name: "new_order_notification",
        language: { code: "en" },
        components: [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: `₹${totalAmount.toFixed(2)}` },
                    { type: "text", text: orderId },
                    { type: "text", text: orderDetailsUrl } // Variable 4: The link
                ]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "0",
                parameters: [{ type: "payload", payload: `accept_order_${orderId}` }]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "1",
                parameters: [{ type: "payload", payload: `reject_order_${orderId}` }]
            }
        ]
    };

    console.log('[Notification Lib] Payload prepared for owner. Sending message to:', ownerPhoneWithCode, 'using bot ID:', botPhoneNumberId);
    await sendWhatsAppMessage(ownerPhoneWithCode, notificationPayload, botPhoneNumberId);
};


/**
 * Sends an "Order Confirmed" notification to the customer using a WhatsApp template.
 * @param {object} params
 * @param {string} params.customerPhone - The customer's 10-digit phone number.
 * @param {string} params.botPhoneNumberId - The WhatsApp Business Phone Number ID.
 * @param {string} params.customerName - The name of the customer.
 * @param {string} params.orderId - The unique ID of the order.
 * @param {string} params.restaurantName - The name of the restaurant.
 */
export const sendOrderConfirmationToCustomer = async ({ customerPhone, botPhoneNumberId, customerName, orderId, restaurantName }) => {
    const customerPhoneWithCode = '91 ' + customerPhone;

    // This is the pre-approved Message Template payload for 'order_status_update'
    const statusPayload = {
        name: "order_status_update",
        language: { code: "en" }, // Or en_US, depending on your template
        components: [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: orderId.substring(0, 8) }, // Use a shorter version for display
                    { type: "text", text: restaurantName },
                    { type: "text", text: "Confirmed" } // The status we are updating to
                ]
            }
        ]
    };
    
    console.log(`[Notification Lib] Sending confirmation to customer: ${customerPhoneWithCode}`);
    await sendWhatsAppMessage(customerPhoneWithCode, statusPayload, botPhoneNumberId);
};

// Future functions can be added here, e.g.:
// export const sendOrderPreparingNotification = async (params) => { ... }
// export const sendOrderDispatchedNotification = async (params) => { ... }
// export const sendFeedbackRequest = async (params) => { ... }
