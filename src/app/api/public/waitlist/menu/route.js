import crypto from 'crypto';
import { NextResponse } from 'next/server';

import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';
import { enforceRateLimit, verifyAppCheckToken } from '@/lib/public-auth';
import { buildLegacyMenuDataFromSnapshot, getFreshMenuSnapshot } from '@/lib/server/menuSnapshot';
import { getOrSetSharedCache } from '@/lib/server/sharedCache';
import { trackEndpointRead } from '@/lib/readTelemetry';

export const dynamic = 'force-dynamic';

const ACTIVE_EXPLORATION_STATUSES = new Set(['pending', 'ready_to_notify', 'notified', 'arrived']);
const RESERVED_OPEN_ITEMS_CATEGORY_ID = 'open-items';
const WISHLIST_QUALIFYING_THRESHOLD = 20;
const MAX_FEATURED_WISHLISTED_ITEMS = 7;
const WISHLIST_LOCAL_TTL_MS = 12 * 60 * 60 * 1000;

function getClientIp(req) {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

function normalizeBusinessType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street_vendor' || normalized === 'street-vendor') return 'street-vendor';
    return normalized || 'restaurant';
}

function safeTextEquals(left, right) {
    const leftText = String(left || '');
    const rightText = String(right || '');
    const leftBuffer = Buffer.from(leftText);
    const rightBuffer = Buffer.from(rightText);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getWishlistLocalExpiry(nowMs = Date.now()) {
    return new Date(nowMs + WISHLIST_LOCAL_TTL_MS);
}

const noStoreJson = (body, init = {}) => NextResponse.json(body, {
    ...init,
    headers: {
        ...(init.headers || {}),
        'Cache-Control': 'private, no-store, max-age=0',
    },
});

async function loadVerifiedWaitlistContext({ firestore, restaurantId, entryId, arrivalCode }) {
    const businessRef = firestore.collection('restaurants').doc(restaurantId);
    const entryRef = businessRef.collection('waitlist').doc(entryId);
    const [businessSnap, entrySnap] = await Promise.all([
        businessRef.get(),
        entryRef.get(),
    ]);

    if (!businessSnap.exists) {
        return { error: noStoreJson({ message: 'Restaurant not found.' }, { status: 404 }) };
    }
    if (!entrySnap.exists) {
        return { error: noStoreJson({ message: 'Waitlist entry not found.' }, { status: 404 }) };
    }

    const businessData = businessSnap.data() || {};
    const businessType = normalizeBusinessType(businessData.businessType || 'restaurant');
    if (businessType !== 'restaurant') {
        return { error: noStoreJson({ message: 'Waitlist menu exploration is only available for restaurants.' }, { status: 403 }) };
    }
    if (businessData.isWaitlistEnabled !== true || businessData.waitlistMenuExploreEnabled !== true) {
        return { error: noStoreJson({ message: 'Menu exploration is not enabled for this waitlist.' }, { status: 403 }) };
    }

    const entryData = entrySnap.data() || {};
    const storedCode = String(entryData.arrivalCode || '').trim().toUpperCase();
    const status = String(entryData.status || 'pending').trim().toLowerCase();
    if (!storedCode || !safeTextEquals(storedCode, arrivalCode)) {
        return { error: noStoreJson({ message: 'Invalid arrival code.' }, { status: 403 }) };
    }
    if (!ACTIVE_EXPLORATION_STATUSES.has(status)) {
        return { error: noStoreJson({ message: 'This waitlist token is no longer eligible for menu exploration.' }, { status: 403 }) };
    }

    return { businessRef, businessData, entryRef, entryData, status };
}

function normalizePortions(item = {}) {
    if (Array.isArray(item.portions) && item.portions.length > 0) {
        return item.portions
            .map((portion) => ({
                name: String(portion?.name || 'Regular').trim() || 'Regular',
                price: Number(portion?.price ?? item?.price ?? 0) || 0,
            }))
            .filter((portion) => portion.name && Number.isFinite(Number(portion.price)));
    }

    const fallbackPrice = Number(item?.price ?? 0);
    return [{ name: 'Regular', price: Number.isFinite(fallbackPrice) ? fallbackPrice : 0 }];
}

function sanitizeMenuDoc(doc) {
    const item = doc.data() || {};
    const categoryId = String(item.categoryId || 'general').trim() || 'general';
    const sanitized = {
        id: doc.id,
        name: String(item.name || '').trim(),
        description: String(item.description || '').trim(),
        categoryId,
        isVeg: item.isVeg === true,
        isAvailable: item.isAvailable !== false,
        imageUrl: String(item.imageUrl || '').trim(),
        portions: normalizePortions(item),
        order: Number(item.order || 999),
    };

    if (Array.isArray(item.tags)) sanitized.tags = item.tags;
    if (Array.isArray(item.addOnGroups)) sanitized.addOnGroups = item.addOnGroups;
    if (item.isDineInExclusive === true) sanitized.isDineInExclusive = true;

    return sanitized;
}

function countMenuItems(menuData = {}) {
    const menu = menuData?.menu || {};
    return Object.entries(menu).reduce((count, [categoryId, items]) => {
        if (String(categoryId || '').toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) return count;
        if (!Array.isArray(items)) return count;
        return count + items.filter((item) => String(item?.name || '').trim()).length;
    }, 0);
}

function sanitizeMenuPayloadItem(item = {}, wishlistSummary = {}) {
    const categoryId = String(item.categoryId || 'general').trim() || 'general';
    const itemId = String(item.id || '').trim();
    const wishlistCount = Number(wishlistSummary?.counts?.[itemId] || 0);
    const featuredItemIds = new Set(Array.isArray(wishlistSummary?.featuredItemIds) ? wishlistSummary.featuredItemIds.map(String) : []);
    const sanitized = {
        id: itemId,
        name: String(item.name || '').trim(),
        description: String(item.description || '').trim(),
        categoryId,
        isVeg: item.isVeg === true,
        isAvailable: item.isAvailable !== false,
        imageUrl: String(item.imageUrl || '').trim(),
        portions: normalizePortions(item),
        order: Number(item.order || 999),
        isMostWishlisted: featuredItemIds.has(itemId) && wishlistCount >= WISHLIST_QUALIFYING_THRESHOLD,
    };
    if (sanitized.isMostWishlisted) sanitized.wishlistCount = wishlistCount;

    if (Array.isArray(item.tags)) {
        sanitized.tags = item.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 12);
    }
    if (Array.isArray(item.addOnGroups)) {
        sanitized.addOnGroups = item.addOnGroups.slice(0, 12).map((group) => ({
            name: String(group?.name || group?.title || '').trim(),
            options: Array.isArray(group?.options)
                ? group.options.slice(0, 30).map((option) => ({
                    name: String(option?.name || option?.label || '').trim(),
                    price: Number(option?.price || 0) || 0,
                })).filter((option) => option.name)
                : [],
        })).filter((group) => group.name || group.options.length > 0);
    }
    if (item.isDineInExclusive === true) sanitized.isDineInExclusive = true;

    return sanitized;
}

function sanitizeExploreMenuData(menuData = {}, wishlistSummary = {}) {
    const rawMenu = menuData?.menu && typeof menuData.menu === 'object' ? menuData.menu : {};
    const menu = {};

    Object.entries(rawMenu).forEach(([categoryId, items]) => {
        const safeCategoryId = String(categoryId || 'general').trim() || 'general';
        if (safeCategoryId.toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
        if (!Array.isArray(items)) return;
        const safeItems = items
            .map((item) => sanitizeMenuPayloadItem(item, wishlistSummary))
            .filter((item) => item.id && item.name)
            .sort((a, b) => Number(a?.order || 999) - Number(b?.order || 999));
        if (safeItems.length > 0) menu[safeCategoryId] = safeItems;
    });

    return {
        restaurantName: String(menuData.restaurantName || 'Restaurant').trim() || 'Restaurant',
        approvalStatus: String(menuData.approvalStatus || 'approved').trim() || 'approved',
        logoUrl: String(menuData.logoUrl || '').trim(),
        bannerUrls: Array.isArray(menuData.bannerUrls) ? menuData.bannerUrls.map((url) => String(url || '').trim()).filter(Boolean).slice(0, 12) : [],
        menu,
        customCategories: Array.isArray(menuData.customCategories)
            ? menuData.customCategories.map((category) => ({
                id: String(category?.id || '').trim(),
                title: String(category?.title || category?.name || '').trim(),
                order: Number(category?.order || 0) || 0,
            })).filter((category) => category.id)
            : [],
        businessType: 'restaurant',
        isOpen: menuData.isOpen === true,
        autoScheduleEnabled: menuData.autoScheduleEnabled === true,
        openingTime: String(menuData.openingTime || '09:00').trim() || '09:00',
        closingTime: String(menuData.closingTime || '22:00').trim() || '22:00',
        timeZone: String(menuData.timeZone || 'Asia/Kolkata').trim() || 'Asia/Kolkata',
    };
}

async function loadWishlistSummary(businessRef) {
    try {
        const snap = await businessRef
            .collection('waitlist_menu_wishlist_stats')
            .where('count', '>=', WISHLIST_QUALIFYING_THRESHOLD)
            .orderBy('count', 'desc')
            .limit(MAX_FEATURED_WISHLISTED_ITEMS)
            .get();

        const counts = {};
        const featuredItemIds = [];
        snap.docs.forEach((doc) => {
            const count = Math.max(0, Number(doc.data()?.count || 0));
            if (count < WISHLIST_QUALIFYING_THRESHOLD) return;
            counts[doc.id] = count;
            featuredItemIds.push(doc.id);
        });

        return {
            threshold: WISHLIST_QUALIFYING_THRESHOLD,
            maxFeaturedItems: MAX_FEATURED_WISHLISTED_ITEMS,
            countMode: 'all_time',
            savedListTtlHours: WISHLIST_LOCAL_TTL_MS / (60 * 60 * 1000),
            featuredItemIds,
            counts,
        };
    } catch (error) {
        console.warn('[waitlist/menu] Wishlist summary load failed:', error?.message || error);
        return {
            threshold: WISHLIST_QUALIFYING_THRESHOLD,
            maxFeaturedItems: MAX_FEATURED_WISHLISTED_ITEMS,
            countMode: 'all_time',
            savedListTtlHours: WISHLIST_LOCAL_TTL_MS / (60 * 60 * 1000),
            featuredItemIds: [],
            counts: {},
        };
    }
}

function validateMenuItemForWishlist(itemSnap) {
    if (!itemSnap.exists) return false;
    const item = itemSnap.data() || {};
    const categoryId = String(item.categoryId || '').trim().toLowerCase();
    return item.isDeleted !== true
        && categoryId !== RESERVED_OPEN_ITEMS_CATEGORY_ID
        && Boolean(String(item.name || '').trim());
}

async function buildRawMenuData({ businessRef, businessData }) {
    const [menuSnap, customCategoriesSnap] = await Promise.all([
        businessRef.collection('menu').get(),
        businessRef.collection('custom_categories').orderBy('order', 'asc').get().catch(() => ({ docs: [] })),
    ]);

    const customCategories = customCategoriesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const menu = {};

    customCategories.forEach((category) => {
        const categoryId = String(category?.id || '').trim();
        if (categoryId) menu[categoryId] = [];
    });

    menuSnap.docs.forEach((doc) => {
        const raw = doc.data() || {};
        if (raw.isDeleted === true) return;
        const categoryId = String(raw.categoryId || 'general').trim() || 'general';
        if (categoryId.toLowerCase() === RESERVED_OPEN_ITEMS_CATEGORY_ID) return;
        if (!menu[categoryId]) menu[categoryId] = [];
        menu[categoryId].push(sanitizeMenuDoc(doc));
    });

    Object.keys(menu).forEach((categoryId) => {
        menu[categoryId].sort((a, b) => Number(a?.order || 999) - Number(b?.order || 999));
    });

    return {
        restaurantName: businessData?.name || 'Restaurant',
        approvalStatus: businessData?.approvalStatus || 'approved',
        logoUrl: businessData?.logoUrl || '',
        bannerUrls: Array.isArray(businessData?.bannerUrls) ? businessData.bannerUrls : [],
        menu,
        customCategories,
        coupons: [],
        businessType: 'restaurant',
        isOpen: getEffectiveBusinessOpenStatus(businessData || {}),
        autoScheduleEnabled: businessData?.autoScheduleEnabled === true,
        openingTime: businessData?.openingTime || '09:00',
        closingTime: businessData?.closingTime || '22:00',
        timeZone: businessData?.timeZone || businessData?.timezone || 'Asia/Kolkata',
    };
}

async function loadCachedMenuData({ firestore, businessId, businessRef, businessData }) {
    const menuVersion = Number(businessData?.menuVersion || 0);
    const snapshot = await getFreshMenuSnapshot({
        firestore,
        businessId,
        collectionNameHint: 'restaurants',
        businessRef,
        businessData,
        allowInlineRebuild: true,
    }).catch((error) => {
        console.warn('[waitlist/menu] Snapshot load failed:', error?.message || error);
        return null;
    });

    if (snapshot?.menu) {
        return {
            menuData: {
                ...buildLegacyMenuDataFromSnapshot(snapshot),
                isOpen: getEffectiveBusinessOpenStatus(businessData || {}),
            },
            cacheSource: 'snapshot',
            menuVersion,
        };
    }

    const fallbackMenuData = await getOrSetSharedCache(`waitlist-menu-raw:${businessId}:v${menuVersion}`, {
        ttlMs: 60 * 1000,
        kvTtlSec: 10 * 60,
        compute: () => buildRawMenuData({ businessRef, businessData }),
    });

    return {
        menuData: fallbackMenuData,
        cacheSource: 'raw-cache',
        menuVersion,
    };
}

export async function GET(req) {
    try {
        await verifyAppCheckToken(req, { required: false });

        const { searchParams } = new URL(req.url);
        const restaurantId = String(searchParams.get('restaurantId') || '').trim();
        const entryId = String(searchParams.get('entryId') || '').trim();
        const arrivalCode = String(searchParams.get('arrivalCode') || '').trim().toUpperCase();

        if (!restaurantId || !entryId || !arrivalCode) {
            return noStoreJson({ message: 'restaurantId, entryId and arrivalCode are required.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const rate = await enforceRateLimit(firestore, {
            key: `waitlist-menu:${getClientIp(req)}:${restaurantId}:${entryId}`,
            limit: 50,
            windowSec: 60,
            req,
            auditContext: 'public_waitlist_menu',
        });
        if (!rate.allowed) {
            return noStoreJson({ message: 'Too many menu requests. Please slow down.' }, { status: 429 });
        }

        const context = await loadVerifiedWaitlistContext({ firestore, restaurantId, entryId, arrivalCode });
        if (context.error) return context.error;
        const { businessRef, businessData, entryData, status } = context;

        const { menuData: rawMenuData, cacheSource, menuVersion } = await loadCachedMenuData({
            firestore,
            businessId: restaurantId,
            businessRef,
            businessData,
        });
        const wishlist = await loadWishlistSummary(businessRef);
        const menuData = sanitizeExploreMenuData(rawMenuData, wishlist);
        const menuItemCount = countMenuItems(menuData);
        if (menuItemCount < 1) {
            return noStoreJson({ message: 'Menu is not set up yet.' }, { status: 409 });
        }

        await trackEndpointRead('api.public.waitlist.menu', 2);

        return NextResponse.json({
            ok: true,
            mode: 'waitlist_menu_explore',
            orderingAllowed: false,
            cacheSource,
            menuVersion,
            restaurant: {
                id: restaurantId,
                name: businessData.name || menuData.restaurantName || 'Restaurant',
                logoUrl: businessData.logoUrl || menuData.logoUrl || '',
                isOpen: getEffectiveBusinessOpenStatus(businessData || {}),
            },
            waitlist: {
                entryId,
                status,
                waitlistToken: entryData.waitlistToken || '',
                paxCount: entryData.paxCount || 1,
            },
            wishlist,
            menuData,
        }, {
            status: 200,
            headers: {
                'Cache-Control': 'private, no-store, max-age=0',
                'X-Cache': cacheSource,
                'X-Menu-Version': String(menuVersion),
            },
        });
    } catch (error) {
        console.error('[public/waitlist/menu] ERROR:', error);
        return noStoreJson({ message: error?.message || 'Failed to load waitlist menu.' }, { status: error?.status || 500 });
    }
}

export async function POST(req) {
    try {
        await verifyAppCheckToken(req, { required: false });

        const body = await req.json().catch(() => ({}));
        const restaurantId = String(body.restaurantId || '').trim();
        const entryId = String(body.entryId || '').trim();
        const arrivalCode = String(body.arrivalCode || '').trim().toUpperCase();
        const itemId = String(body.itemId || '').trim();
        const action = String(body.action || '').trim().toLowerCase();
        const shouldSave = body.saved === true || action === 'save';
        const shouldUnsave = body.saved === false || action === 'unsave' || action === 'remove';

        if (!restaurantId || !entryId || !arrivalCode || !itemId) {
            return noStoreJson({ message: 'restaurantId, entryId, arrivalCode and itemId are required.' }, { status: 400 });
        }
        if (shouldSave === shouldUnsave) {
            return noStoreJson({ message: 'A valid save or unsave action is required.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const rate = await enforceRateLimit(firestore, {
            key: `waitlist-menu-wishlist:${getClientIp(req)}:${restaurantId}:${entryId}`,
            limit: 40,
            windowSec: 60,
            req,
            auditContext: 'public_waitlist_menu_wishlist',
        });
        if (!rate.allowed) {
            return noStoreJson({ message: 'Too many wishlist updates. Please slow down.' }, { status: 429 });
        }

        const context = await loadVerifiedWaitlistContext({ firestore, restaurantId, entryId, arrivalCode });
        if (context.error) return context.error;
        const { businessRef, entryRef } = context;

        const itemRef = businessRef.collection('menu').doc(itemId);
        const itemSnap = await itemRef.get();
        if (!validateMenuItemForWishlist(itemSnap)) {
            return noStoreJson({ message: 'Menu item not found.' }, { status: 404 });
        }

        const wishlistRef = entryRef.collection('menu_wishlist').doc(itemId);
        const statsRef = businessRef.collection('waitlist_menu_wishlist_stats').doc(itemId);

        const result = await firestore.runTransaction(async (transaction) => {
            const [wishlistSnap, statsSnap] = await Promise.all([
                transaction.get(wishlistRef),
                transaction.get(statsRef),
            ]);
            const currentCount = Math.max(0, Number(statsSnap.data()?.count || 0));
            const markerData = wishlistSnap.exists ? (wishlistSnap.data() || {}) : {};
            const nowMs = Date.now();
            const savedListExpiresAt = getWishlistLocalExpiry(nowMs);
            const alreadyCounted = wishlistSnap.exists && markerData.counted === true;

            if (shouldSave) {
                const markerPayload = {
                    itemId,
                    saved: true,
                    counted: alreadyCounted,
                    savedListExpiresAt,
                    expiresAt: FieldValue.delete(),
                    updatedAt: FieldValue.serverTimestamp(),
                };
                if (!wishlistSnap.exists) {
                    markerPayload.createdAt = FieldValue.serverTimestamp();
                    markerPayload.firstSavedAt = FieldValue.serverTimestamp();
                }
                transaction.set(wishlistRef, markerPayload, { merge: true });
                return { saved: true, wishlistCount: currentCount };
            }

            if (!wishlistSnap.exists) {
                return { saved: false, wishlistCount: currentCount };
            }
            if (!alreadyCounted) {
                transaction.delete(wishlistRef);
                return { saved: false, wishlistCount: currentCount };
            }
            transaction.set(wishlistRef, {
                itemId,
                saved: false,
                counted: true,
                savedListExpiresAt,
                expiresAt: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            return { saved: false, wishlistCount: currentCount };
        });

        const wishlist = await loadWishlistSummary(businessRef);

        return noStoreJson({
            ok: true,
            itemId,
            saved: result.saved,
            wishlistCount: result.wishlistCount,
            qualifiesForMostWishlisted: Number(result.wishlistCount || 0) >= WISHLIST_QUALIFYING_THRESHOLD
                && wishlist.featuredItemIds.includes(itemId),
            wishlist,
        }, { status: 200 });
    } catch (error) {
        console.error('[public/waitlist/menu:wishlist] ERROR:', error);
        return noStoreJson({ message: error?.message || 'Failed to update wishlist.' }, { status: error?.status || 500 });
    }
}
