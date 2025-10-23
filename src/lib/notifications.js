

import { sendWhatsAppMessage } from './whatsapp';

export const sendNewOrderToOwner = async ({ ownerPhone, botPhoneNumberId, customerName, totalAmount, orderId }) => {
    console.log(`[Notification Lib] Preparing 'new_order' notification for owner ${ownerPhone}.`);

    if (!ownerPhone || !botPhoneNumberId) {
        console.error(`[Notification Lib] CRITICAL: Cannot send new order notification. Owner phone or Bot ID is missing. Owner Phone: ${ownerPhone}, Bot ID: ${botPhoneNumberId}`);
        return;
    }
    const ownerPhoneWithCode = '91' + ownerPhone;
    
    console.log(`[Notification Lib] New order details: Customer: ${customerName}, Amount: ${totalAmount}, OrderID: ${orderId}`);

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

    console.log(`[Notification Lib] Sending 'new_order' template to owner.`);
    await sendWhatsAppMessage(ownerPhoneWithCode, notificationPayload, botPhoneNumberId);
    console.log(`[Notification Lib] 'new_order' notification sent.`);
};


export const sendOrderStatusUpdateToCustomer = async ({ customerPhone, botPhoneNumberId, customerName, orderId, restaurantName, status, deliveryBoy = null, businessType = 'restaurant' }) => {
    console.log(`[Notification Lib] Preparing status update for customer ${customerPhone}. Order: ${orderId}, New Status: ${status}.`);
    
    if (!customerPhone || !botPhoneNumberId) {
        console.warn(`[Notification Lib] Customer phone or Bot ID not found. Cannot send status update for order ${orderId}.`);
        return;
    }
    const customerPhoneWithCode = '91' + customerPhone;
    
    let templateName;
    let components = [];

    const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
    
    const statusMessages = {
        restaurant: {
            preparing: "Your food is being prepared",
        },
        shop: {
            preparing: "Your items are being packed",
        }
    };
    
    const preparingMessage = statusMessages[businessType]?.preparing || "Your order is being prepared";
    console.log(`[Notification Lib] Business type is '${businessType}', using preparing message: "${preparingMessage}"`);


    switch (status) {
        case 'dispatched':
            templateName = 'order_dispatched_simple';
            const trackingUrl = `https://servizephyr.com/track/${orderId}`;
            const bodyParams = [
                { type: "text", text: customerName },
                { type: "text", text: orderId.substring(0, 8) },
                { type: "text", text: restaurantName },
                { type: "text", text: deliveryBoy?.name || 'Our delivery partner' },
                { type: "text", text: deliveryBoy?.phone ? `+91${deliveryBoy.phone}`: 'N/A' },
                { type: "text", text: trackingUrl }
            ];
            components.push({ type: "body", parameters: bodyParams });
            console.log(`[Notification Lib] Using template '${templateName}' with tracking URL.`);
            break;
        
        case 'confirmed':
            templateName = 'order_confirmation_with_tracking'; // Use the correct template for confirmation
            const orderStatusUrl = `https://servizephyr.com/track/${orderId}`;
            const confirmationParams = [
                 { type: "text", text: customerName },
                 { type: "text", text: orderId.substring(0, 8) },
                 { type: "text", text: restaurantName },
                 { type: "text", text: orderStatusUrl }
            ];
            components.push({ type: "body", parameters: confirmationParams });
            console.log(`[Notification Lib] Using template '${templateName}' for order confirmation.`);
            break;

        case 'delivered':
        case 'rejected':
        case 'ready_for_pickup':
        case 'picked_up':
            templateName = 'order_status_update';
            const statusUpdateParams = [
                { type: "text", text: customerName },
                { type: "text", text: orderId.substring(0, 8) },
                { type: "text", text: restaurantName },
                { type: "text", text: capitalizedStatus },
            ];
            components.push({ type: "body", parameters: statusUpdateParams });
            console.log(`[Notification Lib] Using template '${templateName}' for final status update.`);
            break;
        
        case 'preparing':
            templateName = 'order_status_update';
             const preparingParams = [
                { type: "text", text: customerName },
                { type: "text", text: orderId.substring(0, 8) },
                { type: "text", text: restaurantName },
                { type: "text", text: preparingMessage },
            ];
            components.push({ type: "body", parameters: preparingParams });
            console.log(`[Notification Lib] Using template '${templateName}' for 'preparing' status.`);
            break;

        default:
            console.log(`[Notification Lib] No specific template configured for status: '${status}'. Using default.`);
            templateName = 'order_status_update';
             const defaultParams = [
                { type: "text", text: customerName },
                { type: "text", text: orderId.substring(0, 8) },
                { type: "text", text: restaurantName },
                { type: "text", text: capitalizedStatus },
            ];
            components.push({ type: "body", parameters: defaultParams });
            break;
    }

    const statusPayload = {
        name: templateName,
        language: { code: "en" },
        components: components,
    };
    
    try {
      console.log(`[Notification Lib] Sending status update to customer.`);
      await sendWhatsAppMessage(customerPhoneWithCode, statusPayload, botPhoneNumberId);
      console.log(`[Notification Lib] Status update sent successfully.`);
    } catch(e) {
      console.error("[Notification Lib] CRITICAL: Failed to send WhatsApp status update.", e);
      throw e; // Re-throw to let the caller know it failed
    }
};

export const sendRestaurantStatusChangeNotification = async ({ ownerPhone, botPhoneNumberId, newStatus, restaurantId }) => {
    console.log(`[Notification Lib] Preparing 'status_change_alert' for owner ${ownerPhone}. New status: ${newStatus}`);
    
    if (!ownerPhone || !botPhoneNumberId) {
        console.error(`[Notification Lib] Cannot send status change notification. Owner phone or Bot ID is missing.`);
        return;
    }
    const ownerPhoneWithCode = '91' + ownerPhone;

    const isOpen = newStatus;
    const statusText = isOpen ? "OPEN" : "CLOSED";
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
    
    console.log(`[Notification Lib] Sending 'status_change_alert' template to owner.`);
    await sendWhatsAppMessage(ownerPhoneWithCode, payload, botPhoneNumberId);
    console.log(`[Notification Lib] 'status_change_alert' sent.`);
}
