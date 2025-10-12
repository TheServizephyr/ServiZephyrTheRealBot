

import { sendWhatsAppMessage } from './whatsapp';

export const sendNewOrderToOwner = async ({ ownerPhone, botPhoneNumberId, customerName, totalAmount, orderId }) => {

    if (!ownerPhone || !botPhoneNumberId) {
        console.warn(`[Notification Lib] Owner phone or Bot ID not found for this restaurant. Cannot send new order notification.`);
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


export const sendOrderConfirmationToCustomer = async ({ customerPhone, botPhoneNumberId, customerName, orderId, restaurantName }) => {
    const customerPhoneWithCode = '91' + customerPhone;

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
                    { type: "text", text: "Confirmed" }
                ]
            }
        ]
    };
    
    await sendWhatsAppMessage(customerPhoneWithCode, statusPayload, botPhoneNumberId);
};
