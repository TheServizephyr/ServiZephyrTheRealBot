import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceHistory, invalidateServiceHistory, serviceHistoryScope } from '../src/lib/client/serviceHistoryCache.mjs';
import { getHistoryReadRange, getIndiaDateKey } from '../src/lib/historyDates.mjs';
import { waitlistDeadlines, bookingBridgeDeadlines } from '../src/lib/client/serviceDeadlines.mjs';
import { buildLiveWaitlistQueries } from '../src/lib/waitlistReads.mjs';

class Storage {
    values = new Map();
    get length() { return this.values.size; }
    key(i) { return [...this.values.keys()][i] || null; }
    getItem(key) { return this.values.get(key) || null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
}
const now = Date.parse('2026-11-02T10:00:00Z');
const defaults = () => ({ scope: serviceHistoryScope('owner', 'vatika'), channel: 'waitlist', startDate: '2026-11-02', endDate: '2026-11-02', storage: new Storage(), now });

test('reopening the same history range and exporting reuse localStorage without another fetch', async () => {
    let requests = 0;
    const options = { ...defaults(), fetcher: async () => { requests++; return { entries: [{ id: 'real-visit' }] }; } };
    assert.equal((await loadServiceHistory(options)).cacheHit, false);
    assert.equal((await loadServiceHistory(options)).cacheHit, true);
    assert.equal((await loadServiceHistory({ ...options, now: now + 60000 })).cacheHit, true);
    assert.equal(requests, 1);
    assert.equal(options.storage.length, 1);
});

test('browser cache isolates signed-in user, outlet, channel and selected dates', async () => {
    let requests = 0;
    const options = { ...defaults(), fetcher: async () => { requests++; return { entries: [], bookings: [] }; } };
    await loadServiceHistory(options);
    for (const change of [
        { scope: serviceHistoryScope('different-user', 'vatika') },
        { scope: serviceHistoryScope('owner', 'different-outlet') },
        { channel: 'bookings' },
        { startDate: '2026-11-01', endDate: '2026-11-01' },
    ]) await loadServiceHistory({ ...options, ...change });
    assert.equal(requests, 5);
});

test('Today refreshes only on a subsequent request after expiry; old dates remain cached', async () => {
    let requests = 0;
    const options = { ...defaults(), fetcher: async () => { requests++; return { entries: [] }; } };
    await loadServiceHistory(options);
    await loadServiceHistory({ ...options, now: now + 5 * 60000 });
    await loadServiceHistory({ ...options, startDate: '2026-10-20', endDate: '2026-10-20' });
    assert.equal((await loadServiceHistory({ ...options, startDate: '2026-10-20', endDate: '2026-10-20', now: now + 60 * 60000 })).cacheHit, true);
    assert.equal(requests, 3);
});

test('concurrent tab requests share a single fetch; invalidation forces fresh data', async () => {
    let requests = 0;
    let finish;
    const options = { ...defaults(), fetcher: () => { requests++; return new Promise(resolve => { finish = resolve; }); } };
    const first = loadServiceHistory(options);
    const second = loadServiceHistory(options);
    assert.equal(requests, 1);
    finish({ entries: [] });
    await Promise.all([first, second]);
    invalidateServiceHistory(options.scope, options.storage);
    await loadServiceHistory({ ...options, fetcher: async () => { requests++; return { entries: [{ id: 'new-history' }] }; } });
    assert.equal(requests, 2);
});

test('a cached future date gets Today freshness rules after India midnight', async () => {
    let requests = 0;
    const options = { ...defaults(), startDate: '2026-11-03', endDate: '2026-11-03', fetcher: async () => { requests++; return { entries: [] }; } };
    await loadServiceHistory(options);
    await loadServiceHistory({ ...options, now: Date.parse('2026-11-02T18:31:00Z') });
    assert.equal(requests, 2);
});

test('live activity invalidates Today while preserving cached unrelated historical dates', async () => {
    let requests = 0;
    const options = { ...defaults(), fetcher: async () => { requests++; return { entries: [] }; } };
    await loadServiceHistory(options);
    await loadServiceHistory({ ...options, startDate: '2026-10-20', endDate: '2026-10-20' });
    invalidateServiceHistory(options.scope, options.storage, ['2026-11-02']);
    assert.equal((await loadServiceHistory({ ...options, startDate: '2026-10-20', endDate: '2026-10-20' })).cacheHit, true);
    assert.equal((await loadServiceHistory(options)).cacheHit, false);
    assert.equal(requests, 3);
});

test('an invalidated in-flight response cannot repopulate the cache with old data', async () => {
    let finish;
    const options = { ...defaults(), fetcher: () => new Promise(resolve => { finish = resolve; }) };
    const result = loadServiceHistory(options);
    invalidateServiceHistory(options.scope, options.storage);
    finish({ entries: [{ id: 'old-data' }] });
    await result;
    assert.equal(options.storage.length, 0);
});

test('a failed request is not cached, and disabled localStorage does not break history', async () => {
    const options = defaults();
    await assert.rejects(loadServiceHistory({ ...options, fetcher: async () => { throw new Error('network failed'); } }));
    assert.equal(options.storage.length, 0);
    const result = await loadServiceHistory({ ...options, storage: null, fetcher: async () => ({ entries: [] }) });
    assert.deepEqual(result.payload.entries, []);
});

test('no supplied history dates defaults to Today at India midnight for both APIs', () => {
    const instant = new Date('2026-11-01T18:30:00Z');
    assert.equal(getIndiaDateKey(instant), '2026-11-02');
    const range = getHistoryReadRange(new URLSearchParams(), instant);
    assert.equal(range.start.toISOString(), '2026-11-01T18:30:00.000Z');
    assert.equal(range.end.toISOString(), '2026-11-02T18:30:00.000Z');
    assert.throws(() => getHistoryReadRange(new URLSearchParams('startDate=2026-02-30')), error => error.status === 400);
});

test('storage quota evicts only old service-history entries and still caches the requested date', async () => {
    class SmallStorage extends Storage {
        setItem(key, value) {
            if (this.values.size >= 1 && !this.values.has(key)) throw new Error('Quota exceeded');
            super.setItem(key, value);
        }
    }
    let requests = 0;
    const options = { ...defaults(), storage: new SmallStorage(), fetcher: async () => { requests++; return { entries: [] }; } };
    await loadServiceHistory({ ...options, startDate: '2026-10-20', endDate: '2026-10-20' });
    await loadServiceHistory(options);
    assert.equal((await loadServiceHistory(options)).cacheHit, true);
    assert.equal(requests, 2);
});

test('maintenance is tied to actual no-show and late-booking deadlines, excluding old history', () => {
    assert.deepEqual(waitlistDeadlines([
        { id: 'notified', status: 'notified', noShowDeadlineAt: '2026-11-02T10:10:00Z' },
        { id: 'seated', status: 'seated', noShowDeadlineAt: '2026-10-01T10:00:00Z' },
    ]).map(deadline => deadline.at), [Date.parse('2026-11-02T10:10:00Z')]);
    assert.deepEqual(bookingBridgeDeadlines([
        { id: 'live', status: 'confirmed', bookingDateTime: '2026-11-02T10:00:00Z' },
        { id: 'old', status: 'confirmed', bookingDateTime: '2026-09-25T10:00:00Z' },
        { id: 'cancelled', status: 'cancelled_attack', bookingDateTime: '2026-11-02T10:00:00Z' },
    ], now).map(deadline => deadline.at), [now + 15 * 60000]);
});

test('live waitlist reads exclude accumulated old no-shows while retaining the recent grace period', () => {
    const records = [
        ...Array.from({ length: 5000 }, (_, id) => ({ id, status: 'no_show', noShowAt: new Date('2026-09-25T12:00:00Z') })),
        { id: 'active', status: 'pending' },
        { id: 'recent', status: 'no_show', noShowAt: new Date(now - 60000) },
        { id: 'history', status: 'seated' },
    ];
    const ref = { where(field, op, value) { return records.filter(row => op === 'in' ? value.includes(row[field]) : row[field] >= value); } };
    const results = buildLiveWaitlistQueries(ref, now).flat();
    assert.deepEqual(results.map(row => row.id), ['active', 'recent']);
});
