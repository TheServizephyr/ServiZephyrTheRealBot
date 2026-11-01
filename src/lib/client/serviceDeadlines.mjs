function millis(value) {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    const seconds = value?._seconds ?? value?.seconds;
    if (typeof seconds === 'number') return seconds * 1000;
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
}

export function waitlistDeadlines(entries, timeoutMinutes = 10) {
    return entries.flatMap(entry => {
        let at = millis(entry.noShowDeadlineAt);
        if (!at) {
            const notified = millis(entry.notifiedAt) || millis(entry.updatedAt);
            at = notified ? notified + Number(timeoutMinutes) * 60000 : 0;
        }
        if (entry.status === 'no_show') at = millis(entry.noShowAt) || at;
        if (!at || !['notified', 'no_show'].includes(entry.status)) return [];
        if (entry.status === 'no_show') at += 2 * 60 * 60000;
        return [{ key: `${entry.id}:${entry.status}:${at}`, at }];
    });
}

export function bookingBridgeDeadlines(bookings, now = Date.now()) {
    return bookings.flatMap(booking => {
        const at = millis(booking.bookingDateTime);
        if (!at || at < now - 48 * 60 * 60000 || !['pending', 'confirmed'].includes(booking.status)) return [];
        return [{ key: `${booking.id}:${at}`, at: at + 15 * 60000 }];
    });
}
