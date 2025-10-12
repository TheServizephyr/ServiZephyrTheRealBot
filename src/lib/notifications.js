

import { sendWhatsAppMessage } from './whatsapp';

export const sendNewOrderToOwner = async ({ ownerPhone, botPhoneNumberId, customerName, totalAmount, orderId }) => {

    if (!ownerPhone || !botPhoneNumberId) {
        console.error(`[Notification Lib] CRITICAL: Cannot send new order notification. Owner phone or Bot ID is missing. Owner Phone: ${ownerPhone}, Bot ID: ${botPhoneNumberId}`);
        return;
    }
    const ownerPhoneWithCode = '91' + ownerPhone;
    const orderDetailsUrl = `https://servizephyr.com/owner-dashboard/bill/${orderId}`;

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
                    { type: "text", text: orderDetailsUrl }
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

    await sendWhatsAppMessage(ownerPhoneWithCode, notificationPayload, botPhoneNumberId);
};


export const sendOrderStatusUpdateToCustomer = async ({ customerPhone, botPhoneNumberId, customerName, orderId, restaurantName, status }) => {
    if (!customerPhone || !botPhoneNumberId) {
        console.warn(`[Notification Lib] Customer phone or Bot ID not found. Cannot send status update for order ${orderId}.`);
        return;
    }
    const customerPhoneWithCode = '91' + customerPhone;
    const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);

    const statusPayload = {
        name: "order_status_update",
        language: { code: "en" },
        components: [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: orderId.substring(0, 8) },
                    { type: "text", text: restaurantName },
                    { type: "text", text: capitalizedStatus }
                ]
            }
        ]
    };
    
    await sendWhatsAppMessage(customerPhoneWithCode, statusPayload, botPhoneNumberId);
};
