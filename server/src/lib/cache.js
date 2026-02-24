const { Redis } = require('@upstash/redis');
const { config } = require('../config/env');
const { logger } = require('./logger');

const memoryStore = new Map();

let redis = null;
if (config.upstash.url && config.upstash.token) {
  redis = new Redis({
    url: config.upstash.url,
    token: config.upstash.token,
  });
}

function getMemory(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function setMemory(key, value, ttlSec) {
  const safeTtlSec = Math.max(1, Number(ttlSec || 1));
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + safeTtlSec * 1000,
  });
}

async function getCache(key) {
  const l1Value = getMemory(key);
  if (l1Value !== null && l1Value !== undefined) {
    return { hit: true, source: 'memory', value: l1Value };
  }

  if (!redis) {
    return { hit: false, source: null, value: null };
  }

  try {
    const redisValue = await redis.get(key);
    if (redisValue === null || redisValue === undefined) {
      return { hit: false, source: null, value: null };
    }
    setMemory(key, redisValue, 10);
    return { hit: true, source: 'redis', value: redisValue };
  } catch (error) {
    logger.warn({ err: error, key }, 'Redis get failed');
    return { hit: false, source: null, value: null };
  }
}

async function setCache(key, value, ttlSec) {
  const safeTtlSec = Math.max(1, Number(ttlSec || 1));
  setMemory(key, value, Math.min(30, safeTtlSec));

  if (!redis) return;
  try {
    await redis.set(key, value, { ex: safeTtlSec });
  } catch (error) {
    logger.warn({ err: error, key }, 'Redis set failed');
  }
}

module.exports = {
  isRedisConfigured: Boolean(redis),
  getCache,
  setCache,
};
