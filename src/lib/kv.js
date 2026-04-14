import { kv as vercelKv } from '@vercel/kv';
import { Redis } from '@upstash/redis';

const DEFAULT_FAILOVER_COOLDOWN_MS = 5 * 60 * 1000;
const PRIMARY_URL = String(process.env.KV_REST_API_URL || '').trim();
const PRIMARY_TOKEN = String(process.env.KV_REST_API_TOKEN || '').trim();
const SECONDARY_URL = String(process.env.KV_SECONDARY_REST_URL || '').trim();
const SECONDARY_TOKEN = String(process.env.KV_SECONDARY_REST_TOKEN || '').trim();
const FAILOVER_COOLDOWN_MS = Number(process.env.KV_FAILOVER_COOLDOWN_MS || DEFAULT_FAILOVER_COOLDOWN_MS);

const READ_WRITE_METHODS = new Set(['set', 'del', 'incr', 'expire', 'hincrby', 'lpush', 'ltrim']);
const READ_ONLY_METHODS = new Set(['get', 'hgetall', 'lrange']);
const VALID_ROUTING_MODES = new Set(['primary-first', 'secondary-first', 'primary-only', 'secondary-only']);

const STATE = globalThis.__servizephyrKvRoutingState || {
    forceTarget: '',
    forceUntil: 0,
    lastWarningAt: 0,
    lastErrorByTarget: {
        primary: '',
        secondary: '',
    },
};

globalThis.__servizephyrKvRoutingState = STATE;

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

function getClient(target) {
    if (target === 'primary') return isPrimaryConfigured() ? vercelKv : null;
    if (target === 'secondary') return getSecondaryClient();
    return null;
}

function parseBooleanEnv(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
}

function getDefaultRoutingMode() {
    if (isSecondaryConfigured()) return 'secondary-first';
    return 'primary-first';
}

function getRoutingMode() {
    const rawMode = String(process.env.KV_ROUTING_MODE || '').trim().toLowerCase();
    if (VALID_ROUTING_MODES.has(rawMode)) return rawMode;
    return getDefaultRoutingMode();
}

function shouldMirrorWrites() {
    return parseBooleanEnv(process.env.KV_MIRROR_WRITES, false);
}

function shouldUseForcedTarget() {
    return Boolean(STATE.forceTarget) && Date.now() < STATE.forceUntil;
}

function logRoutingWarning(message, error = null) {
    const now = Date.now();
    if (now - STATE.lastWarningAt < 30 * 1000) return;
    STATE.lastWarningAt = now;
    console.warn('[kv-routing]', message, error?.message || error || '');
}

function markTargetFailure(failedTarget, fallbackTarget, error) {
    STATE.lastErrorByTarget[failedTarget] = String(error?.message || error || `${failedTarget}_failed`);
    if (!fallbackTarget) return;
    STATE.forceTarget = fallbackTarget;
    STATE.forceUntil = Date.now() + (Number.isFinite(FAILOVER_COOLDOWN_MS) && FAILOVER_COOLDOWN_MS > 0
        ? FAILOVER_COOLDOWN_MS
        : DEFAULT_FAILOVER_COOLDOWN_MS);
    logRoutingWarning(
        `KV ${failedTarget} failed. Routing traffic to ${fallbackTarget} until ${new Date(STATE.forceUntil).toISOString()}.`,
        error
    );
}

async function runCommand(target, method, args) {
    const client = getClient(target);
    if (!client || typeof client[method] !== 'function') {
        throw new Error(`KV ${target} client does not support method: ${method}`);
    }
    return client[method](...args);
}

function getPreferredTarget() {
    const mode = getRoutingMode();
    if (mode === 'secondary-first' || mode === 'secondary-only') return 'secondary';
    return 'primary';
}

function getOrderedTargets(method) {
    const mode = getRoutingMode();
    const isWrite = READ_WRITE_METHODS.has(method);
    const isRead = READ_ONLY_METHODS.has(method);

    if (!isWrite && !isRead) {
        throw new Error(`Unsupported KV method: ${method}`);
    }

    let orderedTargets;
    switch (mode) {
        case 'secondary-only':
            orderedTargets = ['secondary'];
            break;
        case 'primary-only':
            orderedTargets = ['primary'];
            break;
        case 'secondary-first':
            orderedTargets = ['secondary', 'primary'];
            break;
        case 'primary-first':
        default:
            orderedTargets = ['primary', 'secondary'];
            break;
    }

    const availableTargets = orderedTargets.filter((target) => Boolean(getClient(target)));
    if (availableTargets.length === 0) {
        throw new Error('KV is not configured.');
    }

    if (shouldUseForcedTarget()) {
        const forcedTarget = STATE.forceTarget;
        if (availableTargets.includes(forcedTarget)) {
            return [forcedTarget, ...availableTargets.filter((target) => target !== forcedTarget)];
        }
    }

    return availableTargets;
}

async function mirrorWrite(method, args, successfulTarget) {
    if (!READ_WRITE_METHODS.has(method) || !shouldMirrorWrites()) return;

    const mirrorTargets = ['primary', 'secondary']
        .filter((target) => target !== successfulTarget)
        .filter((target) => Boolean(getClient(target)));

    if (!mirrorTargets.length) return;

    const results = await Promise.allSettled(
        mirrorTargets.map((target) => runCommand(target, method, args))
    );

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const failedTarget = mirrorTargets[index];
            logRoutingWarning(`KV mirror write to ${failedTarget} failed for ${method}.`, result.reason);
        }
    });
}

async function execute(method, args) {
    const targets = getOrderedTargets(method);
    let lastError = null;

    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const fallbackTarget = targets[index + 1] || '';

        try {
            const result = await runCommand(target, method, args);
            if (STATE.forceTarget === target) {
                STATE.forceTarget = '';
                STATE.forceUntil = 0;
            }
            await mirrorWrite(method, args, target);
            return result;
        } catch (error) {
            lastError = error;
            markTargetFailure(target, fallbackTarget, error);
        }
    }

    throw lastError || new Error(`KV ${method} failed.`);
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
    const forceSecondaryUntil = STATE.forceTarget === 'secondary' ? STATE.forceUntil : 0;
    return {
        enabled: isKvConfigured(),
        routingMode: getRoutingMode(),
        mirrorWrites: shouldMirrorWrites(),
        preferredTarget: getPreferredTarget(),
        forceTarget: STATE.forceTarget,
        forceUntil: STATE.forceUntil,
        forceSecondaryUntil,
        lastPrimaryError: STATE.lastErrorByTarget.primary,
        lastSecondaryError: STATE.lastErrorByTarget.secondary,
        cooldownMs: FAILOVER_COOLDOWN_MS,
    };
}
