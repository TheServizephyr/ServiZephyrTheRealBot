const { publishWebsocketEvent } = require('../lib/websocket');

function safeStr(value) {
  return String(value || '').trim();
}

function buildChannels({ businessId, riderId, orderId }) {
  const channels = [];
  const safeBusinessId = safeStr(businessId);
  const safeRiderId = safeStr(riderId);
  const safeOrderId = safeStr(orderId);
  if (safeBusinessId) channels.push(`owner:${safeBusinessId}`);
  if (safeRiderId) channels.push(`rider:${safeRiderId}`);
  if (safeOrderId) channels.push(`order:${safeOrderId}`);
  return channels;
}

function emitOrderEvent({
  eventType = 'order.updated',
  businessId = '',
  riderId = '',
  orderId = '',
  data = {},
}) {
  const channels = buildChannels({ businessId, riderId, orderId });
  return publishWebsocketEvent({
    type: eventType,
    channels,
    payload: {
      orderId: safeStr(orderId) || null,
      businessId: safeStr(businessId) || null,
      riderId: safeStr(riderId) || null,
      ...data,
    },
  });
}

module.exports = {
  emitOrderEvent,
};
