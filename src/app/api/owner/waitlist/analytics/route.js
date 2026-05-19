import { NextResponse } from 'next/server';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const ANALYTICS_TIMEZONE = 'Asia/Kolkata';
const WAITLIST_ANALYTICS_PERMISSIONS = [
    PERMISSIONS.VIEW_BOOKINGS,
    PERMISSIONS.MANAGE_BOOKINGS,
    PERMISSIONS.VIEW_DINE_IN_ORDERS,
    PERMISSIONS.MANAGE_DINE_IN,
];
const VALID_PHONE_RE = /^\d{10}$/;
const STATUS_LABELS = {
    pending: 'Pending',
    ready_to_notify: 'Ready to Notify',
    notified: 'Notified',
    arrived: 'Arrived',
    seated: 'Seated',
    cancelled: 'Cancelled',
    no_show: 'No-show',
    other: 'Other',
};

function toDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000);
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateKey(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: ANALYTICS_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function parseDateKey(dateKey) {
    const normalized = String(dateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
    const parsed = new Date(`${normalized}T00:00:00+05:30`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function getDateRange({ startDate, endDate }) {
    const parsedStart = parseDateKey(startDate);
    const parsedEnd = parseDateKey(endDate);
    if (!parsedStart || !parsedEnd) return null;
    if (parsedStart.getTime() > parsedEnd.getTime()) return null;
    const endExclusive = new Date(parsedEnd.getTime() + (24 * 60 * 60 * 1000));
    return { start: parsedStart, end: endExclusive };
}

function getHourInTimeZone(date) {
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: ANALYTICS_TIMEZONE,
        hour: '2-digit',
        hour12: false,
    }).format(date);
    const parsedHour = Number.parseInt(hour, 10);
    return parsedHour === 24 ? 0 : parsedHour;
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function getPaxCount(entry = {}) {
    const parsed = Number(entry.paxCount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function roundMetric(value, decimals = 1) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function getPercent(part, total) {
    if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
    return roundMetric((part / total) * 100, 1);
}

function getMedian(values = []) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[mid];
    return roundMetric((sorted[mid - 1] + sorted[mid]) / 2, 1);
}

function getWaitMinutes(entry = {}) {
    const createdAtMs = entry.createdAtDate?.getTime?.();
    const seatedAtMs = entry.seatedAtDate?.getTime?.();
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(seatedAtMs) || seatedAtMs < createdAtMs) return null;
    return roundMetric((seatedAtMs - createdAtMs) / 60000, 1);
}

function getStatusLabel(status) {
    return STATUS_LABELS[status] || String(status || 'other')
        .split('_')
        .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : '')
        .join(' ');
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'view_waitlist_analytics',
            {},
            false,
            WAITLIST_ANALYTICS_PERMISSIONS
        );
        const { businessSnap } = context;
        const businessRef = businessSnap.ref;

        const url = new URL(req.url);
        const requestedStartDate = String(url.searchParams.get('startDate') || url.searchParams.get('date') || '').trim();
        const requestedEndDate = String(url.searchParams.get('endDate') || requestedStartDate || '').trim();
        const fallbackDate = formatDateKey(new Date());
        const startDateKey = requestedStartDate || fallbackDate;
        const endDateKey = requestedEndDate || startDateKey;

        const range = getDateRange({ startDate: startDateKey, endDate: endDateKey });
        if (!range) {
            return NextResponse.json({ message: 'Invalid date range. Use YYYY-MM-DD and ensure startDate <= endDate.' }, { status: 400 });
        }

        const waitlistSnap = await businessRef.collection('waitlist')
            .where('createdAt', '>=', range.start)
            .where('createdAt', '<', range.end)
            .get();

        const entries = waitlistSnap.docs.map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                ...data,
                createdAtDate: toDate(data.createdAt),
                updatedAtDate: toDate(data.updatedAt),
                notifiedAtDate: toDate(data.notifiedAt),
                arrivedAtDate: toDate(data.arrivedAt),
                seatedAtDate: toDate(data.seatedAt),
                cancelledAtDate: toDate(data.cancelledAt),
                noShowAtDate: toDate(data.noShowAt),
            };
        });

        const hourlyMap = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            label: `${String(hour).padStart(2, '0')}:00`,
            count: 0,
            covers: 0,
            seated: 0,
            cancellations: 0,
            noShow: 0,
            waitMinutesTotal: 0,
            waitSamples: 0,
            averageWaitMinutes: 0,
        }));

        const statusCounts = {
            pending: 0,
            ready_to_notify: 0,
            notified: 0,
            arrived: 0,
            seated: 0,
            cancelled: 0,
            no_show: 0,
            other: 0,
        };

        const uniquePhones = new Set();
        const waitDurations = [];
        let totalCovers = 0;
        let seatedCovers = 0;
        let lostCovers = 0;
        let notifiedEntries = 0;
        let arrivedEntries = 0;

        entries.forEach((entry) => {
            const status = String(entry.status || '').toLowerCase();
            const hour = entry.createdAtDate ? getHourInTimeZone(entry.createdAtDate) : null;
            const paxCount = getPaxCount(entry);
            totalCovers += paxCount;

            if (Number.isInteger(hour) && hourlyMap[hour]) {
                hourlyMap[hour].count += 1;
                hourlyMap[hour].covers += paxCount;
                if (status === 'seated') hourlyMap[hour].seated += 1;
                if (status === 'cancelled') hourlyMap[hour].cancellations += 1;
                if (status === 'no_show') hourlyMap[hour].noShow += 1;
            }

            if (status in statusCounts) statusCounts[status] += 1;
            else statusCounts.other += 1;

            const phone = normalizePhone(entry.phone);
            if (phone && VALID_PHONE_RE.test(phone)) {
                uniquePhones.add(phone);
            }

            if (entry.notifiedAtDate) notifiedEntries += 1;
            if (entry.arrivedAtDate) arrivedEntries += 1;
            if (status === 'seated') seatedCovers += paxCount;
            if (status === 'cancelled' || status === 'no_show') lostCovers += paxCount;

            const waitMinutes = getWaitMinutes(entry);
            if (waitMinutes !== null) {
                waitDurations.push(waitMinutes);
                if (Number.isInteger(hour) && hourlyMap[hour]) {
                    hourlyMap[hour].waitMinutesTotal += waitMinutes;
                    hourlyMap[hour].waitSamples += 1;
                }
            }
        });

        const phoneHistoryPairs = await Promise.all(Array.from(uniquePhones).map(async (phone) => {
            // Keep this query index-friendly by filtering only on phone.
            const phoneEntriesSnap = await businessRef.collection('waitlist')
                .where('phone', '==', phone)
                .get();
            const timestamps = phoneEntriesSnap.docs
                .map((doc) => toDate(doc.data()?.createdAt)?.getTime())
                .filter((time) => Number.isFinite(time))
                .sort((a, b) => a - b);
            return [phone, timestamps];
        }));
        const phoneHistoryMap = new Map(phoneHistoryPairs);

        let newCustomerVisits = 0;
        let repeatCustomerVisits = 0;
        let unidentifiedVisits = 0;

        entries.forEach((entry) => {
            const phone = normalizePhone(entry.phone);
            if (!phone || !VALID_PHONE_RE.test(phone)) {
                unidentifiedVisits += 1;
                return;
            }

            const entryMs = entry.createdAtDate?.getTime?.();
            const phoneHistory = phoneHistoryMap.get(phone) || [];
            const hasEarlierVisit = Number.isFinite(entryMs) && phoneHistory.some((time) => time < entryMs);
            if (hasEarlierVisit) repeatCustomerVisits += 1;
            else newCustomerVisits += 1;
        });

        const uniqueRepeatCustomers = Array.from(uniquePhones).filter((phone) => (
            (phoneHistoryMap.get(phone) || []).some((time) => time < range.start.getTime())
        )).length;
        const uniqueNewCustomers = Math.max(0, uniquePhones.size - uniqueRepeatCustomers);

        const cancellationCount = statusCounts.cancelled;
        const noShowCount = statusCounts.no_show;
        const totalEntries = entries.length;
        const knownCustomerVisits = newCustomerVisits + repeatCustomerVisits;
        const averageWaitMinutes = waitDurations.length
            ? roundMetric(waitDurations.reduce((sum, value) => sum + value, 0) / waitDurations.length, 1)
            : 0;
        const medianWaitMinutes = getMedian(waitDurations);
        const averagePartySize = totalEntries ? roundMetric(totalCovers / totalEntries, 1) : 0;

        const statusBreakdown = Object.entries(statusCounts)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => ({ status, label: getStatusLabel(status), count }));

        hourlyMap.forEach((item) => {
            item.averageWaitMinutes = item.waitSamples
                ? roundMetric(item.waitMinutesTotal / item.waitSamples, 1)
                : 0;
            delete item.waitMinutesTotal;
            delete item.waitSamples;
        });

        const peakHours = [...hourlyMap]
            .filter((item) => item.count > 0)
            .sort((a, b) => (b.count - a.count) || (b.covers - a.covers))
            .slice(0, 5);
        const peakHour = peakHours[0] || null;
        const seatingRate = getPercent(statusCounts.seated, totalEntries);
        const cancellationRate = getPercent(cancellationCount, totalEntries);
        const noShowRate = getPercent(noShowCount, totalEntries);
        const unidentifiedRate = getPercent(unidentifiedVisits, totalEntries);
        const duplicateKnownVisits = Math.max(0, knownCustomerVisits - uniquePhones.size);

        const insights = [];
        if (totalEntries === 0) {
            insights.push('No waitlist activity was recorded in this date range.');
        } else {
            if (peakHour) {
                insights.push(`Peak demand was ${peakHour.label} with ${peakHour.count} entries and ${peakHour.covers} covers (guests).`);
            }
            insights.push(`${seatingRate}% of entries were seated in this range.`);
            if (averageWaitMinutes > 0) {
                insights.push(`Average seating wait was ${averageWaitMinutes} minutes; median wait was ${medianWaitMinutes} minutes.`);
            }
            if (unidentifiedVisits > 0) {
                insights.push(`${unidentifiedVisits} entries are missing a valid phone number, which limits repeat-customer tracking.`);
            }
            if (lostCovers > 0) {
                insights.push(`${lostCovers} covers (guests) were lost through cancellations or no-shows.`);
            }
        }

        return NextResponse.json({
            startDate: startDateKey,
            endDate: endDateKey,
            timezone: ANALYTICS_TIMEZONE,
            summary: {
                totalEntries,
                totalCovers,
                uniqueCustomers: uniquePhones.size,
                uniqueNewCustomers,
                uniqueRepeatCustomers,
                knownCustomerVisits,
                newCustomers: newCustomerVisits,
                repeatCustomers: repeatCustomerVisits,
                newCustomerVisits,
                repeatCustomerVisits,
                unidentifiedVisits,
                unidentifiedRate,
                duplicateKnownVisits,
                cancellations: cancellationCount,
                noShow: noShowCount,
                seated: statusCounts.seated,
                active: statusCounts.pending + statusCounts.ready_to_notify + statusCounts.notified + statusCounts.arrived,
                seatingRate,
                cancellationRate,
                noShowRate,
                averageWaitMinutes,
                medianWaitMinutes,
                averagePartySize,
                seatedCovers,
                lostCovers,
                notifiedEntries,
                arrivedEntries,
                peakHour: peakHour?.hour ?? null,
                peakHourLabel: peakHour?.label || null,
                peakHourEntries: peakHour?.count || 0,
                peakHourCovers: peakHour?.covers || 0,
            },
            customerMix: [
                { label: 'New Visits', count: newCustomerVisits },
                { label: 'Repeat Visits', count: repeatCustomerVisits },
                { label: 'Unidentified', count: unidentifiedVisits },
            ],
            funnel: [
                { key: 'joined', label: 'Joined', count: totalEntries },
                { key: 'notified', label: 'Notified', count: notifiedEntries },
                { key: 'arrived', label: 'Arrived', count: arrivedEntries },
                { key: 'seated', label: 'Seated', count: statusCounts.seated },
                { key: 'lost', label: 'Cancelled / No-show', count: cancellationCount + noShowCount },
            ],
            statusBreakdown,
            hourly: hourlyMap,
            peakHours,
            insights,
        }, { status: 200 });
    } catch (error) {
        console.error('GET WAITLIST ANALYTICS ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
