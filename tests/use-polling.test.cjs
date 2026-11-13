const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const swc = require('next/dist/build/swc');

const flush = () => new Promise(resolve => setImmediate(resolve));
let compiled;
async function harness(callback, options = {}) {
    if (!compiled) {
        const filename = path.join(__dirname, '../src/lib/usePolling.js');
        compiled = (await swc.transform(fs.readFileSync(filename, 'utf8'), {
            filename, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' }, module: { type: 'commonjs' },
        })).code;
    }
    const slots = [];
    const effects = [];
    const timers = new Map();
    const listeners = new Map();
    let cursor = 0;
    let nextId = 0;
    let result;
    const changed = (old, next) => !old || old.length !== next.length || next.some((value, index) => !Object.is(value, old[index]));
    const react = {
        useRef(value) { const slot = cursor++; return slots[slot] ||= { current: value }; },
        useCallback(fn, deps) {
            const slot = cursor++;
            if (changed(slots[slot]?.deps, deps)) slots[slot] = { fn, deps };
            return slots[slot].fn;
        },
        useEffect(fn, deps) {
            const slot = cursor++;
            if (changed(slots[slot]?.deps, deps)) effects.push(() => {
                slots[slot]?.cleanup?.();
                slots[slot] = { deps, cleanup: fn() };
            });
        },
    };
    const document = {
        visibilityState: 'visible',
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    };
    const mod = { exports: {} };
    vm.runInNewContext(compiled, {
        module: mod, exports: mod.exports, require: name => { assert.equal(name, 'react'); return react; },
        document, Promise, console: { error() {} },
        setTimeout: (fn, delay) => { timers.set(++nextId, { fn, delay }); return nextId; },
        clearTimeout: id => timers.delete(id),
    });
    const render = (nextCallback = callback, nextOptions = options) => {
        cursor = 0;
        result = mod.exports.usePolling(nextCallback, nextOptions);
        effects.splice(0).forEach(fn => fn());
        return result;
    };
    render();
    await flush();
    return {
        render, timers,
        refresh: () => result.refresh(),
        unmount: () => slots.forEach(slot => slot?.cleanup?.()),
        show: () => { document.visibilityState = 'visible'; listeners.get('visibilitychange')?.(); },
        hide: () => { document.visibilityState = 'hidden'; },
    };
}

test('a request finishing after leaving the screen cannot restart polling', async () => {
    let resolve;
    let calls = 0;
    const h = await harness(() => { calls += 1; return new Promise(done => { resolve = done; }); });
    h.unmount();
    resolve();
    await flush();
    assert.equal(calls, 1);
    assert.equal(h.timers.size, 0);
    await h.refresh();
    assert.equal(calls, 1);
});

test('visibility and manual refresh share one in-flight request and one future timer', async () => {
    let resolve;
    let calls = 0;
    const h = await harness(() => { calls += 1; return new Promise(done => { resolve = done; }); });
    h.show(); h.show();
    const manual = h.refresh();
    await flush();
    assert.equal(calls, 1);
    resolve();
    await manual;
    assert.equal(h.timers.size, 1);
    h.unmount();
});

test('changing outlet scope while a request is pending cancels only the old polling cycle', async () => {
    const resolvers = [];
    let calls = 0;
    const callback = () => { calls += 1; return new Promise(resolve => resolvers.push(resolve)); };
    const h = await harness(callback, { deps: ['first'] });
    h.render(callback, { deps: ['second'] });
    await flush();
    resolvers[0]();
    await flush();
    assert.equal(h.timers.size, 0);
    resolvers[1]();
    await flush();
    assert.equal(calls, 2);
    assert.equal(h.timers.size, 1);
    h.unmount();
});

test('disabling polling prevents a pending result from creating a new timer', async () => {
    let resolve;
    const callback = () => new Promise(done => { resolve = done; });
    const h = await harness(callback);
    h.render(callback, { enabled: false });
    resolve();
    await flush();
    assert.equal(h.timers.size, 0);
    h.unmount();
});

test('a failed request keeps one timer, and background polling uses the configured backoff', async () => {
    const h = await harness(async () => { throw new Error('Network unavailable'); }, { interval: 1000, backoffFactor: 4 });
    assert.equal(h.timers.size, 1);
    h.hide();
    await h.refresh();
    assert.equal(h.timers.size, 1);
    assert.equal([...h.timers.values()][0].delay, 4000);
    h.unmount();
});
