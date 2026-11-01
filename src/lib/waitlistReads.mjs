export const LIVE_WAITLIST_STATUSES = ['pending', 'ready_to_notify', 'notified', 'arrived'];
export const WAITLIST_NO_SHOW_WINDOW_MS = 2 * 60 * 60 * 1000;
export const recentNoShowCutoff = (now = Date.now()) => new Date(now - WAITLIST_NO_SHOW_WINDOW_MS);

export function buildLiveWaitlistQueries(waitlistRef, now = Date.now()) {
    return [
        waitlistRef.where('status', 'in', LIVE_WAITLIST_STATUSES),
        // Single-field date query: no composite index or all-time fallback.
        waitlistRef.where('noShowAt', '>=', recentNoShowCutoff(now)),
    ];
}
