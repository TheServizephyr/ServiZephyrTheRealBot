import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { getDecodedAuthContext, getFirestore } from '@/lib/firebase-admin';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { getPublicSettings } from '@/services/business/publicSettings.service';
import { findBusinessById } from '@/services/business/businessService';
import { resolveCustomerLookupProfile } from '@/services/customer/customerLookup.service';
import { resolveActiveOrdersForCustomerContext } from '@/services/order/activeOrderLookup.service';
import { enforceRateLimit, readSignedGuestSessionCookie, verifyAppCheckToken } from '@/lib/public-auth';
import { getBusinessRuntime, resolveScopedFeatureFlagValue } from '@/lib/server/businessRuntime';
import { getFreshMenuSnapshot } from '@/lib/server/menuSnapshot';

export const dynamic = 'force-dynamic';

const CUSTOMER_TIMEOUT_MS = Math.max(150, Number(process.env.PUBLIC_BOOTSTRAP_CUSTOMER_TIMEOUT_MS || 300));
const ACTIVE_ORDER_TIMEOUT_MS = Math.max(150, Number(process.env.PUBLIC_BOOTSTRAP_ACTIVE_ORDER_TIMEOUT_MS || 300));

function withTimeout(promise, timeoutMs, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs)),
  ]);
}

function getClientIp(req) {
  const forwardedFor = req.headers.get('x-forwarded-for') || '';
  return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function GET(req, { params }) {
  try {
    await verifyAppCheckToken(req, { required: false });
    const { restaurantId } = await params;
    const businessId = String(restaurantId || '').trim();
    if (!businessId) {
      return NextResponse.json({ message: 'Restaurant ID is required.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const rate = await enforceRateLimit(firestore, {
      key: `public-bootstrap:${getClientIp(req)}:${businessId}`,
      limit: 45,
      windowSec: 60,
      req,
      auditContext: 'public_bootstrap',
    });
    if (!rate.allowed) {
      return NextResponse.json({ message: 'Too many bootstrap requests. Please slow down.' }, { status: 429 });
    }

    const business = await findBusinessById(firestore, businessId, {
      includeDeliverySettings: false,
    });
    if (!business?.ref) {
      return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
    }

    const businessData = business.data || {};
    const runtimeData = await getBusinessRuntime(business.ref);
    const bootstrapEnabled = resolveScopedFeatureFlagValue('bootstrap_enabled', {
      businessData,
      runtimeData,
      envDefault: FEATURE_FLAGS.USE_PUBLIC_BOOTSTRAP,
    });

    if (!bootstrapEnabled) {
      return NextResponse.json({ message: 'Bootstrap disabled for this business.' }, { status: 409 });
    }

    const searchParams = new URL(req.url).searchParams;
    const phone = String(searchParams.get('phone') || '').trim();
    const ref = String(searchParams.get('ref') || '').trim();
    const token = String(searchParams.get('token') || '').trim();

    const cookieStore = cookies();
    const guestSession = readSignedGuestSessionCookie(cookieStore, ['customer_lookup']);
    const cookieGuestId = guestSession?.subjectId || null;

    let loggedInUid = null;
    try {
      const decodedToken = await getDecodedAuthContext(req, { checkRevoked: false, allowSessionCookie: true });
      loggedInUid = decodedToken.uid;
    } catch {
      // Guest path is fine.
    }

    const [menuSnapshot, customerResult, activeOrderResult] = await Promise.all([
      getFreshMenuSnapshot({
        firestore,
        businessId,
        collectionNameHint: business.collection,
        allowInlineRebuild: true,
      }),
      withTimeout(
        resolveCustomerLookupProfile(firestore, {
          phone,
          explicitGuestId: null,
          ref,
          cookieGuestId,
          loggedInUid,
        }),
        CUSTOMER_TIMEOUT_MS,
        null
      ),
      withTimeout(
        resolveActiveOrdersForCustomerContext(firestore, {
          phone,
          ref,
          restaurantId: businessId,
          token,
        }),
        ACTIVE_ORDER_TIMEOUT_MS,
        null
      ),
    ]);

    const publicSettings = menuSnapshot?.publicSettings || await getPublicSettings(firestore, businessId);
    const menuData = menuSnapshot?.publicMenuPayload || {};
    const activeOrder = Array.isArray(activeOrderResult?.activeOrders) ? activeOrderResult.activeOrders[0] || null : null;

    return NextResponse.json({
      ok: true,
      version: 1,
      generatedAt: new Date().toISOString(),
      cache: {
        menuSnapshotVersion: Number(menuSnapshot?.menuVersion || businessData?.menuVersion || 0),
        runtimeVersion: Number(runtimeData?.runtimeVersion || 0),
        activeOrderVersion: Number(runtimeData?.activeOrderVersion || 0),
      },
      business: {
        id: businessId,
        collectionName: business.collection,
        businessType: menuSnapshot?.businessType || business.type || businessData?.businessType || 'restaurant',
        name: menuData?.restaurantName || businessData?.name || '',
        logoUrl: menuData?.logoUrl || businessData?.logoUrl || '',
        bannerUrls: menuData?.bannerUrls || businessData?.bannerUrls || [],
        approvalStatus: menuData?.approvalStatus || businessData?.approvalStatus || 'approved',
      },
      menu: menuData,
      delivery: {
        ...publicSettings,
        deliveryCharge: menuData?.deliveryCharge ?? publicSettings?.deliveryCharge ?? 0,
        deliveryFeeType: menuData?.deliveryFeeType ?? 'fixed',
        deliveryFixedFee: menuData?.deliveryFixedFee ?? 0,
        deliveryBaseDistance: menuData?.deliveryBaseDistance ?? 0,
        deliveryPerKmFee: menuData?.deliveryPerKmFee ?? 0,
        deliveryRadius: menuData?.deliveryRadius ?? 0,
        deliveryFreeThreshold: menuData?.deliveryFreeThreshold,
        roadDistanceFactor: menuData?.roadDistanceFactor ?? 1.0,
        freeDeliveryRadius: menuData?.freeDeliveryRadius ?? 0,
        freeDeliveryMinOrder: menuData?.freeDeliveryMinOrder ?? 0,
        deliveryTiers: menuData?.deliveryTiers || [],
        deliveryOrderSlabRules: menuData?.deliveryOrderSlabRules || [],
        deliveryOrderSlabAboveFee: menuData?.deliveryOrderSlabAboveFee || 0,
        deliveryOrderSlabBaseDistance: menuData?.deliveryOrderSlabBaseDistance || 1,
        deliveryOrderSlabPerKmFee: menuData?.deliveryOrderSlabPerKmFee || 15,
        deliveryEngineMode: menuData?.deliveryEngineMode || 'legacy',
        deliveryUseZones: menuData?.deliveryUseZones === true,
        zoneFallbackToLegacy: menuData?.zoneFallbackToLegacy !== false,
        deliveryZones: menuData?.deliveryZones || [],
      },
      customer: customerResult?.found ? customerResult.response : {
        resolved: false,
        name: '',
        phone: '',
        addresses: [],
        isVerified: false,
        isGuest: true,
      },
      activeOrder: activeOrder ? {
        exists: true,
        ...activeOrder,
      } : {
        exists: false,
      },
      legacy: {
        menuData,
        settingsData: publicSettings,
      },
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=0, s-maxage=15, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('[API /public/bootstrap] Error:', error);
    return NextResponse.json({ message: error?.message || 'Failed to build bootstrap payload.' }, { status: error?.status || 500 });
  }
}
