import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { getAdminOrderAnalytics, parseAnalyticsRange, timestampToDate, toIstDayKey } from '@/lib/server/adminAnalyticsMetrics';

export const dynamic = 'force-dynamic';

function classifyUserRole(user = {}) {
  const role = String(user.role || '').trim().toLowerCase();
  const businessType = String(user.businessType || '').trim().toLowerCase();

  const isOwnerLike =
    role.includes('owner') ||
    role === 'manager' ||
    role === 'restaurant-owner' ||
    role === 'shop-owner' ||
    role === 'street-vendor' ||
    ['restaurant', 'shop', 'store', 'street-vendor', 'street_vendor'].includes(businessType);

  return isOwnerLike ? 'owner' : 'customer';
}

function buildUserSeries(startKey, endKey) {
  const days = new Map();
  let cursor = startKey;
  while (cursor <= endKey) {
    days.set(cursor, { date: cursor, customers: 0, owners: 0 });
    const currentDate = new Date(`${cursor}T00:00:00.000Z`);
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    cursor = currentDate.toISOString().slice(0, 10);
  }
  return days;
}

export async function GET(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    await verifyAdmin(req);

    const firestore = await getFirestore();
    const { searchParams } = new URL(req.url);
    const selectedWindow = parseAnalyticsRange(searchParams);

    const [orderAnalytics, usersSnap] = await Promise.all([
      getAdminOrderAnalytics(firestore, {
        selectedWindow,
        topLimit: 10,
        restaurantLimit: 20,
      }),
      firestore.collection('users')
        .where('createdAt', '>=', selectedWindow.start)
        .where('createdAt', '<=', selectedWindow.end)
        .get(),
    ]);

    const usersByDay = buildUserSeries(selectedWindow.startKey, selectedWindow.endKey);
    usersSnap.docs.forEach((doc) => {
      const user = doc.data() || {};
      const createdAt = timestampToDate(user.createdAt);
      const dayKey = toIstDayKey(createdAt);
      if (!dayKey || !usersByDay.has(dayKey)) return;

      const type = classifyUserRole(user);
      if (type === 'owner') {
        usersByDay.get(dayKey).owners += 1;
      } else {
        usersByDay.get(dayKey).customers += 1;
      }
    });

    return NextResponse.json({
      ...orderAnalytics,
      totals: {
        ...orderAnalytics.totals,
        userSignups: usersSnap.size,
      },
      userData: Array.from(usersByDay.values()),
    }, { status: 200 });
  } catch (error) {
    console.error('GET /api/admin/analytics ERROR:', error);
    return NextResponse.json({
      message: error.message || 'Failed to fetch analytics',
    }, { status: error.status || 500 });
  }
}
