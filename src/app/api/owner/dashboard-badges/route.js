import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { getOrSetEphemeralCache } from '@/lib/server/ephemeralCache';

const BADGE_CACHE_TTL_MS = 15 * 1000;
export const dynamic = 'force-dynamic';

function normalizeBusinessType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'shops') return 'store';
  if (normalized === 'street_vendors') return 'street-vendor';
  if (normalized === 'restaurants') return 'restaurant';
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street_vendor' || normalized === 'street-vendor') return 'street-vendor';
  return 'restaurant';
}

export async function GET(req) {
  try {
    const firestore = await getFirestore();
    const context = await verifyOwnerWithAudit(req, 'view_dashboard_data', {}, false, null);
    const businessRef = context?.businessSnap?.ref;

    if (!businessRef) {
      return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
    }

    const businessData = context?.businessSnap?.data?.() || {};
    const businessId = context?.businessId || businessRef.id;
    const businessType = normalizeBusinessType(businessData?.businessType || context?.collectionName);
    const isRestaurantBusiness = businessType === 'restaurant';
    const cacheKey = `owner:dashboard-badges:${businessRef.path}`;

    const payload = await getOrSetEphemeralCache(cacheKey, BADGE_CACHE_TTL_MS, async () => {
      const pendingOrdersPromise = firestore
        .collection('orders')
        .where('restaurantId', '==', businessId)
        .where('status', '==', 'pending')
        .get();

      const unreadConversationsPromise = businessRef
        .collection('conversations')
        .where('unreadCount', '>', 0)
        .get();

      const dineInPendingPromise = isRestaurantBusiness
        ? firestore
            .collection('orders')
            .where('restaurantId', '==', businessId)
            .where('deliveryType', '==', 'dine-in')
            .where('status', '==', 'pending')
            .get()
        : Promise.resolve(null);

      const waitlistPromise = isRestaurantBusiness
        ? businessRef
            .collection('waitlist')
            .where('status', 'in', ['pending', 'notified'])
            .get()
        : Promise.resolve(null);

      const serviceRequestsPromise = isRestaurantBusiness
        ? businessRef
            .collection('serviceRequests')
            .where('status', '==', 'pending')
            .get()
        : Promise.resolve(null);

      const [
        pendingOrdersSnap,
        unreadConversationsSnap,
        dineInPendingSnap,
        waitlistSnap,
        serviceRequestsSnap,
      ] = await Promise.all([
        pendingOrdersPromise,
        unreadConversationsPromise,
        dineInPendingPromise,
        waitlistPromise,
        serviceRequestsPromise,
      ]);

      const whatsappUnreadCount = unreadConversationsSnap.docs.reduce((acc, doc) => {
        const data = doc.data() || {};
        if (data.state !== 'direct_chat') return acc;
        return acc + Math.max(0, Number(data.unreadCount || 0));
      }, 0);

      return {
        businessType,
        pendingOrdersCount: pendingOrdersSnap.size,
        whatsappUnreadCount,
        waitlistEntriesCount: waitlistSnap?.size || 0,
        dineInPendingOrdersCount: dineInPendingSnap?.size || 0,
        dineInServiceRequestsCount: serviceRequestsSnap?.size || 0,
      };
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error('GET /api/owner/dashboard-badges ERROR:', error);
    return NextResponse.json(
      { message: `Backend Error: ${error.message}` },
      { status: error.status || 500 }
    );
  }
}
