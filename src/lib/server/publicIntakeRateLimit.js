import crypto from 'crypto';

import { enforceRateLimit } from '@/lib/public-auth';

// Public restaurant traffic frequently comes through carrier-grade NAT or venue
// Wi-Fi, where many genuine guests share one public IP. Keep this short enough
// to contain a burst, without treating a normal dinner rush as an attack.
const WINDOW_SEC = 60;

function getClientIp(req) {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

function hash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
}

/**
 * Limits public, state-changing restaurant intake endpoints at three independent
 * scopes. The keys deliberately avoid storing a customer's raw phone number.
 *
 * This is backed by KV when configured, so it is shared across Vercel instances.
 */
export async function enforcePublicIntakeRateLimit({
    firestore,
    req,
    channel,
    restaurantId,
    phone,
    restaurantLimit = 80,
}) {
    const safeChannel = String(channel || 'public-intake').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
    const safeRestaurantId = String(restaurantId || '').trim().slice(0, 160);
    const ipHash = hash(getClientIp(req));
    const phoneHash = hash(phone);
    // A versioned namespace also releases guests who were caught by the former
    // emergency 10-minute limits as soon as this safer policy is deployed.
    const base = `public-intake:v2:${safeChannel}`;

    const checks = await Promise.all([
        // Stops a single origin from spraying restaurant IDs or phone numbers.
        enforceRateLimit(firestore, {
            bucket: 'public_intake_limits',
            key: `${base}:ip:${ipHash}`,
            limit: 30,
            windowSec: WINDOW_SEC,
            req,
            auditContext: `${safeChannel}_ip_limit`,
        }),
        // Stops rapid retries against one restaurant from the same origin.
        enforceRateLimit(firestore, {
            bucket: 'public_intake_limits',
            key: `${base}:restaurant-ip:${safeRestaurantId}:${ipHash}`,
            limit: 12,
            windowSec: WINDOW_SEC,
            req,
            auditContext: `${safeChannel}_restaurant_ip_limit`,
        }),
        // Allow a short retry window for slow mobile networks. The endpoint's
        // duplicate protection remains the final guard against duplicate records.
        enforceRateLimit(firestore, {
            bucket: 'public_intake_limits',
            key: `${base}:restaurant-phone:${safeRestaurantId}:${phoneHash}`,
            limit: 3,
            windowSec: WINDOW_SEC,
            req,
            auditContext: `${safeChannel}_phone_limit`,
        }),
        // Contains distributed-IP floods aimed at a single restaurant.
        enforceRateLimit(firestore, {
            bucket: 'public_intake_limits',
            key: `${base}:restaurant:${safeRestaurantId}`,
            limit: restaurantLimit,
            windowSec: WINDOW_SEC,
            req,
            auditContext: `${safeChannel}_restaurant_limit`,
        }),
    ]);

    const denied = checks.find((check) => !check.allowed);
    return {
        allowed: !denied,
        retryAfterSec: denied?.retryAfterSec || WINDOW_SEC,
    };
}
