import { useEffect, useRef } from 'react';

// Refresh only when a known booking/no-show deadline is due. No periodic fetch.
export function useServiceDeadlines(deadlines, refresh, enabled = true) {
    const handled = useRef(new Set());
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let timer;
        let running = false;
        const keys = new Set(deadlines.map(deadline => deadline.key));
        for (const key of handled.current) if (!keys.has(key)) handled.current.delete(key);
        const arm = () => {
            clearTimeout(timer);
            if (cancelled || running || document.visibilityState !== 'visible') return;
            const next = deadlines.filter(deadline => !handled.current.has(deadline.key)).sort((a, b) => a.at - b.at)[0];
            if (!next) return;
            const wait = next.at - Date.now();
            if (wait > 0) {
                timer = setTimeout(arm, Math.min(wait + 250, 2147483647));
                return;
            }
            handled.current.add(next.key);
            running = true;
            Promise.resolve().then(refresh).catch(error => console.error('[Service deadline]', error)).finally(() => {
                running = false;
                arm();
            });
        };
        document.addEventListener('visibilitychange', arm);
        arm();
        return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange', arm); };
    }, [deadlines, refresh, enabled]);
}
