import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { getDecodedAuthContext, getFirestore } from '@/lib/firebase-admin';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { getPublicSettings, buildPublicSettingsFromData } from '@/services/business/publicSettings.service';
import { findBusinessById } from '@/services/business/businessService';
import { resolveCustomerLookupProfile } from '@/services/customer/customerLookup.service';
import { resolveActiveOrdersForCustomerContext } from '@/services/order/activeOrderLookup.service';
import { enforceRateLimit, readSignedGuestSessionCookie, verifyAppCheckToken } from '@/lib/public-auth';
import { getBusinessRuntime, resolveScopedFeatureFlagValue } from '@/lib/server/businessRuntime';
import { getFreshMenuSnapshot } from '@/lib/server/menuSnapshot';
import { getOrSetSharedCache } from '@/lib/server/sharedCache';
import { filterCouponsForAudience, resolveCouponAudienceContext } from '@/lib/server/couponEligibility';

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

    // Cache business runtime (30s L1, 60s KV) — avoids repeated reads on warm instances
    const runtimeData = await getOrSetSharedCache(`business-runtime:${businessId}`, {
      ttlMs: 30 * 1000,
      kvTtlSec: 60,
      compute: () => getBusinessRuntime(business.ref),
    });

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
        businessRef: business.ref,
        businessData: businessData,
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

    const publicSettings = menuSnapshot ? null : buildPublicSettingsFromData(businessData);
    const activeOrder = Array.isArray(activeOrderResult?.activeOrders) ? activeOrderResult.activeOrders[0] || null : null;

    const businessPayload = menuSnapshot?.business || {
      id: businessId,
      type: business.type || businessData?.businessType || 'restaurant',
      name: businessData?.name || '',
      logoUrl: businessData?.logoUrl || '',
      bannerUrls: businessData?.bannerUrls || [],
      approvalStatus: businessData?.approvalStatus || 'approved',
      isOpen: true,
      location: {
        lat: businessData?.coordinates?.lat ?? null,
        lng: businessData?.coordinates?.lng ?? null,
      },
      address: businessData?.address || null,
      hours: {
        opening: businessData?.openingTime || '09:00',
        closing: businessData?.closingTime || '22:00',
        timeZone: businessData?.timeZone || businessData?.timezone || 'Asia/Kolkata',
        autoScheduleEnabled: businessData?.autoScheduleEnabled === true,
      },
    };
    const orderingPayload = menuSnapshot?.ordering || {
      deliveryEnabled: publicSettings?.deliveryEnabled ?? true,
      pickupEnabled: publicSettings?.pickupEnabled ?? false,
      dineInEnabled: publicSettings?.dineInEnabled ?? false,
      dineInModel: businessData?.dineInModel || 'post-paid',
      payments: {
        deliveryCod: publicSettings?.deliveryCodEnabled ?? false,
        deliveryOnline: publicSettings?.deliveryOnlinePaymentEnabled ?? false,
        pickupOnline: publicSettings?.pickupOnlinePaymentEnabled ?? false,
        pickupPod: publicSettings?.pickupPodEnabled ?? false,
        dineInOnline: publicSettings?.dineInOnlinePaymentEnabled ?? false,
        dineInPayAtCounter: publicSettings?.dineInPayAtCounterEnabled ?? false,
      },
      charges: {
        gst: {
          enabled: publicSettings?.gstEnabled ?? false,
          rate: publicSettings?.gstRate ?? publicSettings?.gstPercentage ?? 0,
          minAmount: publicSettings?.gstMinAmount ?? 0,
          mode: publicSettings?.gstCalculationMode ?? 'excluded',
          includedInPrice: publicSettings?.gstIncludedInPrice ?? false,
        },
        serviceFee: {
          enabled: publicSettings?.serviceFeeEnabled ?? false,
          label: publicSettings?.serviceFeeLabel || 'Additional Charge',
          type: publicSettings?.serviceFeeType || 'fixed',
          value: publicSettings?.serviceFeeValue ?? 0,
          applyOn: publicSettings?.serviceFeeApplyOn || 'all',
        },
        packaging: {
          enabled: publicSettings?.packagingChargeEnabled ?? false,
          amount: publicSettings?.packagingChargeAmount ?? 0,
        },
        convenience: {
          enabled: publicSettings?.convenienceFeeEnabled ?? false,
          rate: publicSettings?.convenienceFeeRate ?? 0,
          paidBy: publicSettings?.convenienceFeePaidBy || 'customer',
          label: publicSettings?.convenienceFeeLabel || 'Payment Processing Fee',
        },
      },
      delivery: {
        deliveryCharge: publicSettings?.deliveryCharge ?? 0,
        feeModel: 'fixed',
        baseFee: 0,
        baseDistanceKm: 0,
        perKmFee: 0,
        radiusKm: 0,
        freeAbove: 0,
        minOrderValue: 0,
        roadDistanceFactor: 1,
        freeDeliveryRadius: 0,
        freeDeliveryMinOrder: 0,
        deliveryTiers: [],
        slabs: {
          rules: [],
          aboveFee: 0,
          baseDistanceKm: 1,
          perKmFee: 15,
        },
        engineMode: 'legacy',
        useZones: false,
        zoneFallbackToLegacy: true,
        zones: [],
      },
    };
    const couponCatalog = Array.isArray(menuSnapshot?.couponCatalog) ? menuSnapshot.couponCatalog : [];
    const hasAssignedCoupons = couponCatalog.some((coupon) => String(coupon?.customerId || '').trim());
    const couponAudience = hasAssignedCoupons || couponCatalog.some((coupon) => Array.isArray(coupon?.orderMilestones) && coupon.orderMilestones.length > 0)
      ? await resolveCouponAudienceContext({
          firestore,
          businessRef: business.ref,
          phone,
          ref,
          actorUid: customerResult?.actorUid || loggedInUid || '',
        })
      : { eligibleIds: new Set(), nextOrderNumber: 0 };
    const personalizedCoupons = couponCatalog.length > 0
      ? filterCouponsForAudience(couponCatalog, {
          now: new Date(),
          eligibleIds: couponAudience.eligibleIds,
          redemptionKeys: couponAudience.redemptionKeys,
          nextOrderNumber: couponAudience.nextOrderNumber,
        })
      : (menuSnapshot?.menu?.coupons || []);

    const menuPayload = menuSnapshot?.menu ? {
      ...menuSnapshot.menu,
      coupons: personalizedCoupons,
    } : {
      categories: [],
      itemsByCategory: {},
      coupons: [],
      meta: { currency: 'INR' },
    };

    return NextResponse.json({
      ok: true,
      schemaVersion: Number(menuSnapshot?.schemaVersion || 2),
      generatedAt: new Date().toISOString(),
      versions: {
        menu: Number(menuSnapshot?.menuVersion || businessData?.menuVersion || 0),
        runtimeVersion: Number(runtimeData?.runtimeVersion || 0),
        activeOrderVersion: Number(runtimeData?.activeOrderVersion || 0),
      },
      business: businessPayload,
      ordering: orderingPayload,
      menu: menuPayload,
      user: {
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
