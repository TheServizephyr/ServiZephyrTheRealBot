import { createHash } from 'crypto';

import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { findBusinessById } from '@/services/business/businessService';
import { getPublicSettings } from '@/services/business/publicSettings.service';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';
import { bumpBusinessRuntimeVersions, getBusinessRuntime, resolveScopedFeatureFlagValue, setBusinessRuntimeFlags } from '@/lib/server/businessRuntime';
import { enqueueDerivedJob } from '@/lib/server/derivedJobs';
import { getOrSetSharedCache, invalidateSharedCache } from '@/lib/server/sharedCache';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const MENU_SNAPSHOT_COLLECTION = 'menu_snapshot';
export const MENU_SNAPSHOT_DOC_ID = 'current';

const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';

const RESTAURANT_CATEGORY_CONFIG = {
  starters: { title: 'Starters' },
  'main-course': { title: 'Main Course' },
  beverages: { title: 'Beverages' },
  desserts: { title: 'Desserts' },
  soup: { title: 'Soup' },
  'tandoori-item': { title: 'Tandoori Items' },
  momos: { title: 'Momos' },
  burgers: { title: 'Burgers' },
  rolls: { title: 'Rolls' },
  'tandoori-khajana': { title: 'Tandoori Khajana' },
  rice: { title: 'Rice' },
  noodles: { title: 'Noodles' },
  pasta: { title: 'Pasta' },
  raita: { title: 'Raita' },
  snacks: { title: 'Snacks' },
  chaat: { title: 'Chaat' },
  sweets: { title: 'Sweets' },
};

const SHOP_CATEGORY_CONFIG = {
  electronics: { title: 'Electronics' },
  groceries: { title: 'Groceries' },
  clothing: { title: 'Clothing' },
  books: { title: 'Books' },
  'home-appliances': { title: 'Home Appliances' },
  'toys-games': { title: 'Toys & Games' },
  'beauty-personal-care': { title: 'Beauty & Personal Care' },
  'sports-outdoors': { title: 'Sports & Outdoors' },
};

function normalizeBusinessType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street_vendor' || normalized === 'street-vendor') return 'street-vendor';
  return 'restaurant';
}

export function getMenuSnapshotRef(businessRef) {
  return businessRef.collection(MENU_SNAPSHOT_COLLECTION).doc(MENU_SNAPSHOT_DOC_ID);
}

function buildMenuHash(payload) {
  return createHash('sha256')
    .update(JSON.stringify(payload || {}))
    .digest('hex');
}

function filterCouponsForPublicRequest(couponDocs = [], now = new Date()) {
  return couponDocs.filter((coupon) => {
    const assignedCustomerId = String(coupon?.customerId || '').trim();
    if (assignedCustomerId) return false;
    const status = String(coupon?.status || '').trim().toLowerCase();
    const startDate = coupon?.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon?.startDate);
    const expiryDate = coupon?.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon?.expiryDate);
    return (
      status === 'active' &&
      startDate instanceof Date &&
      !Number.isNaN(startDate.getTime()) &&
      expiryDate instanceof Date &&
      !Number.isNaN(expiryDate.getTime()) &&
      startDate <= now &&
      expiryDate >= now
    );
  });
}

function buildCategoryConfig(businessType, customCategories = []) {
  const base = {
    ...(businessType === 'restaurant' || businessType === 'street-vendor'
      ? RESTAURANT_CATEGORY_CONFIG
      : SHOP_CATEGORY_CONFIG),
  };

  customCategories.forEach((cat) => {
    if (!base[cat.id]) {
      base[cat.id] = { title: cat.title };
    }
  });

  return base;
}

function buildMenuData({ menuDocs = [], customCategories = [], businessType = 'restaurant' }) {
  const categoryConfig = buildCategoryConfig(businessType, customCategories);
  const menuData = {};

  Object.keys(categoryConfig).forEach((key) => {
    menuData[key] = [];
  });

  menuDocs.forEach((doc) => {
    const item = doc.data() || {};
    const categoryKey = String(item.categoryId || 'general').trim() || 'general';
    if (categoryKey.toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
    if (!menuData[categoryKey]) menuData[categoryKey] = [];
    menuData[categoryKey].push({
      id: doc.id,
      ...item,
    });
  });

  Object.keys(menuData).forEach((key) => {
    menuData[key].sort((a, b) => Number(a?.order || 999) - Number(b?.order || 999));
  });

  return menuData;
}

export async function buildMenuSnapshotPayload({
  firestore,
  businessRef,
  businessId,
  collectionName,
  businessData,
} = {}) {
  const [menuSnap, couponsSnap, customCategoriesSnap, deliveryConfigSnap, publicSettings] = await Promise.all([
    businessRef.collection('menu').get(),
    businessRef.collection('coupons').where('status', '==', 'active').get(),
    businessRef.collection('custom_categories').orderBy('order', 'asc').get(),
    businessRef.collection('delivery_settings').doc('config').get(),
    getPublicSettings(firestore, businessId),
  ]);

  const normalizedBusinessType = normalizeBusinessType(
    businessData?.businessType || collectionName?.slice(0, -1) || 'restaurant'
  );
  const customCategories = customCategoriesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const allCouponDocs = couponsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const publicCoupons = filterCouponsForPublicRequest(allCouponDocs, new Date());
  const deliveryConfigState = deliveryConfigSnap.exists ? (deliveryConfigSnap.data() || {}) : {};
  const effectiveIsOpen = getEffectiveBusinessOpenStatus(businessData || {});
  const menuData = buildMenuData({
    menuDocs: menuSnap.docs.filter((doc) => doc.data()?.isDeleted !== true),
    customCategories,
    businessType: normalizedBusinessType,
  });

  const publicMenuPayload = {
    latitude: businessData?.coordinates?.lat ?? businessData?.address?.latitude ?? businessData?.businessAddress?.latitude ?? null,
    longitude: businessData?.coordinates?.lng ?? businessData?.address?.longitude ?? businessData?.businessAddress?.longitude ?? null,
    restaurantName: businessData?.name || '',
    approvalStatus: businessData?.approvalStatus || 'approved',
    logoUrl: businessData?.logoUrl || '',
    bannerUrls: businessData?.bannerUrls || [],
    deliveryCharge: publicSettings?.deliveryCharge ?? 0,
    deliveryFixedFee: deliveryConfigState?.deliveryFixedFee ?? businessData?.deliveryFixedFee ?? 30,
    deliveryBaseDistance: deliveryConfigState?.deliveryBaseDistance ?? businessData?.deliveryBaseDistance ?? 0,
    deliveryFreeThreshold: deliveryConfigState?.deliveryFreeThreshold ?? businessData?.deliveryFreeThreshold ?? 500,
    minOrderValue: deliveryConfigState?.minOrderValue ?? businessData?.minOrderValue ?? 0,
    deliveryFeeType: deliveryConfigState?.deliveryFeeType ?? businessData?.deliveryFeeType ?? 'fixed',
    deliveryPerKmFee: deliveryConfigState?.deliveryPerKmFee ?? businessData?.deliveryPerKmFee ?? 0,
    deliveryRadius: deliveryConfigState?.deliveryRadius ?? businessData?.deliveryRadius ?? 5,
    roadDistanceFactor: deliveryConfigState?.roadDistanceFactor ?? businessData?.roadDistanceFactor ?? 1.0,
    freeDeliveryRadius: deliveryConfigState?.freeDeliveryRadius ?? businessData?.freeDeliveryRadius ?? 0,
    freeDeliveryMinOrder: deliveryConfigState?.freeDeliveryMinOrder ?? businessData?.freeDeliveryMinOrder ?? 0,
    deliveryTiers: deliveryConfigState?.deliveryTiers || businessData?.deliveryTiers || [],
    deliveryOrderSlabRules: deliveryConfigState?.deliveryOrderSlabRules || businessData?.deliveryOrderSlabRules || [],
    deliveryOrderSlabAboveFee: deliveryConfigState?.deliveryOrderSlabAboveFee ?? businessData?.deliveryOrderSlabAboveFee ?? 0,
    deliveryOrderSlabBaseDistance: deliveryConfigState?.deliveryOrderSlabBaseDistance ?? businessData?.deliveryOrderSlabBaseDistance ?? 1,
    deliveryOrderSlabPerKmFee: deliveryConfigState?.deliveryOrderSlabPerKmFee ?? businessData?.deliveryOrderSlabPerKmFee ?? 15,
    deliveryEngineMode: deliveryConfigState?.deliveryEngineMode ?? businessData?.deliveryEngineMode ?? 'legacy',
    deliveryUseZones: deliveryConfigState?.deliveryUseZones === true || businessData?.deliveryUseZones === true,
    zoneFallbackToLegacy: deliveryConfigState?.zoneFallbackToLegacy !== false && businessData?.zoneFallbackToLegacy !== false,
    deliveryZones: deliveryConfigState?.deliveryZones || businessData?.deliveryZones || [],
    menu: menuData,
    customCategories,
    coupons: publicCoupons,
    loyaltyPoints: 0,
    deliveryEnabled: publicSettings?.deliveryEnabled ?? businessData?.deliveryEnabled,
    pickupEnabled: publicSettings?.pickupEnabled ?? businessData?.pickupEnabled,
    dineInEnabled: publicSettings?.dineInEnabled ?? businessData?.dineInEnabled,
    businessAddress: businessData?.address || null,
    businessType: normalizedBusinessType,
    collectionName,
    dineInModel: businessData?.dineInModel || 'post-paid',
    isOpen: effectiveIsOpen,
    autoScheduleEnabled: businessData?.autoScheduleEnabled === true,
    openingTime: businessData?.openingTime || '09:00',
    closingTime: businessData?.closingTime || '22:00',
    timeZone: businessData?.timeZone || businessData?.timezone || 'Asia/Kolkata',
  };

  return {
    businessId,
    collectionName,
    businessType: normalizedBusinessType,
    menuVersion: Number(businessData?.menuVersion || 0),
    generatedAt: new Date().toISOString(),
    stale: false,
    business: {
      id: businessId,
      collectionName,
      businessType: normalizedBusinessType,
      name: businessData?.name || '',
      approvalStatus: businessData?.approvalStatus || 'approved',
      logoUrl: businessData?.logoUrl || '',
      bannerUrls: businessData?.bannerUrls || [],
      botDisplayNumber: businessData?.botDisplayNumber || '',
    },
    publicSettings,
    deliveryConfig: {
      exists: deliveryConfigSnap.exists,
      data: deliveryConfigState,
    },
    couponCatalog: allCouponDocs,
    publicMenuPayload,
    hash: buildMenuHash({
      menuVersion: Number(businessData?.menuVersion || 0),
      publicSettings,
      deliveryConfigState,
      couponCatalog: allCouponDocs,
      publicMenuPayload,
    }),
  };
}

export async function rebuildMenuSnapshot({
  firestore: providedFirestore = null,
  businessId,
  collectionNameHint = null,
  businessRef: providedBusinessRef = null,
  businessData: providedBusinessData = null,
} = {}) {
  const firestore = providedFirestore || await getFirestore();
  let businessRef = providedBusinessRef;
  let businessData = providedBusinessData;
  let collectionName = collectionNameHint;

  if (!businessRef || !businessData || !collectionName) {
    const business = await findBusinessById(firestore, businessId, {
      collectionNameHint,
      includeDeliverySettings: false,
    });
    if (!business?.ref) {
      throw new Error(`Business not found for menu snapshot rebuild: ${businessId}`);
    }
    businessRef = business.ref;
    businessData = business.data || {};
    collectionName = business.collection;
  }

  const snapshotPayload = await buildMenuSnapshotPayload({
    firestore,
    businessRef,
    businessId,
    collectionName,
    businessData,
  });

  const snapshotRef = getMenuSnapshotRef(businessRef);
  await snapshotRef.set({
    ...snapshotPayload,
    version: Number(snapshotPayload.menuVersion || 0),
    stale: false,
    updatedAt: new Date(),
  }, { merge: true });

  await setBusinessRuntimeFlags(businessRef, {
    menuVersion: Number(snapshotPayload.menuVersion || 0),
    snapshotQueued: false,
    lastSnapshotGeneratedAt: new Date(),
  });

  invalidateSharedCache(`menu-snapshot:${businessId}`);
  return snapshotPayload;
}

export async function markMenuSnapshotStale({
  businessRef,
  businessId,
  collectionName,
  reason = 'mutation',
  targetMenuVersion = null,
} = {}) {
  const firestore = await getFirestore();
  const businessSnap = await businessRef.get();
  const businessData = businessSnap.exists ? (businessSnap.data() || {}) : {};
  const safeTargetVersion = Number.isFinite(Number(targetMenuVersion))
    ? Number(targetMenuVersion)
    : Number(businessData?.menuVersion || 0);

  await getMenuSnapshotRef(businessRef).set({
    stale: true,
    invalidatedAt: new Date(),
    invalidationReason: reason,
    targetMenuVersion: safeTargetVersion,
  }, { merge: true });

  await setBusinessRuntimeFlags(businessRef, {
    menuVersion: safeTargetVersion,
    snapshotQueued: true,
  });

  await enqueueDerivedJob({
    type: 'snapshot_rebuild',
    jobKey: `snapshot_rebuild:${businessId}:v${safeTargetVersion}`,
    payload: {
      businessId,
      collectionName,
      targetMenuVersion: safeTargetVersion,
      reason,
    },
  });
}

export async function getFreshMenuSnapshot({
  firestore: providedFirestore = null,
  businessId,
  collectionNameHint = null,
  allowInlineRebuild = true,
} = {}) {
  const firestore = providedFirestore || await getFirestore();
  const business = await findBusinessById(firestore, businessId, {
    collectionNameHint,
    includeDeliverySettings: false,
  });
  if (!business?.ref) return null;

  const businessData = business.data || {};
  const runtimeData = await getBusinessRuntime(business.ref);
  const snapshotEnabled = resolveScopedFeatureFlagValue('menu_snapshot_enabled', {
    businessData,
    runtimeData,
    envDefault: FEATURE_FLAGS.USE_MENU_SNAPSHOT,
  });
  if (!snapshotEnabled) return null;

  return getOrSetSharedCache(`menu-snapshot:${businessId}:v${Number(businessData?.menuVersion || 0)}`, {
    ttlMs: 60 * 1000,
    kvTtlSec: 5 * 60,
    compute: async () => {
      const snapshotSnap = await getMenuSnapshotRef(business.ref).get();
      const snapshotData = snapshotSnap.exists ? (snapshotSnap.data() || null) : null;
      const currentMenuVersion = Number(businessData?.menuVersion || 0);

      if (
        snapshotData &&
        snapshotData.stale !== true &&
        Number(snapshotData.menuVersion || 0) === currentMenuVersion
      ) {
        return snapshotData;
      }

      if (!allowInlineRebuild) {
        await markMenuSnapshotStale({
          businessRef: business.ref,
          businessId,
          collectionName: business.collection,
          reason: snapshotData ? 'stale_snapshot' : 'missing_snapshot',
          targetMenuVersion: currentMenuVersion,
        });
        return snapshotData;
      }

      return rebuildMenuSnapshot({
        firestore,
        businessId,
        businessRef: business.ref,
        businessData,
        collectionNameHint: business.collection,
      });
    },
  });
}
