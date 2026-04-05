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
export const MENU_SNAPSHOT_SCHEMA_VERSION = 2;

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

function isStructuredMenuSnapshot(snapshotData = {}) {
  if (!snapshotData || typeof snapshotData !== 'object') return false;
  if (Number(snapshotData.schemaVersion || 0) < MENU_SNAPSHOT_SCHEMA_VERSION) return false;
  if (snapshotData.stale === true) return false;
  if (!snapshotData.business || typeof snapshotData.business !== 'object') return false;
  if (!snapshotData.ordering || typeof snapshotData.ordering !== 'object') return false;
  if (!snapshotData.menu || typeof snapshotData.menu !== 'object') return false;
  return true;
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

function sanitizeMenuItem(itemDoc) {
  const item = itemDoc.data() || {};
  const normalized = {
    id: itemDoc.id,
    name: item.name || '',
    categoryId: item.categoryId || 'general',
    isVeg: Boolean(item.isVeg),
    isAvailable: item.isAvailable !== false,
    order: Number(item.order || 999),
  };

  if (item.description) normalized.description = item.description;
  if (item.imageUrl) normalized.imageUrl = item.imageUrl;
  if (Array.isArray(item.tags) && item.tags.length > 0) normalized.tags = item.tags;
  if (Array.isArray(item.portions) && item.portions.length > 0) normalized.portions = item.portions;
  if (Array.isArray(item.addOnGroups) && item.addOnGroups.length > 0) normalized.addOnGroups = item.addOnGroups;
  if (item.isDineInExclusive === true) normalized.isDineInExclusive = true;

  return normalized;
}

function buildStructuredMenu({ menuDocs = [], customCategories = [], businessType = 'restaurant' }) {
  const categoryConfig = buildCategoryConfig(businessType, customCategories);
  const itemsByCategory = {};

  Object.keys(categoryConfig).forEach((key) => {
    itemsByCategory[key] = [];
  });

  menuDocs.forEach((doc) => {
    const item = doc.data() || {};
    const categoryKey = String(item.categoryId || 'general').trim() || 'general';
    if (categoryKey.toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
    if (!itemsByCategory[categoryKey]) itemsByCategory[categoryKey] = [];
    itemsByCategory[categoryKey].push(sanitizeMenuItem(doc));
  });

  Object.keys(itemsByCategory).forEach((key) => {
    itemsByCategory[key].sort((a, b) => Number(a?.order || 999) - Number(b?.order || 999));
  });

  const customCategoryMap = new Map(
    customCategories.map((category) => [
      category.id,
      {
        id: category.id,
        title: category.title || category.name || category.id,
        order: Number(category.order || 0),
      },
    ])
  );

  const categories = Object.keys(itemsByCategory)
    .filter((key) => itemsByCategory[key]?.length > 0 || customCategoryMap.has(key))
    .map((key, index) => {
      const custom = customCategoryMap.get(key);
      return {
        id: key,
        title: custom?.title || categoryConfig[key]?.title || key,
        order: Number(custom?.order ?? index),
      };
    })
    .sort((a, b) => a.order - b.order);

  return {
    categories,
    itemsByCategory,
  };
}

function buildOrderingPayload({ publicSettings = {}, deliveryConfigState = {}, businessData = {} }) {
  return {
    deliveryEnabled: publicSettings?.deliveryEnabled ?? businessData?.deliveryEnabled ?? true,
    pickupEnabled: publicSettings?.pickupEnabled ?? businessData?.pickupEnabled ?? false,
    dineInEnabled: publicSettings?.dineInEnabled ?? businessData?.dineInEnabled ?? false,
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
      feeModel: deliveryConfigState?.deliveryFeeType ?? businessData?.deliveryFeeType ?? 'fixed',
      baseFee: deliveryConfigState?.deliveryFixedFee ?? businessData?.deliveryFixedFee ?? 30,
      baseDistanceKm: deliveryConfigState?.deliveryBaseDistance ?? businessData?.deliveryBaseDistance ?? 0,
      perKmFee: deliveryConfigState?.deliveryPerKmFee ?? businessData?.deliveryPerKmFee ?? 0,
      radiusKm: deliveryConfigState?.deliveryRadius ?? businessData?.deliveryRadius ?? 5,
      freeAbove: deliveryConfigState?.deliveryFreeThreshold ?? businessData?.deliveryFreeThreshold ?? 500,
      minOrderValue: deliveryConfigState?.minOrderValue ?? businessData?.minOrderValue ?? 0,
      roadDistanceFactor: deliveryConfigState?.roadDistanceFactor ?? businessData?.roadDistanceFactor ?? 1.0,
      freeDeliveryRadius: deliveryConfigState?.freeDeliveryRadius ?? businessData?.freeDeliveryRadius ?? 0,
      freeDeliveryMinOrder: deliveryConfigState?.freeDeliveryMinOrder ?? businessData?.freeDeliveryMinOrder ?? 0,
      deliveryTiers: deliveryConfigState?.deliveryTiers || businessData?.deliveryTiers || [],
      slabs: {
        rules: deliveryConfigState?.deliveryOrderSlabRules || businessData?.deliveryOrderSlabRules || [],
        aboveFee: deliveryConfigState?.deliveryOrderSlabAboveFee ?? businessData?.deliveryOrderSlabAboveFee ?? 0,
        baseDistanceKm: deliveryConfigState?.deliveryOrderSlabBaseDistance ?? businessData?.deliveryOrderSlabBaseDistance ?? 1,
        perKmFee: deliveryConfigState?.deliveryOrderSlabPerKmFee ?? businessData?.deliveryOrderSlabPerKmFee ?? 15,
      },
      engineMode: deliveryConfigState?.deliveryEngineMode ?? businessData?.deliveryEngineMode ?? 'legacy',
      useZones: deliveryConfigState?.deliveryUseZones === true || businessData?.deliveryUseZones === true,
      zoneFallbackToLegacy: deliveryConfigState?.zoneFallbackToLegacy !== false && businessData?.zoneFallbackToLegacy !== false,
      zones: deliveryConfigState?.deliveryZones || businessData?.deliveryZones || [],
    },
  };
}

export function buildLegacyMenuDataFromSnapshot(snapshot = {}) {
  const business = snapshot.business || {};
  const ordering = snapshot.ordering || {};
  const delivery = ordering.delivery || {};
  const menu = snapshot.menu || {};
  return {
    latitude: business.location?.lat ?? null,
    longitude: business.location?.lng ?? null,
    restaurantName: business.name || '',
    approvalStatus: business.approvalStatus || 'approved',
    logoUrl: business.logoUrl || '',
    bannerUrls: business.bannerUrls || [],
    deliveryCharge: delivery.deliveryCharge ?? 0,
    deliveryFixedFee: delivery.baseFee ?? 0,
    deliveryBaseDistance: delivery.baseDistanceKm ?? 0,
    deliveryFreeThreshold: delivery.freeAbove,
    minOrderValue: delivery.minOrderValue ?? 0,
    deliveryFeeType: delivery.feeModel || 'fixed',
    deliveryPerKmFee: delivery.perKmFee ?? 0,
    deliveryRadius: delivery.radiusKm ?? 0,
    roadDistanceFactor: delivery.roadDistanceFactor ?? 1.0,
    freeDeliveryRadius: delivery.freeDeliveryRadius ?? 0,
    freeDeliveryMinOrder: delivery.freeDeliveryMinOrder ?? 0,
    deliveryTiers: delivery.deliveryTiers || [],
    deliveryOrderSlabRules: delivery.slabs?.rules || [],
    deliveryOrderSlabAboveFee: delivery.slabs?.aboveFee || 0,
    deliveryOrderSlabBaseDistance: delivery.slabs?.baseDistanceKm || 1,
    deliveryOrderSlabPerKmFee: delivery.slabs?.perKmFee || 15,
    deliveryEngineMode: delivery.engineMode || 'legacy',
    deliveryUseZones: delivery.useZones === true,
    zoneFallbackToLegacy: delivery.zoneFallbackToLegacy !== false,
    deliveryZones: delivery.zones || [],
    menu: menu.itemsByCategory || {},
    customCategories: menu.categories || [],
    coupons: menu.coupons || [],
    loyaltyPoints: 0,
    deliveryEnabled: ordering.deliveryEnabled ?? true,
    pickupEnabled: ordering.pickupEnabled ?? false,
    dineInEnabled: ordering.dineInEnabled ?? false,
    businessAddress: business.address || null,
    businessType: business.type || 'restaurant',
    dineInModel: ordering.dineInModel || 'post-paid',
    isOpen: business.isOpen === true,
    autoScheduleEnabled: business.hours?.autoScheduleEnabled === true,
    openingTime: business.hours?.opening || '09:00',
    closingTime: business.hours?.closing || '22:00',
    timeZone: business.hours?.timeZone || 'Asia/Kolkata',
  };
}

export function buildLegacySettingsFromSnapshot(snapshot = {}) {
  const ordering = snapshot.ordering || {};
  const charges = ordering.charges || {};
  const delivery = ordering.delivery || {};
  return {
    deliveryEnabled: ordering.deliveryEnabled ?? true,
    pickupEnabled: ordering.pickupEnabled ?? false,
    dineInEnabled: ordering.dineInEnabled ?? false,
    deliveryCodEnabled: ordering.payments?.deliveryCod ?? false,
    deliveryOnlinePaymentEnabled: ordering.payments?.deliveryOnline ?? false,
    pickupOnlinePaymentEnabled: ordering.payments?.pickupOnline ?? false,
    pickupPodEnabled: ordering.payments?.pickupPod ?? false,
    dineInOnlinePaymentEnabled: ordering.payments?.dineInOnline ?? false,
    dineInPayAtCounterEnabled: ordering.payments?.dineInPayAtCounter ?? false,
    deliveryCharge: delivery.deliveryCharge ?? 0,
    deliveryFreeThreshold: delivery.freeAbove,
    gstEnabled: charges.gst?.enabled ?? false,
    gstRate: charges.gst?.rate ?? 0,
    gstPercentage: charges.gst?.rate ?? 0,
    gstMinAmount: charges.gst?.minAmount ?? 0,
    gstCalculationMode: charges.gst?.mode ?? 'excluded',
    gstIncludedInPrice: charges.gst?.includedInPrice ?? false,
    convenienceFeeEnabled: charges.convenience?.enabled ?? false,
    convenienceFeeRate: charges.convenience?.rate ?? 0,
    convenienceFeePaidBy: charges.convenience?.paidBy || 'customer',
    convenienceFeeLabel: charges.convenience?.label || 'Payment Processing Fee',
    packagingChargeEnabled: charges.packaging?.enabled ?? false,
    packagingChargeAmount: charges.packaging?.amount ?? 0,
    serviceFeeEnabled: charges.serviceFee?.enabled ?? false,
    serviceFeeLabel: charges.serviceFee?.label || 'Additional Charge',
    serviceFeeType: charges.serviceFee?.type || 'fixed',
    serviceFeeValue: charges.serviceFee?.value ?? 0,
    serviceFeeApplyOn: charges.serviceFee?.applyOn || 'all',
  };
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
  const menuDocs = menuSnap.docs.filter((doc) => doc.data()?.isDeleted !== true);
  const structuredMenu = buildStructuredMenu({
    menuDocs,
    customCategories,
    businessType: normalizedBusinessType,
  });
  const ordering = buildOrderingPayload({ publicSettings, deliveryConfigState, businessData });
  const structuredPayload = {
    business: {
      id: businessId,
      type: normalizedBusinessType,
      name: businessData?.name || '',
      approvalStatus: businessData?.approvalStatus || 'approved',
      logoUrl: businessData?.logoUrl || '',
      bannerUrls: businessData?.bannerUrls || [],
      isOpen: effectiveIsOpen,
      location: {
        lat: businessData?.coordinates?.lat ?? businessData?.address?.latitude ?? businessData?.businessAddress?.latitude ?? null,
        lng: businessData?.coordinates?.lng ?? businessData?.address?.longitude ?? businessData?.businessAddress?.longitude ?? null,
      },
      address: businessData?.address || null,
      hours: {
        opening: businessData?.openingTime || '09:00',
        closing: businessData?.closingTime || '22:00',
        timeZone: businessData?.timeZone || businessData?.timezone || 'Asia/Kolkata',
        autoScheduleEnabled: businessData?.autoScheduleEnabled === true,
      },
    },
    ordering,
    menu: {
      ...structuredMenu,
      coupons: publicCoupons,
      meta: {
        currency: businessData?.currency || 'INR',
      },
    },
  };

  return {
    businessId,
    collectionName,
    businessType: normalizedBusinessType,
    schemaVersion: MENU_SNAPSHOT_SCHEMA_VERSION,
    menuVersion: Number(businessData?.menuVersion || 0),
    generatedAt: new Date().toISOString(),
    stale: false,
    ...structuredPayload,
    couponCatalog: allCouponDocs,
    hash: buildMenuHash({
      menuVersion: Number(businessData?.menuVersion || 0),
      structuredPayload,
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

  invalidateSharedCache(`menu-snapshot:${businessId}`, { prefixMatch: true });
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
  businessRef: providedBusinessRef = null,
  businessData: providedBusinessData = null,
} = {}) {
  const firestore = providedFirestore || await getFirestore();

  // Reuse pre-resolved business if provided — avoids a redundant findBusinessById call
  let businessRef = providedBusinessRef;
  let businessData = providedBusinessData;
  let businessCollection = collectionNameHint;

  if (!businessRef || !businessData) {
    const business = await findBusinessById(firestore, businessId, {
      collectionNameHint,
      includeDeliverySettings: false,
    });
    if (!business?.ref) return null;
    businessRef = business.ref;
    businessData = business.data || {};
    businessCollection = business.collection;
  }

  // Cache business runtime to avoid repeated Firestore reads across concurrent requests
  const runtimeCacheKey = `business-runtime:${businessId}`;
  const runtimeData = await getOrSetSharedCache(runtimeCacheKey, {
    ttlMs: 30 * 1000,
    kvTtlSec: 60,
    compute: () => getBusinessRuntime(businessRef),
  });

  const snapshotEnabled = resolveScopedFeatureFlagValue('menu_snapshot_enabled', {
    businessData,
    runtimeData,
    envDefault: FEATURE_FLAGS.USE_MENU_SNAPSHOT,
  });
  if (!snapshotEnabled) return null;

  return getOrSetSharedCache(`menu-snapshot:${businessId}:v${Number(businessData?.menuVersion || 0)}`, {
    ttlMs: 60 * 1000,
    kvTtlSec: 24 * 60 * 60, // 24 hours TTL, cache key changes instantly upon menu mutation
    compute: async () => {
      const snapshotSnap = await getMenuSnapshotRef(businessRef).get();
      const snapshotData = snapshotSnap.exists ? (snapshotSnap.data() || null) : null;

      if (isStructuredMenuSnapshot(snapshotData)) {
        return snapshotData;
      }

      if (!allowInlineRebuild) {
        await markMenuSnapshotStale({
          businessRef,
          businessId,
          collectionName: businessCollection,
          reason: snapshotData ? 'stale_or_legacy_snapshot' : 'missing_snapshot',
          targetMenuVersion: currentMenuVersion,
        });
        return snapshotData;
      }

      return rebuildMenuSnapshot({
        firestore,
        businessId,
        businessRef,
        businessData,
        collectionNameHint: businessCollection,
      });
    },
  });
}
