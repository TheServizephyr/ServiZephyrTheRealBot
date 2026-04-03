import { kv as vercelKv } from '@vercel/kv';
import { Redis } from '@upstash/redis';

const DEFAULT_FAILOVER_COOLDOWN_MS = 5 * 60 * 1000;
const PRIMARY_URL = String(process.env.KV_REST_API_URL || '').trim();
const PRIMARY_TOKEN = String(process.env.KV_REST_API_TOKEN || '').trim();
const SECONDARY_URL = String(process.env.KV_SECONDARY_REST_URL || '').trim();
const SECONDARY_TOKEN = String(process.env.KV_SECONDARY_REST_TOKEN || '').trim();
const FAILOVER_COOLDOWN_MS = Number(process.env.KV_FAILOVER_COOLDOWN_MS || DEFAULT_FAILOVER_COOLDOWN_MS);

const STATE = globalThis.__servizephyrKvFailoverState || {
    forceSecondaryUntil: 0,
    lastWarningAt: 0,
    lastPrimaryError: '',
};

globalThis.__servizephyrKvFailoverState = STATE;

let secondaryClient = null;

function isPrimaryConfigured() {
    return Boolean(PRIMARY_URL && PRIMARY_TOKEN);
}

function isSecondaryConfigured() {
    return Boolean(SECONDARY_URL && SECONDARY_TOKEN);
}

function getSecondaryClient() {
    if (!isSecondaryConfigured()) return null;
    if (!secondaryClient) {
        secondaryClient = new Redis({
            url: SECONDARY_URL,
            token: SECONDARY_TOKEN,
        });
    }
    return secondaryClient;
}

function shouldUseSecondaryNow() {
    return isSecondaryConfigured() && Date.now() < STATE.forceSecondaryUntil;
}

function logFailover(message, error = null) {
    const now = Date.now();
    if (now - STATE.lastWarningAt < 30 * 1000) return;
    STATE.lastWarningAt = now;
    console.warn('[kv-failover]', message, error?.message || error || '');
}

function markPrimaryFailure(error) {
    STATE.lastPrimaryError = String(error?.message || error || 'primary_failed');
    STATE.forceSecondaryUntil = Date.now() + (Number.isFinite(FAILOVER_COOLDOWN_MS) && FAILOVER_COOLDOWN_MS > 0
        ? FAILOVER_COOLDOWN_MS
        : DEFAULT_FAILOVER_COOLDOWN_MS);
    logFailover(`Primary Vercel KV failed. Routing traffic to secondary Upstash until ${new Date(STATE.forceSecondaryUntil).toISOString()}.`, error);
}

async function runCommand(client, method, args) {
    if (!client || typeof client[method] !== 'function') {
        throw new Error(`KV method not supported: ${method}`);
    }
    return client[method](...args);
}

async function execute(method, args) {
    const secondary = getSecondaryClient();

    if (shouldUseSecondaryNow()) {
        return runCommand(secondary, method, args);
    }

    if (!isPrimaryConfigured()) {
        if (!secondary) {
            throw new Error('KV is not configured.');
        }
        markPrimaryFailure(new Error('Primary Vercel KV is not configured.'));
        return runCommand(secondary, method, args);
    }

    try {
        return await runCommand(vercelKv, method, args);
    } catch (primaryError) {
        if (!secondary) {
            throw primaryError;
        }
        markPrimaryFailure(primaryError);
        return runCommand(secondary, method, args);
    }
}

export const kv = {
    get: (...args) => execute('get', args),
    set: (...args) => execute('set', args),
    del: (...args) => execute('del', args),
    incr: (...args) => execute('incr', args),
    expire: (...args) => execute('expire', args),
    hgetall: (...args) => execute('hgetall', args),
    hincrby: (...args) => execute('hincrby', args),
    lrange: (...args) => execute('lrange', args),
    lpush: (...args) => execute('lpush', args),
    ltrim: (...args) => execute('ltrim', args),
};

export function isSecondaryKvConfigured() {
    return isSecondaryConfigured();
}

export function isKvConfigured() {
    return isPrimaryConfigured() || isSecondaryConfigured();
}

export function getKvFailoverState() {
    return {
        enabled: isKvConfigured(),
        forceSecondaryUntil: STATE.forceSecondaryUntil,
        lastPrimaryError: STATE.lastPrimaryError,
        cooldownMs: FAILOVER_COOLDOWN_MS,
    };
}
