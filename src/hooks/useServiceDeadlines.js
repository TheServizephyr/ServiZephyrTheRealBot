import { useEffect, useRef } from 'react';
import { createServiceDeadlineScheduler } from '@/lib/client/serviceDeadlineScheduler.mjs';

// Refresh only when a known booking/no-show deadline is due. No periodic fetch.
export function useServiceDeadlines(deadlines, refresh, enabled = true) {
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    const schedulerRef = useRef(null);
    useEffect(() => {
        if (!enabled) return;
        const scheduler = createServiceDeadlineScheduler({
            refresh: () => refreshRef.current(),
            isVisible: () => document.visibilityState === 'visible',
        });
        schedulerRef.current = scheduler;
        document.addEventListener('visibilitychange', scheduler.wake);
        return () => {
            scheduler.dispose();
            schedulerRef.current = null;
            document.removeEventListener('visibilitychange', scheduler.wake);
        };
    }, [enabled]);
    useEffect(() => { schedulerRef.current?.update(deadlines); }, [deadlines, enabled]);
}
