export function getIndiaDateKey(now = new Date()) {
    return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

function parseDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return new Date(`${value}T00:00:00+05:30`);
}

export function getHistoryReadRange(searchParams, now = new Date()) {
    const date = searchParams.get('date');
    const first = searchParams.get('startDate') || date;
    const last = searchParams.get('endDate') || date;
    const startKey = first || last || getIndiaDateKey(now);
    const endKey = last || first || startKey;
    const start = parseDateKey(startKey);
    const lastDay = parseDateKey(endKey);
    if (!start || !lastDay || start > lastDay) {
        throw Object.assign(new Error('Invalid history dates. Use YYYY-MM-DD with startDate <= endDate.'), { status: 400 });
    }
    return { start, end: new Date(lastDay.getTime() + 86400000), startKey, endKey };
}
