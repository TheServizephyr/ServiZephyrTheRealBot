import { NextResponse } from 'next/server';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const ANALYTICS_TIMEZONE = 'Asia/Kolkata';

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
    return Number.parseInt(hour, 10);
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'view_waitlist_analytics',
            {},
            false,
            PERMISSIONS.VIEW_DINE_IN
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
            };
        });

        const hourlyMap = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            label: `${String(hour).padStart(2, '0')}:00`,
            count: 0,
            seated: 0,
            cancellations: 0,
            noShow: 0,
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

        const phonesInRange = new Set();
        const uniquePhones = new Set();

        entries.forEach((entry) => {
            const status = String(entry.status || '').toLowerCase();
            const hour = entry.createdAtDate ? getHourInTimeZone(entry.createdAtDate) : null;

            if (Number.isInteger(hour) && hourlyMap[hour]) {
                hourlyMap[hour].count += 1;
                if (status === 'seated') hourlyMap[hour].seated += 1;
                if (status === 'cancelled') hourlyMap[hour].cancellations += 1;
                if (status === 'no_show') hourlyMap[hour].noShow += 1;
            }

            if (status in statusCounts) statusCounts[status] += 1;
            else statusCounts.other += 1;

            const phone = normalizePhone(entry.phone);
            if (phone && /^\d{10}$/.test(phone)) {
                phonesInRange.add(phone);
                uniquePhones.add(phone);
            }
        });

        const repeatPhoneSet = new Set();
        await Promise.all(Array.from(uniquePhones).map(async (phone) => {
            // Keep this query index-friendly by filtering only on phone.
            const phoneEntriesSnap = await businessRef.collection('waitlist')
                .where('phone', '==', phone)
                .get();
            const hasEarlierVisit = phoneEntriesSnap.docs.some((doc) => {
                const createdAtDate = toDate(doc.data()?.createdAt);
                return createdAtDate && createdAtDate.getTime() < range.start.getTime();
            });
            if (hasEarlierVisit) {
                repeatPhoneSet.add(phone);
            }
        }));

        const repeatCustomers = repeatPhoneSet.size;
        const newCustomers = Math.max(0, phonesInRange.size - repeatCustomers);
        const cancellationCount = statusCounts.cancelled;
        const noShowCount = statusCounts.no_show;

        const statusBreakdown = Object.entries(statusCounts)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => ({ status, count }));

        const peakHours = [...hourlyMap]
            .filter((item) => item.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return NextResponse.json({
            startDate: startDateKey,
            endDate: endDateKey,
            timezone: ANALYTICS_TIMEZONE,
            summary: {
                totalEntries: entries.length,
                uniqueCustomers: phonesInRange.size,
                newCustomers,
                repeatCustomers,
                cancellations: cancellationCount,
                noShow: noShowCount,
                seated: statusCounts.seated,
                active: statusCounts.pending + statusCounts.notified + statusCounts.arrived,
            },
            customerMix: [
                { label: 'New Customers', count: newCustomers },
                { label: 'Repeat Customers', count: repeatCustomers },
            ],
            statusBreakdown,
            hourly: hourlyMap,
            peakHours,
        }, { status: 200 });
    } catch (error) {
        console.error('GET WAITLIST ANALYTICS ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
