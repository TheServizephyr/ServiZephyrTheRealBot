

import { sendWhatsAppMessage } from './whatsapp';

export const sendNewOrderToOwner = async ({ ownerPhone, botPhoneNumberId, customerName, totalAmount, orderId }) => {

    if (!ownerPhone || !botPhoneNumberId) {
        console.error(`[Notification Lib] CRITICAL: Cannot send new order notification. Owner phone or Bot ID is missing. Owner Phone: ${ownerPhone}, Bot ID: ${botPhoneNumberId}`);
        return;
    }
    const ownerPhoneWithCode = '91' + ownerPhone;
    const orderDetailsUrl = `https://servizephyr.com/owner-dashboard/live-orders`;

    const notificationPayload = {
        name: "new_order_notification_v2",
        language: { code: "en" },
        components: [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: `₹${totalAmount.toFixed(2)}` },
                    { type: "text", text: orderId }
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
    
    let templateName;
    let parameters;

    switch (status) {
        case 'confirmed':
            templateName = 'order_confirmation';
            parameters = [
                { type: "text", text: customerName },
                { type: "text", text: orderId.substring(0, 8) },
                { type: "text", text: restaurantName },
            ];
            break;
        case 'preparing':
        case 'dispatched':
        case 'delivered':
            templateName = 'order_status_update';
            const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);
            parameters = [
                { type: "text", text: customerName },
                { type: "text", text: orderId.substring(0, 8) },
                { type: "text", text: restaurantName },
                { type: "text", text: capitalizedStatus },
            ];
            break;
        default:
            return;
    }

    const statusPayload = {
        name: templateName,
        language: { code: "en" },
        components: [
            {
                type: "body",
                parameters: parameters,
            }
        ]
    };
    
    await sendWhatsAppMessage(customerPhoneWithCode, statusPayload, botPhoneNumberId);
};

export const sendRestaurantStatusChangeNotification = async ({ ownerPhone, botPhoneNumberId, newStatus, restaurantId }) => {
    if (!ownerPhone || !botPhoneNumberId) {
        console.error(`[Notification Lib] Cannot send status change notification. Owner phone or Bot ID is missing.`);
        return;
    }
    const ownerPhoneWithCode = '91' + ownerPhone;

    const isOpen = newStatus;
    const statusText = isOpen ? "OPEN" : "CLOSED";
    const oppositeStatusText = isOpen ? "CLOSED" : "OPEN";
    const revertPayload = `revert_status_${restaurantId}_${isOpen ? 'closed' : 'open'}`;
    const retainPayload = `retain_status_${restaurantId}_${isOpen ? 'open' : 'closed'}`;

    const payload = {
        name: "restaurant_status_change_alert",
        language: { code: "en" },
        components: [
            {
                type: "body",
                parameters: [
                    { type: "text", text: statusText }
                ]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "0",
                parameters: [{ type: "payload", payload: retainPayload }]
            },
            {
                type: "button",
                sub_type: "quick_reply",
                index: "1",
                parameters: [{ type: "payload", payload: revertPayload }]
            }
        ]
    };
    
    await sendWhatsAppMessage(ownerPhoneWithCode, payload, botPhoneNumberId);
}


export const sendOrderConfirmationToCustomer = async (params) => {
    await sendOrderStatusUpdateToCustomer({ ...params, status: 'confirmed' });
};
