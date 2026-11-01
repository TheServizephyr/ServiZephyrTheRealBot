import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingReadQuery, getBookingReadScope } from '../src/lib/bookingReads.mjs';

// Simulate the production incident without reading or writing production data.
// Only documents matching the database predicates count as returned reads.
class Query {
    constructor(rows, predicates = []) { this.rows = rows; this.predicates = predicates; }
    where(field, op, value) {
        return new Query(this.rows, [...this.predicates, row => {
            if (op === 'in') return value.includes(row[field]);
            if (op === '>=') return row[field] >= value;
            if (op === '<') return row[field] < value;
            throw new Error(`Unexpected operator: ${op}`);
        }]);
    }
    orderBy() { return this; }
    get() { return this.rows.filter(row => this.predicates.every(predicate => predicate(row))); }
}

const rows = [
    ...Array.from({ length: 2608 }, (_, id) => ({ id, status: 'cancelled_attack', bookingDateTime: new Date('2026-09-25T16:00:00Z') })),
    { id: 'future', status: 'confirmed', bookingDateTime: new Date('2026-12-01T16:00:00Z') },
    { id: 'pending', status: 'pending', bookingDateTime: new Date('2026-11-02T14:00:00Z') },
    { id: 'before', status: 'completed', bookingDateTime: new Date('2026-11-01T18:29:59.999Z') },
    { id: 'start', status: 'completed', bookingDateTime: new Date('2026-11-01T18:30:00Z') },
    { id: 'end', status: 'cancelled', bookingDateTime: new Date('2026-11-02T18:29:59.999Z') },
    { id: 'after', status: 'completed', bookingDateTime: new Date('2026-11-02T18:30:00Z') },
];
const run = params => buildBookingReadQuery(new Query(rows), getBookingReadScope(new URLSearchParams(params))).get();

test('routine refresh excludes the 2,608 attack records and all completed history, retaining future bookings', () => {
    assert.deepEqual(run({}).map(row => row.id), ['future', 'pending']);
});

test('Today applies database date bounds at India midnight, with an exclusive next-day boundary', () => {
    assert.deepEqual(run({ view: 'history', startDate: '2026-11-02', endDate: '2026-11-02' }).map(row => row.id), ['pending', 'start', 'end']);
});

test('explicit customer insights retains legitimate past bookings without reading the flood', () => {
    const results = run({ view: 'customers' });
    assert.equal(results.length, 6);
    assert.ok(results.some(row => row.id === 'before'));
    assert.ok(results.every(row => row.status !== 'cancelled_attack'));
});

test('invalid ranges fail instead of silently reverting to all-time reads', () => {
    for (const params of [
        { view: 'all' },
        { view: 'history', startDate: '2026-02-30', endDate: '2026-03-01' },
        { view: 'history', startDate: '2026-11-03', endDate: '2026-11-02' },
    ]) {
        assert.throws(() => run(params), error => error.status === 400);
    }
});
