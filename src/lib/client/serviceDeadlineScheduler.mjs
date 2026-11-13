// One refresh handles every deadline already due, even while snapshots rerender.
export function createServiceDeadlineScheduler({ refresh, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, isVisible = () => true }) {
    let deadlines = [];
    let running = false;
    let disposed = false;
    let timer;
    const handled = new Set();
    const failures = new Map();
    const retryAt = new Map();

    const arm = () => {
        clearTimer(timer);
        if (disposed || running || !isVisible()) return;
        const pending = deadlines.filter(item => !handled.has(item.key));
        if (!pending.length) return;
        const nextAt = Math.min(...pending.map(item => Math.max(item.at + 500, retryAt.get(item.key) || 0)));
        if (nextAt > now()) {
            timer = setTimer(arm, Math.min(nextAt - now(), 2147483647));
            return;
        }
        const due = pending.filter(item => Math.max(item.at + 500, retryAt.get(item.key) || 0) <= now());
        due.forEach(item => handled.add(item.key));
        running = true;
        Promise.resolve().then(() => disposed ? undefined : refresh()).then(result => {
            if (result === false) throw new Error('Service refresh failed');
        }).catch(() => {
            // Retry only failed, known work; never turn this into polling.
            for (const item of due) {
                const attempts = (failures.get(item.key) || 0) + 1;
                failures.set(item.key, attempts);
                if (attempts < 3 && deadlines.some(current => current.key === item.key)) {
                    handled.delete(item.key);
                    retryAt.set(item.key, now() + attempts * 5000);
                }
            }
        }).finally(() => {
            running = false;
            arm();
        });
    };

    return {
        update(next) {
            deadlines = next.filter(item => Number.isFinite(item.at));
            const keys = new Set(deadlines.map(item => item.key));
            for (const collection of [handled, failures, retryAt]) {
                for (const key of collection.keys()) if (!keys.has(key)) collection.delete(key);
            }
            arm();
        },
        wake: arm,
        dispose() { disposed = true; clearTimer(timer); },
    };
}
