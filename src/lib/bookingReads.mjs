import { getHistoryReadRange } from './historyDates.mjs';

// Shared by the API and browser: live refreshes must never load booking history.
export const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed'];
export const CUSTOMER_BOOKING_STATUSES = [...ACTIVE_BOOKING_STATUSES, 'completed', 'cancelled', 'late_waitlist'];

export function getBookingReadScope(searchParams) {
    const view = searchParams.get('view') || 'live';
    if (view === 'live') return { view, statuses: ACTIVE_BOOKING_STATUSES };
    // Customer insights is an explicit, on-demand read of legitimate bookings.
    if (view === 'customers') return { view, statuses: CUSTOMER_BOOKING_STATUSES };
    if (view === 'history') {
        return { view, ...getHistoryReadRange(searchParams) };
    }
    throw Object.assign(new Error('Use live, customers, or history with valid startDate/endDate (YYYY-MM-DD).'), { status: 400 });
}

export function buildBookingReadQuery(bookingsRef, scope) {
    if (scope.view === 'history') {
        return bookingsRef
            .where('bookingDateTime', '>=', scope.start)
            .where('bookingDateTime', '<', scope.end)
            .orderBy('bookingDateTime', 'desc');
    }
    // A single-field status query needs no new composite index. Sort its small
    // result in the caller instead of falling back to an unfiltered query.
    return bookingsRef.where('status', 'in', scope.statuses);
}
