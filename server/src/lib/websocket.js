const { WebSocketServer, WebSocket } = require('ws');
const { config } = require('../config/env');
const { logger } = require('./logger');

let wsServerInstance = null;
const clientSubscriptions = new Map();

function parseInitialChannels(url) {
  const channels = new Set();
  if (!url || typeof url !== 'string') return channels;
  try {
    const parsed = new URL(url, 'http://localhost');
    const directChannel = String(parsed.searchParams.get('channel') || '').trim();
    if (directChannel) channels.add(directChannel);

    const listParam = String(parsed.searchParams.get('channels') || '').trim();
    if (listParam) {
      listParam
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .forEach((value) => channels.add(value));
    }

    const restaurantId = String(parsed.searchParams.get('restaurantId') || '').trim();
    if (restaurantId) channels.add(`owner:${restaurantId}`);

    const riderId = String(parsed.searchParams.get('riderId') || '').trim();
    if (riderId) channels.add(`rider:${riderId}`);

    const orderId = String(parsed.searchParams.get('orderId') || '').trim();
    if (orderId) channels.add(`order:${orderId}`);
  } catch {
    // Ignore malformed URL.
  }
  return channels;
}

function getSocketChannels(socket) {
  if (!clientSubscriptions.has(socket)) {
    clientSubscriptions.set(socket, new Set());
  }
  return clientSubscriptions.get(socket);
}

function subscribeSocket(socket, channels = []) {
  const target = getSocketChannels(socket);
  channels.forEach((channel) => {
    const safe = String(channel || '').trim();
    if (safe) target.add(safe);
  });
  return target.size;
}

function unsubscribeSocket(socket, channels = []) {
  const target = getSocketChannels(socket);
  channels.forEach((channel) => {
    const safe = String(channel || '').trim();
    if (safe) target.delete(safe);
  });
  return target.size;
}

function socketMatchesChannels(socket, requiredChannels = []) {
  if (!requiredChannels.length) return true;
  const subscribed = clientSubscriptions.get(socket);
  if (!subscribed || subscribed.size === 0) return false;
  return requiredChannels.some((channel) => subscribed.has(channel));
}

function publishWebsocketEvent(event = {}) {
  if (!wsServerInstance) return { delivered: 0 };
  const type = String(event.type || 'event').trim();
  const payload = event.payload !== undefined ? event.payload : null;
  const channels = Array.isArray(event.channels)
    ? event.channels.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  const serialized = JSON.stringify({
    type,
    channels,
    payload,
    at: new Date().toISOString(),
  });

  let delivered = 0;
  wsServerInstance.clients.forEach((socket) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!socketMatchesChannels(socket, channels)) return;
    try {
      socket.send(serialized);
      delivered += 1;
    } catch {
      // Ignore send failures; socket close will be handled by ws.
    }
  });
  return { delivered };
}

function attachWebSocket(httpServer) {
  if (!config.websocket.enabled) return null;

  const wss = new WebSocketServer({
    server: httpServer,
    path: config.websocket.path,
  });

  wss.on('connection', (socket, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const initialChannels = parseInitialChannels(req.url);
    if (initialChannels.size > 0) {
      subscribeSocket(socket, Array.from(initialChannels));
    }
    logger.info({ clientIp }, 'WS client connected');

    socket.send(JSON.stringify({
      type: 'welcome',
      message: 'ServiZephyr WS connected',
      channels: Array.from(getSocketChannels(socket)),
      at: new Date().toISOString(),
    }));

    socket.on('message', (raw) => {
      try {
        const text = raw.toString();
        if (text === 'ping') {
          socket.send('pong');
          return;
        }

        const parsed = JSON.parse(text);
        const messageType = String(parsed?.type || '').trim().toLowerCase();
        const channels = Array.isArray(parsed?.channels) ? parsed.channels : [];

        if (messageType === 'subscribe') {
          const total = subscribeSocket(socket, channels);
          socket.send(JSON.stringify({
            type: 'subscribed',
            channels: Array.from(getSocketChannels(socket)),
            total,
          }));
          return;
        }

        if (messageType === 'unsubscribe') {
          const total = unsubscribeSocket(socket, channels);
          socket.send(JSON.stringify({
            type: 'unsubscribed',
            channels: Array.from(getSocketChannels(socket)),
            total,
          }));
          return;
        }
      } catch {
        // Ignore malformed frames.
      }
    });

    socket.on('close', () => {
      clientSubscriptions.delete(socket);
      logger.info({ clientIp }, 'WS client disconnected');
    });
  });

  wsServerInstance = wss;
  logger.info({ path: config.websocket.path }, 'WebSocket server enabled');
  return wss;
}

module.exports = {
  attachWebSocket,
  publishWebsocketEvent,
};
