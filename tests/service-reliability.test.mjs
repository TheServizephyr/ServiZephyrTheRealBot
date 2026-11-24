import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceDeadlineScheduler } from '../src/lib/client/serviceDeadlineScheduler.mjs';
import { createServiceRefreshQueue, fetchServiceJson } from '../src/lib/client/serviceApi.mjs';
import { readBrowserStorage, writeBrowserStorage, removeBrowserStorage } from '../src/lib/client/safeStorage.mjs';
import { createWaitlistMutations } from '../src/lib/client/waitlistMutations.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function clock(refresh) {
    let time = 10000;
    let visible = true;
    const timers = new Map();
    let id = 0;
    const scheduler = createServiceDeadlineScheduler({
        refresh, now: () => time, isVisible: () => visible,
        setTimer: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
        clearTimer: key => timers.delete(key),
    });
    return {
        scheduler,
        hide() { visible = false; },
        show() { visible = true; scheduler.wake(); },
        async advance(ms) {
            time += ms;
            for (const [key, timer] of [...timers]) if (timer.at <= time) { timers.delete(key); timer.fn(); }
            await flush();
        },
    };
}

test('200 already-due guests trigger one maintenance refresh, with no recurring polling', async () => {
    let requests = 0;
    const c = clock(() => { requests += 1; });
    c.scheduler.update(Array.from({ length: 200 }, (_, id) => ({ key: `guest-${id}`, at: 9000 })));
    await flush();
    assert.equal(requests, 1);
    await c.advance(20 * 60000);
    assert.equal(requests, 1);
    c.scheduler.dispose();
});

test('snapshot updates during a slow deadline refresh do not start concurrent requests', async () => {
    let resolve;
    let requests = 0;
    const c = clock(() => { requests += 1; return new Promise(done => { resolve = done; }); });
    c.scheduler.update([{ key: 'a', at: 9000 }]);
    await flush();
    c.scheduler.update([{ key: 'a', at: 9000 }, { key: 'b', at: 9000 }]);
    await flush();
    assert.equal(requests, 1);
    resolve();
    await flush();
    assert.equal(requests, 2);
    resolve();
    await flush();
    c.scheduler.dispose();
});

test('failed known maintenance retries twice with backoff, then stops', async () => {
    let requests = 0;
    const c = clock(() => { requests += 1; return false; });
    c.scheduler.update([{ key: 'guest', at: 9000 }]);
    await flush();
    assert.equal(requests, 1);
    await c.advance(4999);
    assert.equal(requests, 1);
    await c.advance(1);
    assert.equal(requests, 2);
    await c.advance(10000);
    assert.equal(requests, 3);
    await c.advance(20 * 60000);
    assert.equal(requests, 3);
    c.scheduler.dispose();
});

test('hidden pages defer maintenance and resume in one batch', async () => {
    let requests = 0;
    const c = clock(() => { requests += 1; });
    c.hide();
    c.scheduler.update([{ key: 'a', at: 9000 }, { key: 'b', at: 9000 }]);
    await flush();
    assert.equal(requests, 0);
    c.show();
    await flush();
    assert.equal(requests, 1);
    c.scheduler.dispose();
});

test('leaving the dashboard cancels a scheduled deadline refresh', async () => {
    let requests = 0;
    const c = clock(() => { requests += 1; });
    c.scheduler.update([{ key: 'a', at: 15000 }]);
    c.scheduler.dispose();
    await c.advance(20000);
    assert.equal(requests, 0);
});

test('HTML challenge/timeout pages yield an actionable HTTP error, without exposing the HTML', async () => {
    for (const status of [429, 502, 504]) {
        await assert.rejects(fetchServiceJson('/api/owner/waitlist', {}, {
            fetchImpl: async () => new Response('<!DOCTYPE html><body>private upstream page</body>', { status, headers: { 'x-vercel-id': 'test-request' } }),
        }), error => {
            assert.equal(error.code, 'INVALID_RESPONSE');
            assert.equal(error.status, status);
            assert.equal(error.requestId, 'test-request');
            assert.ok(!error.message.includes('DOCTYPE'));
            return true;
        });
    }
});

test('JSON rate-limit responses retain Retry-After and structured location errors', async () => {
    await assert.rejects(fetchServiceJson('/api/public/waitlist/join', {}, {
        fetchImpl: async () => Response.json({ message: 'Please wait', code: 'LOCATION_REQUIRED' }, { status: 429, headers: { 'Retry-After': '60' } }),
    }), error => error.status === 429 && error.retryAfterSec === 60 && error.data.code === 'LOCATION_REQUIRED');
});

test('Vercel checkpoint is identified separately from application rate limits', async () => {
    await assert.rejects(fetchServiceJson('/api/owner/waitlist', {}, {
        fetchImpl: async () => new Response('<!DOCTYPE html>', { status: 429, headers: { 'x-vercel-mitigated': 'challenge', 'x-vercel-id': 'checkpoint-request' } }),
    }), error => error.code === 'SECURITY_CHECK' && error.requestId === 'checkpoint-request' && error.message.includes('Refresh this page'));
});

test('a hanging write times out once and warns to check status before repeating', async () => {
    let calls = 0;
    await assert.rejects(fetchServiceJson('/api/owner/waitlist', { method: 'PATCH' }, {
        timeoutMs: 10,
        fetchImpl: async (_, { signal }) => {
            calls += 1;
            return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        },
    }), error => error.code === 'TIMEOUT' && error.message.includes('may have succeeded'));
    assert.equal(calls, 1);
});

test('overlapping refreshes share one request; mutations queue one fresh follow-up', async () => {
    const resolvers = [];
    let calls = 0;
    const queue = createServiceRefreshQueue(() => { calls += 1; return new Promise(resolve => resolvers.push(resolve)); });
    const first = queue.run();
    const repeats = Array.from({ length: 30 }, () => queue.run());
    const mutations = [queue.run(true), queue.run(true)];
    await flush();
    assert.equal(calls, 1);
    resolvers.shift()('before-mutation');
    await flush();
    assert.equal(calls, 2);
    resolvers.shift()('after-mutation');
    assert.deepEqual(await Promise.all(mutations), ['after-mutation', 'after-mutation']);
    assert.equal(await first, 'before-mutation');
    assert.ok((await Promise.all(repeats)).every(result => result === 'before-mutation'));
});

test('old waitlist reads cannot restore a seated row or hide a newly created token', () => {
    const updates = createWaitlistMutations();
    const seated = { id: 'seated', status: 'arrived' };
    const created = { id: 'created', status: 'pending' };
    const staleReadVersion = updates.version;
    updates.confirm(seated.id);
    updates.confirm(created.id, created);

    assert.deepEqual(updates.reconcile([seated], { readVersion: staleReadVersion }), [created]);
    assert.deepEqual(updates.reconcile([seated]), [created]);

    const arrived = { ...created, status: 'arrived' };
    assert.deepEqual(updates.reconcile([arrived], { fromServer: true }), [arrived]);
    assert.deepEqual(updates.reconcile([seated], { readVersion: staleReadVersion }), [arrived]);
    assert.deepEqual(updates.reconcile([seated, created]), [arrived]);
    assert.deepEqual(updates.reconcile([], { fromServer: true }), []);
});

test('a fresh fallback read reconciles successful writes when realtime is unavailable', () => {
    const updates = createWaitlistMutations();
    const created = { id: 'created', status: 'pending' };
    updates.confirm(created.id, created);
    const readVersion = updates.version;
    const newer = { id: 'newer', status: 'pending' };
    updates.confirm(newer.id, newer);
    assert.deepEqual(updates.reconcile([], { readVersion }), [newer]);
});

test('cached snapshots after an API refresh cannot restore a seated guest', () => {
    const updates = createWaitlistMutations();
    const guest = { id: 'guest', status: 'notified' };
    updates.confirm(guest.id);

    assert.deepEqual(updates.reconcile([], { readVersion: updates.version }), []);
    assert.deepEqual(updates.reconcile([guest]), []);
    assert.deepEqual(updates.reconcile([], { fromServer: true }), []);
    assert.deepEqual(updates.reconcile([guest], { readVersion: 0 }), []);
    assert.deepEqual(updates.reconcile([guest]), []);
    assert.deepEqual(updates.reconcile([guest], { fromServer: true }), []);
});

test('a delayed API result cannot restore a created token that realtime later dropped', () => {
    const updates = createWaitlistMutations();
    const guest = { id: 'guest', status: 'pending' };
    updates.confirm(guest.id, guest);
    const readVersion = updates.version;

    assert.deepEqual(updates.reconcile([guest], { fromServer: true }), [guest]);
    assert.deepEqual(updates.reconcile([], { fromServer: true }), []);
    assert.deepEqual(updates.reconcile([guest], { readVersion }), []);
    assert.deepEqual(updates.reconcile([guest]), []);
});

test('a browser denying the storage property itself cannot crash token rendering', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
        globalThis.window = Object.defineProperty({}, 'localStorage', { get() { throw new Error('Access denied'); } });
        assert.equal(readBrowserStorage('localStorage', 'token'), null);
        assert.doesNotThrow(() => writeBrowserStorage('localStorage', 'token', '{}'));
        assert.doesNotThrow(() => removeBrowserStorage('localStorage', 'token'));
        globalThis.window = { localStorage: { setItem() { throw new Error('Quota exceeded'); } } };
        assert.doesNotThrow(() => writeBrowserStorage('localStorage', 'token', '{}'));
    } finally {
        if (original) Object.defineProperty(globalThis, 'window', original);
        else delete globalThis.window;
    }
});
