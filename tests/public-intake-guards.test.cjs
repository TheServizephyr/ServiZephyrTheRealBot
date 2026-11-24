const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const swc = require('next/dist/build/swc');

// Execute actual route/limiter code with isolated server memory and mocked I/O.
// No network, credentials, production Firestore, Redis writes or fake bookings.
const compiled = new Map();
async function load(relativePath, dependencies) {
    if (!compiled.has(relativePath)) {
        const filename = path.join(__dirname, '..', relativePath);
        compiled.set(relativePath, (await swc.transform(fs.readFileSync(filename, 'utf8'), {
            filename, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' },
        })).code);
    }
    const compiledModule = { exports: {} };
    const context = vm.createContext({
        module: compiledModule, exports: compiledModule.exports, Buffer, URL, Date: class extends Date { static now() { return Date.parse('2026-11-02T12:00:00Z'); } },
        console: { log() {}, warn() {}, error() {} }, process: { env: {} },
        require(name) {
            if (Object.hasOwn(dependencies, name)) return dependencies[name];
            if (name === 'crypto' || name === 'libphonenumber-js') return require(name);
            throw new Error(`Unexpected dependency: ${name}`);
        },
    });
    new vm.Script(compiled.get(relativePath), { filename: relativePath }).runInContext(context);
    return compiledModule.exports;
}

function request(body, index = 0) {
    return {
        url: 'https://example.test/api/owner/bookings',
        headers: { get: name => name === 'x-forwarded-for' ? `198.51.100.${index % 20 + 1}` : '' },
        json: async () => body,
    };
}

async function route(relativePath, business, rateResult = { allowed: true }, waitlistWrites) {
    let reads = 0;
    const restaurantRef = {
        get: async () => { reads += 1; return { exists: true, data: () => business }; },
        collection: name => ({ doc: (id = 'new-token') => ({
            id,
            path: `${name}/${id}`,
            get: async () => ({ exists: false }),
        }) }),
    };
    const firestore = {
        collection(name) {
            assert.equal(name, 'restaurants');
            return { doc(id) {
                assert.equal(id, 'pizzeria-vatika-cafe');
                return restaurantRef;
            } };
        },
        runTransaction: callback => callback({
            getAll: (...refs) => Promise.all(refs.map(ref => ref.get())),
            set: (ref, value) => {
                if (!waitlistWrites) assert.fail('Unexpected transaction write');
                waitlistWrites.push({ path: ref.path || 'restaurant', value });
            },
        }),
    };
    const loaded = await load(relativePath, {
        'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
        '@/lib/firebase-admin': {
            getFirestore: async () => firestore,
            getAuth: async () => ({}),
            verifyAndGetUid: async () => { throw { status: 401, message: 'No authentication' }; },
            FieldValue: { serverTimestamp: () => '2026-11-02T12:00:00Z' },
        },
        '@/lib/server/proximityVerification': { verifyPublicIntakeProximity: () => { throw new Error('Unexpected proximity call'); } },
        '@/lib/server/publicIntakeRateLimit': { enforcePublicIntakeRateLimit: async () => rateResult, enforcePublicWaitlistReadLimit: async () => rateResult },
        '@/lib/public-auth': { enforceRateLimit: async () => ({ allowed: true }) },
        '@/lib/bookingReads.mjs': {},
    });
    return { loaded, reads: () => reads };
}

const booking = { restaurantId: 'pizzeria-vatika-cafe', name: 'LOCAL TEST ONLY', phone: '9000000000', guests: 2, bookingDateTime: '2030-01-01T12:00:00Z' };

test('disabled public bookings reject a valid-shaped submission before any write', async () => {
    const { loaded, reads } = await route('src/app/api/owner/bookings/route.js', { businessType: 'restaurant', isBookingEnabled: false });
    const response = await loaded.POST(request(booking));
    assert.equal(response.status, 403);
    assert.match(response.body.message, /disabled/);
    assert.equal(reads(), 1);
});

test('disabled public waitlist rejects a valid-shaped submission before any write', async () => {
    const { loaded, reads } = await route('src/app/api/public/waitlist/join/route.js', { businessType: 'restaurant', isOpen: true, isWaitlistEnabled: false });
    const response = await loaded.POST(request({ ...booking, paxCount: 2 }));
    assert.equal(response.status, 403);
    assert.match(response.body.message, /disabled/);
    assert.equal(reads(), 1);
});

test('a public QR token uses one outlet read and saves its phone lock with the entry', async () => {
    const writes = [];
    const { loaded, reads } = await route('src/app/api/public/waitlist/join/route.js',
        { isWaitlistEnabled: true }, { allowed: true }, writes);
    const response = await loaded.POST(request({ ...booking, paxCount: 2 }));
    assert.equal(response.status, 201);
    assert.equal(reads(), 1);
    assert.equal(response.body.entryId, 'new-token');
    assert.match(response.body.waitlistToken, /^#00[A-Z]{2}$/);
    assert.equal(writes.find(write => write.path === 'waitlist/new-token').value.arrivalCode, response.body.arrivalCode);
    assert.equal(writes.find(write => write.path === 'restaurant').value.waitlistTokenCounter, 1);
    assert.equal(writes.find(write => write.path === 'waitlist_active_phone/9000000000').value.entryId, 'new-token');
});

test('QR form service status checks the business without loading its menu or orders', async () => {
    let profileReads = 0;
    const { getPublicRestaurantServiceStatus } = await load('src/services/business/publicRestaurantOverview.service.js', {
        '@/lib/businessSchedule': { getEffectiveBusinessOpenStatus: () => true },
        '@/services/business/businessService': { findBusinessById: async (_firestore, id, options) => {
            assert.equal(id, 'vatika');
            assert.equal(options.includeDeliverySettings, false);
            profileReads += 1;
            return { data: { isWaitlistEnabled: true, waitlistLocationVerificationEnabled: true, waitlistExpectedWaitMinutes: 15 } };
        } },
    });
    const status = await getPublicRestaurantServiceStatus({}, 'vatika');
    assert.equal(profileReads, 1);
    assert.equal(status.restaurant.services.waitlist, true);
    assert.equal(status.restaurant.services.waitlistLocationVerification, true);
    assert.equal(status.restaurant.waitlistExpectedWaitMinutes, 15);
});

test('claiming manual_quick_add does not skip owner authentication', async () => {
    const { loaded } = await route('src/app/api/owner/bookings/route.js', { businessType: 'restaurant', isBookingEnabled: true });
    const response = await loaded.POST(request({ ...booking, source: 'manual_quick_add' }));
    assert.equal(response.status, 401, JSON.stringify(response.body));
});

async function limiterInstance(kv, configured = true) {
    const auth = await load('src/lib/public-auth.js', {
        nanoid: { nanoid: () => 'unused-test-id' }, '@/lib/firebase-admin': {},
        '@/lib/kv': { kv, isKvConfigured: () => configured }, '@/lib/guest-utils': {},
        '@/lib/security/security-events': { logSecurityEvent: async () => {}, recordSecurityAnomaly: async () => {}, SECURITY_EVENT_TYPES: {} },
    });
    const handlers = await load('src/lib/server/publicIntakeRateLimit.js', { '@/lib/public-auth': auth });
    return Object.assign(handlers.enforcePublicIntakeRateLimit, { readLimit: handlers.enforcePublicWaitlistReadLimit });
}

async function sendAcrossInstances(instances) {
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
        const result = await instances[i % instances.length]({ firestore: null, req: request({}, i), channel: 'booking-create', restaurantId: 'pizzeria-vatika-cafe', phone: `test-${i}`, restaurantLimit: 80 });
        if (result.allowed) allowed += 1;
    }
    return allowed;
}

test('healthy shared Redis enforces one outlet limit across two server instances', async () => {
    const values = new Map();
    const kv = { incr: async key => { const next = (values.get(key) || 0) + 1; values.set(key, next); return next; }, expire: async () => 1 };
    assert.equal(await sendAcrossInstances([await limiterInstance(kv), await limiterInstance(kv)]), 80);
});

test('Redis failure rejects public creation across all instances instead of falling back to memory', async () => {
    const kv = { incr: async () => { throw new Error('Simulated Redis outage'); } };
    assert.equal(await sendAcrossInstances([await limiterInstance(kv), await limiterInstance(kv)]), 0);
});

test('missing shared rate-limit configuration returns retryable 503 instead of accepting intake', async () => {
    const limit = await limiterInstance({}, false);
    const result = await limit({ req: request({}), channel: 'waitlist-join', restaurantId: 'pizzeria-vatika-cafe', phone: 'test' });
    assert.equal(result.allowed, false);
    assert.equal(result.status, 503);
});

test('waitlist history without explicit dates queries only Today, with no unfiltered fallback', async () => {
    const { getHistoryReadRange } = await import('../src/lib/historyDates.mjs');
    const bounds = [];
    function query(filters = []) {
        return {
            where: (field, op, value) => query([...filters, { field, op, value }]),
            orderBy: () => query(filters),
            get: async () => { bounds.push(filters); return { docs: [] }; },
        };
    }
    const loaded = await load('src/app/api/owner/waitlist/route.js', {
        'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
        '@/lib/firebase-admin': { getFirestore: async () => ({}) },
        '@/lib/verify-owner-with-audit': { verifyOwnerWithAudit: async () => ({ uid: 'owner', callerRole: 'owner', collectionName: 'restaurants', businessId: 'vatika', businessSnap: { data: () => ({}), ref: { collection: () => query() } } }) },
        '@/lib/permissions': { PERMISSIONS: {} },
        '@/lib/historyDates.mjs': { getHistoryReadRange: params => getHistoryReadRange(params, new Date('2026-11-02T12:00:00Z')) },
        '@/lib/waitlistReads.mjs': await import('../src/lib/waitlistReads.mjs'),
        '@/lib/public-auth': { enforceRateLimit: async () => ({ allowed: true }) },
    });
    const req = request({});
    req.url = 'https://example.test/api/owner/waitlist?history=true';
    assert.equal((await loaded.GET(req)).status, 200);
    assert.equal(bounds.length, 6);
    for (const filters of bounds) {
        assert.equal(filters.length, 2);
        assert.equal(filters[0].op, '>=');
        assert.equal(filters[0].value.toISOString(), '2026-11-01T18:30:00.000Z');
        assert.equal(filters[1].op, '<');
        assert.equal(filters[1].value.toISOString(), '2026-11-02T18:30:00.000Z');
    }
});

async function loadOwnerWaitlistForSeating({ previouslyNotified = false, failPromotion = false } = {}) {
    const phone = '9000000000';
    const initial = { status: 'pending', phone, menuWishlistClearedAt: true };
    let entry = { ...initial, status: failPromotion ? 'notified' : initial.status };
    let lock = { entryId: 'guest' };
    let writes = 0;
    const entryRef = { id: 'guest' };
    const lockRef = { id: phone };
    const entrySnap = () => ({ id: 'guest', ref: entryRef, exists: true, data: () => entry });
    function query(collection, filters = []) {
        return {
            doc: id => {
                if (collection === 'waitlist' && id === entryRef.id) return entryRef;
                if (collection === 'waitlist_active_phone' && id === lockRef.id) return lockRef;
                assert.fail(`Unexpected document ${collection}/${id}`);
            },
            where: (...clause) => query(collection, [...filters, clause]),
            limit: () => query(collection, filters),
            get: async () => ({
                docs: previouslyNotified && collection === 'waitlist' && filters[0]?.join(':') === 'status:==:notified'
                    ? [{ id: entryRef.id, ref: entryRef, data: () => ({
                        ...initial, status: 'notified', noShowDeadlineAt: '2026-11-02T11:58:00Z',
                    }) }]
                    : [],
            }),
        };
    }
    const firestore = {
        runTransaction: callback => callback({
            get: async ref => {
                if (ref === entryRef) return entrySnap();
                if (failPromotion && ref !== lockRef) throw new Error('Promotion query unavailable');
                assert.equal(ref, lockRef);
                return { exists: Boolean(lock), data: () => lock };
            },
            getAll: async (...refs) => {
                assert.equal(refs.length, 1);
                assert.equal(refs[0], entryRef);
                return [entrySnap()];
            },
            update: (ref, fields) => { assert.equal(ref, entryRef); entry = { ...entry, ...fields }; writes += 1; },
            delete: ref => { assert.equal(ref, lockRef); lock = null; writes += 1; },
        }),
    };
    const route = await load('src/app/api/owner/waitlist/route.js', {
        'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
        '@/lib/firebase-admin': { getFirestore: async () => firestore, FieldValue: { serverTimestamp: () => '2026-11-02T12:00:00Z' } },
        '@/lib/verify-owner-with-audit': { verifyOwnerWithAudit: async () => ({
            uid: 'owner', collectionName: 'restaurants', businessId: 'vatika',
            businessSnap: { data: () => ({}), ref: { collection: query } },
        }) },
        '@/lib/permissions': { PERMISSIONS: {} },
        '@/lib/historyDates.mjs': {},
        '@/lib/waitlistReads.mjs': await import('../src/lib/waitlistReads.mjs'),
        '@/lib/public-auth': { enforceRateLimit: async () => ({ allowed: true }) },
    });
    return { route, entry: () => entry, writes: () => writes };
}

test('manual seating saves once and a stale status action cannot reopen the entry', async () => {
    const { route, entry, writes } = await loadOwnerWaitlistForSeating();
    const seat = () => route.PATCH(request({ entryId: 'guest', status: 'seated' }));
    assert.equal((await seat()).status, 200);
    assert.equal(entry().status, 'seated');
    assert.equal(writes(), 2);
    assert.equal((await seat()).status, 200);
    assert.equal((await route.PATCH(request({ entryId: 'guest', status: 'arrived' }))).status, 409);
    assert.equal(writes(), 2);
});

test('successful manual seating reports a manual follow-up when promotion fails', async () => {
    const { route, entry, writes } = await loadOwnerWaitlistForSeating({ failPromotion: true });
    const response = await route.PATCH(request({ entryId: 'guest', status: 'seated' }));
    assert.equal(response.status, 200);
    assert.equal(entry().status, 'seated');
    assert.equal(writes(), 2);
    assert.equal(response.body.promotedEntryId, null);
    assert.match(response.body.warning, /notify the next guest manually/);
});

test('no-show maintenance cannot overwrite a seating committed after its first read', async () => {
    const { route, entry, writes } = await loadOwnerWaitlistForSeating({ previouslyNotified: true });
    assert.equal((await route.PATCH(request({ entryId: 'guest', status: 'seated' }))).status, 200);
    const response = await route.GET(request({}));
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.autoExpiredCount, 0);
    assert.equal(entry().status, 'seated');
    assert.equal(writes(), 2);
});

test('public booking and waitlist limits reject before any Firestore read', async () => {
    for (const [file, body] of [
        ['src/app/api/owner/bookings/route.js', booking],
        ['src/app/api/public/waitlist/join/route.js', { ...booking, paxCount: 2 }],
        ['src/app/api/public/waitlist/arrive/route.js', { restaurantId: 'pizzeria-vatika-cafe', entryId: 'test', arrivalCode: 'test' }],
    ]) {
        for (const status of [429, 503]) {
            const { loaded, reads } = await route(file, {}, { allowed: false, status, retryAfterSec: 60 });
            const response = await loaded.POST(request(body));
            assert.equal(response.status, status);
            assert.equal(reads(), 0);
        }
    }
});

test('tracking requests are rate-limited before Firestore reads', async () => {
    const { loaded, reads } = await route('src/app/api/public/waitlist/status/route.js', {}, { allowed: false, status: 429, retryAfterSec: 60 });
    const req = request({});
    req.url = 'https://example.test/api/public/waitlist/status?restaurantId=pizzeria-vatika-cafe&entryId=test&arrivalCode=test';
    assert.equal((await loaded.GET(req)).status, 429);
    assert.equal(reads(), 0);
});

test('shared public intake rejects the fourth repeat of the same phone', async () => {
    const values = new Map();
    const kv = { incr: async key => { const next = (values.get(key) || 0) + 1; values.set(key, next); return next; }, expire: async () => 1 };
    const limit = await limiterInstance(kv);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limit({ req: request({}, i), channel: 'waitlist-join', restaurantId: 'pizzeria-vatika-cafe', phone: 'same-phone' }));
    assert.deepEqual(results.map(result => result.allowed), [true, true, true, false]);
});

test('shared public intake enforces per-restaurant IP and cross-restaurant IP ceilings', async () => {
    for (const rotateRestaurant of [false, true]) {
        const values = new Map();
        const kv = { incr: async key => { const next = (values.get(key) || 0) + 1; values.set(key, next); return next; }, expire: async () => 1 };
        const limit = await limiterInstance(kv);
        const ceiling = rotateRestaurant ? 30 : 12;
        for (let i = 0; i <= ceiling; i++) {
            const result = await limit({ req: request({}), channel: 'booking-create', restaurantId: rotateRestaurant ? `outlet-${i}` : 'vatika', phone: `phone-${i}` });
            assert.equal(result.allowed, i < ceiling);
        }
    }
});

test('public waitlist tracking and token verification have shared per-entry ceilings', async () => {
    for (const [channel, ceiling] of [['status', 60], ['arrive', 12]]) {
        const values = new Map();
        const kv = { incr: async key => { const next = (values.get(key) || 0) + 1; values.set(key, next); return next; }, expire: async () => 1 };
        const limit = await limiterInstance(kv);
        for (let i = 0; i <= ceiling; i++) {
            const result = await limit.readLimit({ req: request({}, i), channel, restaurantId: 'vatika', entryId: 'entry' });
            assert.equal(result.allowed, i < ceiling);
        }
    }
});
