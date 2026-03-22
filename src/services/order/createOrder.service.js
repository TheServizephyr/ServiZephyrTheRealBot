/**
 * CREATE ORDER SERVICE V2
 * 
 * MAIN ORCHESTRATOR - Integrates all V2 services
 * 
 * Stage 3: Added hybrid fallback + online payments (Razorpay/PhonePe)
 * 
 * CRITICAL RULES (NON-NEGOTIABLE):
 * - Same response keys as V1
 * - Same status transitions  
 * - Same idempotency behavior
 * - Same webhook dependency
 * - NO optimization of V1 logic
 * - Refactor ≠ Rewrite
 * 
 * Phase 5 Stage 3.4
 */

import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getFirestore, FieldValue, GeoPoint, verifyIdToken } from '@/lib/firebase-admin';

// V1 Fallback for online payments (not tested in V2)
import { createOrderV1, processOrderV1 } from '@/app/api/order/create/legacy/createOrderV1_LEGACY';

import { getOrCreateGuestProfile } from '@/lib/guest-utils';
import { calculateHaversineDistance, calculateDeliveryCharge } from '@/lib/distance';
import { upsertBusinessCustomerProfile } from '@/lib/customer-profiles';
import { resolveGuestAccessRef } from '@/lib/public-auth';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

// Services
import { calculateServerTotal, validatePriceMatch, calculateTaxes, PricingError } from './orderPricing';
import { findBusinessById } from '@/services/business/businessService';
import { paymentService } from '@/services/payment/payment.service';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';

// Repositories
import { orderRepository } from '@/repositories/order.repository';
import { businessRepository } from '@/repositories/business.repository';
import { idempotencyRepository } from '@/repositories/idempotency.repository';

// Response builders
import {
    buildCODResponse,
    buildRazorpayResponse,
    buildPhonePeResponse,
    buildDineInPostPaidResponse,
    buildErrorResponse
} from './orderResponseBuilder';

// --- HELPER: Optimize Item Snapshot (Reduce Document Size) ---
const optimizeItemSnapshot = (item) => {
    if (!item) return item;

    // Base Snapshot with required fields
    const snapshot = {
        id: item.id,
        name: item.name,
        categoryId: item.categoryId || 'general',
        isVeg: !!item.isVeg, // Ensure boolean

        // Critical: Ensure price/totalPrice are never undefined
        // V2 uses serverVerifiedPrice/Total, V1 uses price/totalPrice
        price: (item.price !== undefined) ? item.price : ((item.serverVerifiedPrice !== undefined) ? item.serverVerifiedPrice : 0),
        quantity: item.quantity || 1,

        // Selected Add-ons (Only what the user chose)
        selectedAddOns: item.selectedAddOns ? item.selectedAddOns.map(addon => ({
            name: addon.name,
            price: addon.price || 0,
            quantity: addon.quantity || 1
        })) : [],

        // Financials
        totalPrice: (item.totalPrice !== undefined) ? item.totalPrice : ((item.serverVerifiedTotal !== undefined) ? item.serverVerifiedTotal : 0),

        // Identifiers
        cartItemId: item.cartItemId || null, // Ensure not undefined

        // Flags
        isAddon: !!item.isAddon
    };

    // Conditionally add optional fields (AVOID SETTING TO UNDEFINED)
    if (item.portion) {
        snapshot.portion = {
            name: item.portion.name,
            price: item.portion.price || 0,
            isDefault: item.portion.isDefault === true
        };
    }

    const portionCount = Number(item.portionCount ?? (Array.isArray(item.portions) ? item.portions.length : 0));
    if (Number.isFinite(portionCount) && portionCount > 0) {
        snapshot.portionCount = portionCount;
    }

    if (item.addedAt) {
        snapshot.addedAt = item.addedAt;
    }

    return snapshot;
};

const toFiniteNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const getBusinessLabel = (businessType = 'restaurant') => {
    if (businessType === 'store' || businessType === 'shop') return 'store';
    if (businessType === 'street-vendor') return 'stall';
    return 'restaurant';
};

const normalizeCouponType = (couponType) => {
    const normalized = String(couponType || '').trim().toLowerCase();
    if (normalized === 'fixed') return 'flat';
    return normalized;
};

const ACTIVE_DINE_IN_TOKEN_STATUSES = [
    'awaiting_payment',
    'pending',
    'accepted',
    'confirmed',
    'preparing',
    'ready',
    'ready_for_pickup',
    'pay_at_counter',
    'delivered'
];

const buildCarSessionTabId = ({ carSpot, normalizedPhone, userId }) => {
    const slotKey = String(carSpot || 'spot').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'spot';
    const identitySource = String(normalizedPhone || userId || 'guest').replace(/[^a-zA-Z0-9]/g, '');
    const identityKey = identitySource.slice(-10) || 'guest';
    return `car_${slotKey}_${identityKey}`;
};

const shouldGeneratePhysicalToken = ({ deliveryType, businessType, dineInModel }) => {
    return (
        (deliveryType === 'dine-in' && dineInModel === 'post-paid') ||
        deliveryType === 'car-order' ||
        businessType === 'street-vendor'
    );
};

const normalizePaymentMethod = (paymentMethod) => String(paymentMethod || '').trim().toLowerCase();

async function verifyBearerUid(req) {
    const authHeader = String(req?.headers?.get?.('authorization') || req?.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return '';
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) return '';
    try {
        const decoded = await verifyIdToken(idToken);
        return decoded?.uid || '';
    } catch {
        return '';
    }
}

async function resolveDineInLikeToken({
    firestore,
    business,
    requestRestaurantId,
    deliveryType,
    businessType,
    dineInModel,
    dineInTabId,
    existingOrderId,
    preFetchedExistingOrder = null,
    preFetchedTables = null
}) {
    const requiresPhysicalToken = shouldGeneratePhysicalToken({
        deliveryType,
        businessType,
        dineInModel
    });

    let resolvedDineInTabId = String(dineInTabId || '').trim() || null;

    if (!requiresPhysicalToken) {
        return { dineInToken: null, newTokenNumber: null, dineInTabId: resolvedDineInTabId };
    }

    // Add-on: prefer exact token reuse from existing order first.
    if (existingOrderId) {
        try {
            const existingOrderDoc = preFetchedExistingOrder || await firestore.collection('orders').doc(existingOrderId).get();
            if (existingOrderDoc.exists) {
                const existingOrder = existingOrderDoc.data() || {};
                if (!resolvedDineInTabId && existingOrder.dineInTabId) {
                    resolvedDineInTabId = String(existingOrder.dineInTabId).trim();
                }
                if (existingOrder.dineInToken) {
                    return {
                        dineInToken: existingOrder.dineInToken,
                        newTokenNumber: null,
                        dineInTabId: resolvedDineInTabId
                    };
                }
            }
        } catch (err) {
            console.warn('[createOrderV2] Could not read existing order token for reuse:', err?.message || err);
        }
    }

    if (resolvedDineInTabId) {
        try {
            const candidateRestaurantIds = [...new Set([business?.id, requestRestaurantId].filter(Boolean))];
            
            // Optimization: If we have pre-fetched tables (for dine-in), we might be able to find the tab there
            // But usually Tabs are in a different collection.
            // Orders search is still needed, but let's see if we can optimize this.
            
            for (const candidateRestaurantId of candidateRestaurantIds) {
                const snapshot = await firestore
                    .collection('orders')
                    .where('restaurantId', '==', candidateRestaurantId)
                    .where('dineInTabId', '==', resolvedDineInTabId)
                    .where('status', 'in', ACTIVE_DINE_IN_TOKEN_STATUSES)
                    .limit(1)
                    .get();

                if (!snapshot.empty) {
                    const existingOrder = snapshot.docs[0].data() || {};
                    if (existingOrder.dineInToken) {
                        return {
                            dineInToken: existingOrder.dineInToken,
                            newTokenNumber: null,
                            dineInTabId: resolvedDineInTabId
                        };
                    }
                }
            }
        } catch (err) {
            console.warn('[createOrderV2] Token lookup by dineInTabId failed:', err?.message || err);
        }
    }

    // ✅ ATOMIC TOKEN GENERATION: Use Firestore transaction to prevent race conditions
    // Two concurrent orders can't get the same token number anymore
    const businessRef = firestore.collection(business.collection).doc(business.id);
    const newTokenNumber = await firestore.runTransaction(async (transaction) => {
        const bizSnap = await transaction.get(businessRef);
        const currentToken = bizSnap.exists ? (bizSnap.data()?.lastOrderToken || 0) : 0;
        const nextToken = currentToken + 1;
        transaction.update(businessRef, { lastOrderToken: nextToken });
        return nextToken;
    });

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
    const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
    const dineInToken = `${newTokenNumber}-${randomChar1}${randomChar2}`;

    return {
        dineInToken,
        newTokenNumber: null, // Already updated atomically in the transaction above
        dineInTabId: resolvedDineInTabId
    };
}

/**
 * CREATE ORDER V2 with HYBRID FALLBACK
 * 
 * Following exact orchestration order:
 * 1. Parse + validate request
 * 2. Business lookup
 * 3. Idempotency reservation
 * 4. Server-side pricing (SECURITY)
 * 5. Branch by payment type (WITH HYBRID FALLBACK)
 * 6. Persist order
 * 7. Return response
 */
export async function createOrderV2(req, options = {}) {
    const startTime = Date.now();
    console.log(`[createOrderV2] 🏁 START processing order request at ${new Date(startTime).toISOString()}`);

    try {
        const firestore = await getFirestore();
        const { allowInitialStatusOverride = false } = options || {};

        // ========================================
        // STEP 1: PARSE REQUEST
        // ========================================
        const body = await req.json();
        console.log('[createOrderV2] Request parsed');

        const {
            name,
            phone,
            address,
            restaurantId,
            items,
            notes,
            paymentMethod,
            businessType,      // ✅ Support all: 'restaurant', 'store', 'street-vendor'
            deliveryType,      // ✅ Support all: 'dine-in', 'delivery', 'pickup', 'street-vendor-pre-order'
            collectionName,
            subtotal,
            cgst,
            sgst,
            grandTotal,
            deliveryCharge = 0,
            tipAmount = 0,
            packagingCharge = 0,
            platformFee = 0,
            convenienceFee = 0,
            serviceFee = 0,
            serviceFeeLabel = null,
            serviceFeeType = null,
            serviceFeeValue = 0,
            serviceFeeApplyOn = null,
            coupon = null,
            discount = 0,
            diningPreference = null,
            idempotencyKey,
            existingOrderId, // Add-on flow
            guestRef,       // ✅ NEW: Guest Identity Ref
            guestToken,      // ✅ NEW: Guest Identity Token (Session Check)
            skipAddressValidation = false,
            initialStatus = 'pending'
        } = body;

        const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
        const requestedInitialStatus = String(initialStatus || 'pending').trim().toLowerCase();
        const allowedInitialStatuses = new Set(['pending', 'confirmed']);
        const effectiveInitialStatus =
            allowInitialStatusOverride && allowedInitialStatuses.has(requestedInitialStatus)
                ? requestedInitialStatus
                : 'pending';

        // ✅ SANITIZATION: Only allow diningPreference for dine-in orders
        const sanitizedDiningPreference = (deliveryType === 'dine-in') ? diningPreference : null;

        // ✅ CRITICAL: Street vendors DON'T support add-ons!
        // Force new order creation by ignoring existingOrderId
        const finalExistingOrderId = (businessType === 'street-vendor') ? null : existingOrderId;
        const requiresLegacyAddonFlow = Boolean(finalExistingOrderId);

        if (businessType === 'street-vendor' && existingOrderId) {
            console.log(`[createOrderV2] 🚫 Street vendor detected - IGNORING existingOrderId ${existingOrderId}, creating NEW order`);
        }

        // ========================================
        // PAYMENT METHOD ROUTING
        // ===============================================
        // V1 fallback remains available for sensitive online-payment paths until
        // the dedicated V2 online-payment flag is explicitly enabled.
        const isOnlinePayment = normalizedPaymentMethod === 'online' ||
            normalizedPaymentMethod === 'razorpay' ||
            normalizedPaymentMethod === 'phonepe';
        const requiresLegacySplitBillFlow = normalizedPaymentMethod === 'split_bill';

        const shouldFallbackToLegacyOnlinePayment =
            isOnlinePayment &&
            deliveryType !== 'car-order' &&
            !FEATURE_FLAGS.USE_V2_ONLINE_PAYMENT;

        if (requiresLegacyAddonFlow) {
            console.log('[createOrderV2] 🔄 Add-on order fallback → Using V1 (V2 parity not complete yet)');
            return await processOrderV1(body, firestore);
        }

        if (requiresLegacySplitBillFlow) {
            console.log('[createOrderV2] 🔄 Split bill fallback → Using V1 (V2 parity not complete yet)');
            return await processOrderV1(body, firestore);
        }

        if (shouldFallbackToLegacyOnlinePayment) {
            console.log('[createOrderV2] 🔄 Online payment fallback → Using V1 (feature flag disabled)');
            return await processOrderV1(body, firestore);
        }

        console.log('[createOrderV2] ✅ V2 flow enabled');

        // Basic validation
        if (!idempotencyKey) {
            return buildErrorResponse({
                message: 'Missing idempotency key. Please refresh and try again.',
                status: 400
            });
        }

        if (!restaurantId || !Array.isArray(items) || grandTotal === undefined) {
            return buildErrorResponse({
                message: 'Missing required fields for order creation.',
                status: 400
            });
        }

        if (items.length === 0) {
            return buildErrorResponse({
                message: 'At least one item is required to place an order.',
                status: 400
            });
        }
           // ========================================
        // STEP 2, 3, 4: ACCELERATED DISCOVERY (MASSIVE PARALLEL BATCH)
        // ========================================
        const discoveryStart = Date.now();
        console.log(`[createOrderV2] 🚀 Starting massive parallel discovery batch...`);

        // Prepare some data for the parallel calls
        const requestPhoneNormalized = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        const customerLat = toFiniteNumber(address?.latitude ?? address?.lat);
        const customerLng = toFiniteNumber(address?.longitude ?? address?.lng);

        // --- DISCOVERY PROMISES ---
        // 1. Business Lookup
        const businessPromise = findBusinessById(firestore, restaurantId, collectionName);

        // 2. Idempotency Reservation
        const idempotencyReservationPromise = idempotencyRepository.reserveAtomic(idempotencyKey, {
            restaurantId,
            paymentMethod: normalizedPaymentMethod || paymentMethod
        });

        // 3. User Identity (Refined to be more parallel)
        const identityDiscoveryPromise = (async () => {
            const authHeader = String(req?.headers?.get?.('authorization') || req?.headers?.authorization || '');
            let idToken = '';
            if (authHeader.startsWith('Bearer ')) idToken = authHeader.slice('Bearer '.length).trim();

            const [refSession, decodedToken] = await Promise.all([
                guestRef ? resolveGuestAccessRef(firestore, guestRef, { requiredScopes: ['checkout'], allowLegacy: true, touch: true }).catch(() => null) : null,
                idToken ? verifyIdToken(idToken).catch(() => null) : null
            ]);
            return { refSession, bearerUid: decodedToken?.uid || null };
        })();

        // 4. Delivery Config (⚡ fire both paths in parallel, use whichever exists)
        const needsDeliveryValidation = (deliveryType === 'delivery' || deliveryType === 'car-order') 
            && !(skipAddressValidation && (customerLat === null || customerLng === null || !address?.full));
        const deliveryConfigPromise = needsDeliveryValidation
            ? (async () => {
                // Fire both possible paths in parallel
                const [pathA, pathB] = await Promise.all([
                    firestore.collection('restaurants').doc(restaurantId).collection('delivery_settings').doc('config').get().catch(() => null),
                    firestore.collection('cloud-kitchens').doc(restaurantId).collection('delivery_settings').doc('config').get().catch(() => null)
                ]);
                return (pathA && pathA.exists) ? pathA : (pathB && pathB.exists) ? pathB : null;
            })()
            : Promise.resolve(null);

        // 5. Tables for dine-in
        const tablesPromise = (deliveryType === 'dine-in' && body.tableId)
            ? firestore.collection('restaurants').doc(restaurantId).collection('tables').get()
            : Promise.resolve(null);

        // 6. Existing order for addons
        const existingOrderPromise = finalExistingOrderId 
            ? firestore.collection('orders').doc(finalExistingOrderId).get()
            : Promise.resolve(null);

        // 8. Coupon Fetch
        const couponPromise = (coupon && coupon.id)
            ? firestore.collection('restaurants').doc(restaurantId).collection('coupons').doc(coupon.id).get()
            : Promise.resolve(null);

        // 🔥 FIRE DISCOVERY BATCH (PHASE 1: Business & Identity)
        const [
            business,
            idempotencyResult,
            identityDiscovery,
        ] = await Promise.all([
            businessPromise,
            idempotencyReservationPromise,
            identityDiscoveryPromise,
        ]);

        console.log(`[createOrderV2] ⏱️ Discovery Phase 1 completed in ${Date.now() - discoveryStart}ms`);

        // ========================================
        // STEP 3: DISCOVERY VALIDATION
        // ========================================

        // 3.1 Business Check
        if (!business) {
            return buildErrorResponse({ message: 'Restaurant not found.', status: 404 });
        }
        if (!getEffectiveBusinessOpenStatus(business.data)) {
            return buildErrorResponse({ message: 'Restaurant is currently closed.', status: 403 });
        }

        // --- DISCOVERY PROMISES (PHASE 2: Business-Dependent Data) ---
        // Now that we have the business, we can accurately calculate pricing
        const pricingPromise = calculateServerTotal({
            restaurantId: business.id,
            items,
            businessType: business.type, 
            deliveryType
        });

        const [
            deliveryConfigSnap,
            tablesSnap,
            existingOrderDoc,
            pricingResult,
            couponSnap
        ] = await Promise.all([
            deliveryConfigPromise,
            tablesPromise,
            existingOrderPromise,
            pricingPromise,
            couponPromise
        ]);

        console.log(`[createOrderV2] ⏱️ Discovery Phase 2 completed in ${Date.now() - discoveryStart}ms`);

        // 3.2 Idempotency Check
        if (idempotencyResult.isDuplicate) {
            console.log(`[createOrderV2] Duplicate request detected, returning existing order`);
            const existingOrder = await orderRepository.getById(idempotencyResult.orderId);
            const duplicatePaymentMethod = normalizePaymentMethod(idempotencyResult.paymentMethod || normalizedPaymentMethod);
            const duplicateGatewayOrderId =
                idempotencyResult.gatewayOrderId ||
                idempotencyResult.razorpayOrderId ||
                idempotencyResult.phonePeOrderId ||
                null;

            if (duplicatePaymentMethod === 'phonepe') {
                return NextResponse.json({
                    message: 'Order already exists',
                    phonepe_order_id: idempotencyResult.phonePeOrderId || duplicateGatewayOrderId,
                    firestore_order_id: idempotencyResult.orderId,
                    token: existingOrder?.trackingToken,
                    amount: Number(existingOrder?.totalAmount || grandTotal || 0),
                }, { status: 200 });
            }

            if (!isOnlinePayment && duplicatePaymentMethod !== 'razorpay') {
                return NextResponse.json({
                    message: 'Order already exists',
                    order_id: idempotencyResult.orderId,
                    firestore_order_id: idempotencyResult.orderId,
                    token: existingOrder?.trackingToken
                }, { status: 200 });
            }

            return NextResponse.json({
                message: 'Order already exists',
                razorpay_order_id: idempotencyResult.razorpayOrderId || duplicateGatewayOrderId,
                firestore_order_id: idempotencyResult.orderId,
                token: existingOrder?.trackingToken
            }, { status: 200 });
        }

        // 3.3 Identity Resolution (Finalize using fetched data)
        const { refSession, bearerUid } = identityDiscovery;
        let userId, normalizedPhone, isGuest;
        let finalCustomerName = name || 'Guest';
        let finalCustomerEmail = '';

        if (refSession?.subjectId) {
            userId = refSession.subjectId;
            isGuest = String(userId).startsWith('g_');
            const [guestDoc, userDoc] = await Promise.all([
                firestore.collection('guest_profiles').doc(userId).get(),
                firestore.collection('users').doc(userId).get(),
            ]);
            const profileData = guestDoc.exists ? guestDoc.data() : (userDoc.exists ? userDoc.data() : {});
            normalizedPhone = requestPhoneNormalized || (profileData?.phone ? String(profileData.phone).slice(-10) : null);
            if (profileData?.email) finalCustomerEmail = String(profileData.email).trim().toLowerCase();
            if ((!name || name === 'Guest') && profileData?.name) finalCustomerName = profileData.name;
        } else if (bearerUid) {
            userId = bearerUid;
            isGuest = false;
            const userDoc = await firestore.collection('users').doc(bearerUid).get();
            const profileData = userDoc.exists ? userDoc.data() : {};
            normalizedPhone = requestPhoneNormalized || (profileData?.phone ? String(profileData.phone).slice(-10) : null);
            if (profileData?.email) finalCustomerEmail = String(profileData.email).trim().toLowerCase();
            if ((!name || name === 'Guest') && profileData?.name) finalCustomerName = profileData.name;
        } else if (requestPhoneNormalized) {
            const profileResult = await getOrCreateGuestProfile(firestore, requestPhoneNormalized);
            userId = profileResult.userId;
            isGuest = profileResult.isGuest;
            normalizedPhone = requestPhoneNormalized;
            const profileData = profileResult.data || {};
            if (profileData.email) finalCustomerEmail = String(profileData.email).trim().toLowerCase();
            if ((!name || name === 'Guest') && profileData.name) finalCustomerName = profileData.name;
        } else {
            userId = `anon_${nanoid(10)}`;
            isGuest = true;
            normalizedPhone = null;
        }
        console.log(`[createOrderV2] ✅ All Discovery & Validation completed in total ${Date.now() - discoveryStart}ms`);
        console.log(`[createOrderV2] ✅ Identity: ${userId}, Phone: ${normalizedPhone}, Name: ${finalCustomerName}`);

        validatePriceMatch(subtotal, pricingResult.serverSubtotal);
        console.log(`[createOrderV2] Price validation passed: ₹${pricingResult.serverSubtotal}`);

        const pricing = pricingResult;


        // --- SERVER-SIDE BILLING CALCULATIONS ---
        let verifiedCoupon = null;
        let couponDiscountAmount = 0;

        if (Number(discount) > 0) {
            console.warn('[createOrderV2] Ignoring client-provided discount; server side discount validation is required.');
        }

        // Coupon re-validation for V2 (COD/Counter flows).
        if (coupon && coupon.id) {
            try {
                // const couponSnap = await couponPromise; // Already awaited in parallel batch

                if (!couponSnap || !couponSnap.exists) {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Selected coupon not found'));
                    return buildErrorResponse({
                        message: 'Selected coupon is no longer available.',
                        status: 400
                    });
                }

                const couponData = couponSnap.data() || {};
                const now = new Date();
                const couponType = normalizeCouponType(couponData.type);
                const couponValue = Number(couponData.value) || 0;
                const couponMinOrder = Number(couponData.minOrder) || 0;
                const couponMaxDiscount = Number(couponData.maxDiscount) || 0;
                const couponUsageLimit = Number(couponData.usageLimit) || 0;
                const couponTimesUsed = Number(couponData.timesUsed) || 0;

                const startDate = couponData.startDate?.toDate
                    ? couponData.startDate.toDate()
                    : (couponData.startDate ? new Date(couponData.startDate) : null);
                const expiryDate = couponData.expiryDate?.toDate
                    ? couponData.expiryDate.toDate()
                    : (couponData.expiryDate ? new Date(couponData.expiryDate) : null);

                if (couponData.status && couponData.status !== 'active') {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Coupon inactive'));
                    return buildErrorResponse({
                        message: 'This coupon is inactive.',
                        status: 400
                    });
                }

                if (startDate && startDate > now) {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Coupon not started'));
                    return buildErrorResponse({
                        message: 'This coupon is not active yet.',
                        status: 400
                    });
                }

                if (expiryDate && expiryDate < now) {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Coupon expired'));
                    return buildErrorResponse({
                        message: 'This coupon has expired.',
                        status: 400
                    });
                }

                if (pricingResult.serverSubtotal < couponMinOrder) {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Coupon minimum order not met'));
                    return buildErrorResponse({
                        message: `Coupon valid on minimum order of ₹${couponMinOrder}.`,
                        status: 400
                    });
                }

                if (couponUsageLimit > 0 && couponTimesUsed >= couponUsageLimit) {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Coupon usage limit reached'));
                    return buildErrorResponse({
                        message: 'Coupon usage limit reached.',
                        status: 400
                    });
                }

                if (!['flat', 'percentage', 'free_delivery'].includes(couponType)) {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Unsupported coupon type'));
                    return buildErrorResponse({
                        message: 'Invalid coupon type.',
                        status: 400
                    });
                }

                if (couponType === 'flat') {
                    couponDiscountAmount = couponValue;
                } else if (couponType === 'percentage') {
                    couponDiscountAmount = (pricing.serverSubtotal * couponValue) / 100;
                    if (couponMaxDiscount > 0 && couponDiscountAmount > couponMaxDiscount) {
                        couponDiscountAmount = couponMaxDiscount;
                    }
                } else {
                    couponDiscountAmount = 0;
                }

                couponDiscountAmount = Math.max(0, couponDiscountAmount);
                verifiedCoupon = { ...couponData, type: couponType, id: couponSnap.id };

                console.log(`[createOrderV2] ✅ Coupon validated: ${verifiedCoupon.code || verifiedCoupon.id}, discount=₹${couponDiscountAmount}`);
            } catch (couponError) {
                await idempotencyRepository.fail(idempotencyKey, couponError);
                return buildErrorResponse({
                    message: couponError?.message || 'Coupon validation failed.',
                    status: 400
                });
            }
        }

        const netSubtotal = Math.max(0, pricing.serverSubtotal - couponDiscountAmount);
        const taxes = calculateTaxes(netSubtotal, business.data);
        const serverCgst = taxes.cgst;
        const serverSgst = taxes.sgst;

        // Re-validate delivery range/charge on server to prevent client tampering.
        let validatedDeliveryCharge = 0;
        const requestedDeliveryCharge = Math.max(0, Number(deliveryCharge) || 0);
        if (deliveryType === 'delivery' || deliveryType === 'car-order') {
            const restaurantLat = toFiniteNumber(
                business.data.coordinates?.lat ??
                business.data.address?.latitude ??
                business.data.businessAddress?.latitude
            );
            const restaurantLng = toFiniteNumber(
                business.data.coordinates?.lng ??
                business.data.address?.longitude ??
                business.data.businessAddress?.longitude
            );

            if (!skipAddressValidation && deliveryType !== 'car-order' && (!address?.full || customerLat === null || customerLng === null || restaurantLat === null || restaurantLng === null)) {
                await idempotencyRepository.fail(idempotencyKey, new Error('Invalid delivery address coordinates'));
                return buildErrorResponse({
                    message: 'A valid delivery address is required.',
                    status: 400
                });
            }

            // Manual call-order flow OR car-order: allow creating order first and collect address later.
            if (deliveryType === 'car-order' || (skipAddressValidation && (customerLat === null || customerLng === null || !address?.full))) {
                console.log('[createOrderV2] ⚠️ car-order or skipAddressValidation - creating order without customer coordinates.');
                // Car orders have no delivery charge
                validatedDeliveryCharge = deliveryType === 'car-order' ? 0 : requestedDeliveryCharge;
            } else {

                const deliveryConfigSnap = await deliveryConfigPromise;
                const deliveryConfig = (deliveryConfigSnap && deliveryConfigSnap.exists) ? deliveryConfigSnap.data() : {};
                const getSetting = (key, fallback) => deliveryConfig[key] ?? business.data[key] ?? fallback;

                const settings = {
                    deliveryEnabled: getSetting('deliveryEnabled', true),
                    deliveryRadius: getSetting('deliveryRadius', 10),
                    deliveryChargeType: getSetting('deliveryFeeType', getSetting('deliveryChargeType', 'fixed')),
                    fixedCharge: getSetting('deliveryFixedFee', getSetting('fixedCharge', 0)),
                    perKmCharge: getSetting('deliveryPerKmFee', getSetting('perKmCharge', 0)),
                    baseDistance: getSetting('deliveryBaseDistance', getSetting('baseDistance', 0)),
                    freeDeliveryThreshold: getSetting('deliveryFreeThreshold', getSetting('freeDeliveryThreshold', 0)),
                    freeDeliveryRadius: getSetting('freeDeliveryRadius', 0),
                    freeDeliveryMinOrder: getSetting('freeDeliveryMinOrder', 0),
                    roadDistanceFactor: getSetting('roadDistanceFactor', 1.0),
                    deliveryTiers: getSetting('deliveryTiers', []),
                    orderSlabRules: getSetting('deliveryOrderSlabRules', getSetting('orderSlabRules', [])),
                    orderSlabAboveFee: getSetting('deliveryOrderSlabAboveFee', getSetting('orderSlabAboveFee', 0)),
                    orderSlabBaseDistance: getSetting('deliveryOrderSlabBaseDistance', getSetting('orderSlabBaseDistance', 1)),
                    orderSlabPerKmFee: getSetting('deliveryOrderSlabPerKmFee', getSetting('orderSlabPerKmFee', 15)),
                };

                if (settings.deliveryEnabled === false) {
                    await idempotencyRepository.fail(idempotencyKey, new Error('Delivery disabled'));
                    return buildErrorResponse({
                        message: `Delivery is currently disabled for this ${businessLabel}.`,
                        status: 400
                    });
                }

                const aerialDistance = calculateHaversineDistance(
                    restaurantLat,
                    restaurantLng,
                    customerLat,
                    customerLng
                );
                const deliveryResult = calculateDeliveryCharge(aerialDistance, pricing.serverSubtotal, settings);
                if (!deliveryResult.allowed) {
                    await idempotencyRepository.fail(idempotencyKey, new Error(deliveryResult.message || 'Out of delivery range'));
                    return buildErrorResponse({
                        message: deliveryResult.message || 'Address is outside delivery range.',
                        status: 400
                    });
                }

                validatedDeliveryCharge = Number(deliveryResult.charge) || 0;
            }
        }

        if (verifiedCoupon && verifiedCoupon.type === 'free_delivery') {
            validatedDeliveryCharge = 0;
        }

        const gstComponent = taxes.isIncludedInPrice ? 0 : (serverCgst + serverSgst);
        const serverGrandTotal = netSubtotal + gstComponent +
            validatedDeliveryCharge + (packagingCharge || 0) + (tipAmount || 0) +
            (platformFee || 0) + (convenienceFee || 0) + (serviceFee || 0);
        const ownerManualDeliveryChargeProvided =
            deliveryType === 'delivery' &&
            skipAddressValidation === true &&
            requestedDeliveryCharge > 0;

        console.log(`[createOrderV2] Server billing verification: Subtotal=${pricing.serverSubtotal}, Discount=${couponDiscountAmount}, CGST=${serverCgst}, SGST=${serverSgst}, GrandTotal=${serverGrandTotal}`);

        // Optionally override body fields with server-verified ones
        // subtotal = pricing.serverSubtotal;
        // cgst = serverCgst;
        // sgst = serverSgst;
        // grandTotal = serverGrandTotal;

        // All discovery/validation is now handled by the parallel batch above.
        // We just use the extracted variables directly.

        // Customer location (for delivery)
        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;

        // ✅ CRITICAL: For dine-in, lookup actual table ID (case-insensitive)
        let actualTableId = body.tableId;
        if (deliveryType === 'dine-in' && body.tableId) {
            try {
                const tablesSnap = await tablesPromise;
                if (tablesSnap) {
                    tablesSnap.forEach(doc => {
                        if (doc.id.toLowerCase() === body.tableId.toLowerCase()) {
                            actualTableId = doc.id; // Use actual cased ID from DB
                        }
                    });
                    console.log(`[createOrderV2] Table ID normalized: ${body.tableId} → ${actualTableId}`);
                }
            } catch (err) {
                console.warn(`[createOrderV2] Failed to lookup table ID:`, err);
                // Fallback to provided ID
            }
        }

        // ⚡ OPTIMIZED: Generate token instantly, defer Firestore write to save batch
        let trackingToken;
        let needsTokenPersist = false;

        if (finalExistingOrderId && existingOrderDoc && existingOrderDoc.exists) {
            trackingToken = existingOrderDoc.data().trackingToken;
            console.log(`[createOrderV2] ✅ Reusing existing order token: ${trackingToken}`);
        } else {
            // ⚡ Generate token instantly (no Firestore write here)
            trackingToken = nanoid(24);
            needsTokenPersist = true;
            console.log(`[createOrderV2] ⚡ Token generated instantly: ${trackingToken}`);
        }

        const fallbackCarTabId = deliveryType === 'car-order'
            ? buildCarSessionTabId({
                carSpot: body.carSpot,
                normalizedPhone,
                userId
            })
            : null;
        const requestedSessionTabId = body.dineInTabId || fallbackCarTabId || null;

        const {
            dineInToken,
            newTokenNumber,
            dineInTabId: resolvedDineInTabId
        } = await resolveDineInLikeToken({
            firestore,
            business,
            requestRestaurantId: restaurantId,
            deliveryType,
            businessType: business.type,
            dineInModel: business.data.dineInModel,
            dineInTabId: requestedSessionTabId,
            existingOrderId: finalExistingOrderId,
            // Optimization: Pass pre-fetched data
            preFetchedExistingOrder: existingOrderDoc,
            preFetchedTables: tablesSnap
        });


        // ========================================
        // ONLINE PAYMENT FLOW (Razorpay/PhonePe)
        // ========================================
        if (isOnlinePayment) {
            console.log(`[createOrderV2] Handling online payment: ${normalizedPaymentMethod}`);

            // CRITICAL: Create Firestore order FIRST (same as V1)
            // Status: 'awaiting_payment' (webhook will change to 'pending')
            const firestoreOrderId = firestore.collection('orders').doc().id;

            const orderData = {
                customerName: finalCustomerName,
                customerId: userId,
                userId: userId,  // ✅ NEW: Unified userId field
                customerAddress: address?.full || null,
                customerPhone: normalizedPhone,
                customerEmail: finalCustomerEmail || null,
                customerLocation: customerLocation,
                restaurantId: business.id, // ✅ FIX: Use resolved Business ID
                restaurantName: business.data.name,
                businessType: business.type,
                deliveryType,
                // ✅ Car Order fields
                ...(deliveryType === 'car-order' && {
                    isCarOrder: true,
                    carSpot: body.carSpot || null,
                    carDetails: body.carDetails || null,
                    orderSource: 'car_qr'
                }),
                pickupTime: body.pickupTime || '',
                tipAmount: tipAmount || 0,
                items: pricing.validatedItems.map(optimizeItemSnapshot), // OPTIMIZED
                subtotal: pricing.serverSubtotal, // Server-calculated
                cgst: serverCgst, // Server-calculated
                sgst: serverSgst, // Server-calculated
                deliveryCharge: validatedDeliveryCharge,
                diningPreference: sanitizedDiningPreference,
                packagingCharge: packagingCharge || 0,
                platformFee: platformFee || 0,
                convenienceFee: convenienceFee || 0,
                serviceFee: serviceFee || 0,
                serviceFeeLabel: serviceFee ? (String(serviceFeeLabel || '').trim() || 'Additional Charge') : null,
                serviceFeeType: serviceFee ? (serviceFeeType === 'percentage' ? 'percentage' : 'fixed') : null,
                serviceFeeValue: serviceFee ? (Number(serviceFeeValue) || 0) : 0,
                serviceFeeApplyOn: serviceFee ? (String(serviceFeeApplyOn || '').trim() || 'all') : 'all',
                discount: couponDiscountAmount,
                coupon: verifiedCoupon || null,
                totalAmount: serverGrandTotal, // Server-calculated
                status: 'awaiting_payment', // SAME as V1
                orderDate: FieldValue.serverTimestamp(),
                notes: notes || null,
                paymentDetails: [],
                trackingToken: trackingToken,
                dineInToken: dineInToken || null,
                dineInTabId: resolvedDineInTabId || null,
                tableId: actualTableId || null,
                ordered_by: body.ordered_by || 'customer',
                ordered_by_name: body.ordered_by_name || null,
                ...(deliveryType === 'car-order' && {
                    tab_name: body.tab_name || finalCustomerName || 'Car Guest',
                    pax_count: 1
                })
            };

            // Create order in Firestore
            await orderRepository.create(orderData, firestoreOrderId);
            console.log(`[createOrderV2] Firestore order created: ${firestoreOrderId}`);

            // Build servizephyr_payload for webhook (V1 parity)
            const servizephyrPayload = {
                customerDetails: { name, phone: normalizedPhone, address },
                billDetails: {
                    subtotal: pricing.serverSubtotal,
                    discount: couponDiscountAmount,
                    grandTotal: serverGrandTotal,
                    cgst: serverCgst,
                    sgst: serverSgst,
                    deliveryCharge: validatedDeliveryCharge,
                    packagingCharge: packagingCharge || 0,
                    platformFee: platformFee || 0,
                    convenienceFee: convenienceFee || 0,
                    serviceFee: serviceFee || 0,
                    serviceFeeLabel: serviceFee ? (String(serviceFeeLabel || '').trim() || 'Additional Charge') : null,
                    serviceFeeType: serviceFee ? (serviceFeeType === 'percentage' ? 'percentage' : 'fixed') : null,
                    serviceFeeValue: serviceFee ? (Number(serviceFeeValue) || 0) : 0,
                    serviceFeeApplyOn: serviceFee ? (String(serviceFeeApplyOn || '').trim() || 'all') : 'all',
                    tipAmount,
                    coupon: verifiedCoupon || null,
                    pickupTime: body.pickupTime || '',
                    diningPreference: sanitizedDiningPreference,
                },
                items: pricing.validatedItems.map(optimizeItemSnapshot), // OPTIMIZED
                restaurantId: business.id, // ✅ FIX
                userId,
                businessType: business.type,
                deliveryType,
                trackingToken,
                dineInToken: dineInToken || null,
                dineInTabId: resolvedDineInTabId || null,
                isNewUser: false // TODO: implement customer check
            };

            // Create payment gateway order
            const gateway = paymentService.determineGateway(normalizedPaymentMethod);
            const paymentOrder = await paymentService.createPaymentOrder({
                gateway,
                amount: serverGrandTotal,
                orderId: firestoreOrderId,
                metadata: {
                    restaurantName: business.data.name,
                    restaurant_id: business.id,
                    businessType: business.type,
                    deliveryType,
                },
                servizephyrPayload
            });

            // Mark idempotency as completed
            const idempotencyCompletionPayload = {
                orderId: firestoreOrderId,
                paymentMethod: normalizedPaymentMethod,
                gatewayOrderId: paymentOrder.id,
            };
            if (gateway === 'razorpay') {
                idempotencyCompletionPayload.razorpayOrderId = paymentOrder.id;
            } else if (gateway === 'phonepe') {
                idempotencyCompletionPayload.phonePeOrderId = paymentOrder.id;
            }
            await idempotencyRepository.complete(idempotencyKey, {
                ...idempotencyCompletionPayload,
            });

            // Token counter already updated atomically in resolveDineInLikeToken transaction

            // Return response based on gateway
            if (gateway === 'razorpay') {
                return buildRazorpayResponse({
                    razorpayOrderId: paymentOrder.id,
                    orderId: firestoreOrderId,
                    token: trackingToken,
                    dineInToken: dineInToken || undefined,
                    dineInTabId: resolvedDineInTabId || undefined
                });
            } else {
                return buildPhonePeResponse({
                    phonePeOrderId: paymentOrder.id,
                    orderId: firestoreOrderId,
                    token: trackingToken,
                    amount: serverGrandTotal,
                    dineInToken: dineInToken || undefined,
                    dineInTabId: resolvedDineInTabId || undefined
                });
            }
        }

        // ========================================
        // STEP 6: COD/COUNTER FLOW
        // ========================================
        console.log(`[createOrderV2] Creating COD/Counter order`);

        if (dineInToken) {
            console.log(`[createOrderV2] 🎫 Dine-in style token in use: ${dineInToken}`);
        }

        // Build order data (SAME structure as V1)
        const orderData = {
            customerName: (
                deliveryType === 'dine-in'
                    ? (body.tab_name || body.customerName || 'Guest')
                    : (deliveryType === 'car-order'
                        ? (body.tab_name || body.customerName || finalCustomerName || 'Car Guest')
                        : finalCustomerName)
            ),
            customerId: userId,
            userId: userId,  // ✅ NEW: Unified userId field for queries
            customerAddress: address?.full || null,
            // ✅ Car Order fields
            ...(deliveryType === 'car-order' && {
                isCarOrder: true,
                carSpot: body.carSpot || null,
                carDetails: body.carDetails || null,
                orderSource: 'car_qr',
                tab_name: body.tab_name || finalCustomerName || 'Car Guest',
                pax_count: 1,
                dineInTabId: resolvedDineInTabId || null
            }),
            customerPhone: normalizedPhone,
            customerEmail: finalCustomerEmail || null,
            customerLocation: customerLocation,
            restaurantId: business.id, // ✅ FIX: Use resolved Business ID
            restaurantName: business.data.name,
            businessType: business.type,
            deliveryType,
            customerAddressPending: deliveryType === 'delivery' && !customerLocation,
            pickupTime: body.pickupTime || '',
            tipAmount: tipAmount || 0,
            tipAmount: tipAmount || 0,
            items: pricing.validatedItems.map(optimizeItemSnapshot), // OPTIMIZED: Remove heavy fields
            subtotal: pricing.serverSubtotal, // Server-calculated
            subtotal: pricing.serverSubtotal, // Server-calculated
            cgst: serverCgst,
            sgst: serverSgst,
            deliveryCharge: validatedDeliveryCharge,
            diningPreference: sanitizedDiningPreference,
            packagingCharge: packagingCharge || 0,
            platformFee: platformFee || 0,
            convenienceFee: convenienceFee || 0,
            serviceFee: serviceFee || 0,
            serviceFeeLabel: serviceFee ? (String(serviceFeeLabel || '').trim() || 'Additional Charge') : null,
            serviceFeeType: serviceFee ? (serviceFeeType === 'percentage' ? 'percentage' : 'fixed') : null,
            serviceFeeValue: serviceFee ? (Number(serviceFeeValue) || 0) : 0,
            serviceFeeApplyOn: serviceFee ? (String(serviceFeeApplyOn || '').trim() || 'all') : 'all',
            discount: couponDiscountAmount,
            coupon: verifiedCoupon || null,
            totalAmount: serverGrandTotal,
            status: effectiveInitialStatus,
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            ownerDeliveryChargeProvided: ownerManualDeliveryChargeProvided,
            deliveryChargeLocked: ownerManualDeliveryChargeProvided,
            manualDeliveryChargeLocked: ownerManualDeliveryChargeProvided,
            manualDeliveryCharge: ownerManualDeliveryChargeProvided ? validatedDeliveryCharge : 0,
            ordered_by: body.ordered_by || 'customer',
            ordered_by_name: body.ordered_by_name || null,
            // ✅ Dine-in specific fields
            ...(deliveryType === 'dine-in' && {
                tableId: actualTableId, // Use normalized table ID
                pax_count: body.pax_count,
                tab_name: body.tab_name,
                dineInTabId: resolvedDineInTabId || null
            }),
            paymentDetails: [{
                method: normalizedPaymentMethod || 'cod',
                amount: serverGrandTotal,
                status: 'pending',
                timestamp: new Date()
            }],
            trackingToken: trackingToken,
            // ✅ Dine-in fields
            dineInTabId: resolvedDineInTabId || null,
            tableId: actualTableId || null,  // USE normalized table ID
            dineInToken: dineInToken, // Token for post-paid dine-in
        };

        console.log(`[createOrderV2] 💾 Order data prepared with dineInToken: '${dineInToken}'`);

        // ========================================
        // STEP 7: PARALLEL DATABASE SAVING
        // ========================================
        // Generate Order ID beforehand to decouple dependencies
        const orderId = firestore.collection('orders').doc().id;
        console.log(`[createOrderV2] Order ID reserved: ${orderId}`);

        const saveOrderPromise = orderRepository.create(orderData, orderId);

        // Keep tracking-token persistence on the critical path so redirects can track immediately.
        const tokenPersistPromise = needsTokenPersist ? (async () => {
            try {
                await firestore.collection('auth_tokens').doc(trackingToken).set({
                    userId,
                    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
                    type: 'tracking',
                    scopes: ['track_orders', 'active_orders']
                });
            } catch (err) {
                console.warn('[createOrderV2] Token persist failed (non-critical):', err?.message);
            }
        })() : Promise.resolve();

        const idempotencyPromise = idempotencyRepository.complete(idempotencyKey, {
            orderId,
            paymentMethod: normalizedPaymentMethod || 'cod'
        });

        const syncProfilePromise = (async () => {
            try {
                await upsertBusinessCustomerProfile({
                    firestore,
                    businessCollection: business.collection,
                    businessId: business.id,
                    customerDocId: userId,
                    customerName: orderData.customerName,
                    customerEmail: finalCustomerEmail,
                    customerPhone: normalizedPhone,
                    customerAddress: address || orderData.customerAddress || null,
                    customerStatus: isGuest ? 'unclaimed' : 'verified',
                    orderId,
                    orderSubtotal: pricing.serverSubtotal,
                    orderTotal: serverGrandTotal,
                    items: pricing.validatedItems,
                    customerType: isGuest ? 'guest' : 'uid',
                });
            } catch (profileSyncError) {
                console.error('[createOrderV2] Customer profile sync failed:', profileSyncError);
            }
        })();

        // Token counter already updated atomically in resolveDineInLikeToken transaction
        const tokenCounterPromise = Promise.resolve();

        const tabUpdatePromise = (deliveryType === 'dine-in' && resolvedDineInTabId && business.data.dineInModel === 'post-paid') ? (async () => {
            const dineInTabId = resolvedDineInTabId;
            try {
                const tabRef = firestore.collection(business.collection).doc(business.id)
                    .collection('dineInTabs').doc(dineInTabId);
                const tabSnap = await tabRef.get();
                const batch = firestore.batch();

                if (tabSnap.exists) {
                    const tabStatus = tabSnap.data()?.status;
                    if (['inactive', 'pending', 'active'].includes(tabStatus)) {
                        const tabOrderRef = tabRef.collection('orders').doc(orderId);
                        batch.set(tabOrderRef, {
                            orderId: orderId,
                            totalAmount: serverGrandTotal,
                            status: 'pending',
                            createdAt: FieldValue.serverTimestamp()
                        });
                        batch.update(tabRef, {
                            totalBill: FieldValue.increment(serverGrandTotal),
                            status: 'active',
                            updatedAt: FieldValue.serverTimestamp()
                        });
                        await batch.commit();
                        console.log(`[createOrderV2] Updated existing tab ${dineInTabId} (${tabStatus}->active): +Rs${serverGrandTotal}`);
                    } else {
                        console.warn(`[createOrderV2] Tab ${dineInTabId} status=${tabStatus}, cannot add order`);
                    }
                } else {
                    console.log(`[createOrderV2] Creating new tab document for ${dineInTabId}`);
                    batch.set(tabRef, {
                        id: dineInTabId,
                        tableId: actualTableId,
                        tab_name: body.tab_name || 'Guest',
                        pax_count: body.pax_count || 1,
                        status: 'active',
                        totalBill: serverGrandTotal,
                        paidAmount: 0,
                        pendingAmount: serverGrandTotal,
                        createdAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });
                    const tabOrderRef = tabRef.collection('orders').doc(orderId);
                    batch.set(tabOrderRef, {
                        orderId: orderId,
                        totalAmount: serverGrandTotal,
                        status: 'pending',
                        createdAt: FieldValue.serverTimestamp()
                    });
                    await batch.commit();
                    console.log(`[createOrderV2] Created new tab ${dineInTabId} with order ${orderId}`);
                }
            } catch (tabErr) {
                console.error('[createOrderV2] Tab update failed:', tabErr);
            }
        })() : Promise.resolve();

        console.log('[createOrderV2] Executing critical order writes...');
        await Promise.all([
            saveOrderPromise,
            tokenPersistPromise,
            syncProfilePromise,
            idempotencyPromise,
            tokenCounterPromise,
            tabUpdatePromise
        ]);
        console.log('[createOrderV2] Critical order writes completed successfully');
        console.log(`[createOrderV2] 🏁 FINISHED in total ${Date.now() - startTime}ms`);

        // ========================================
        // STEP 7: RETURN RESPONSE
        // ========================================
        return buildCODResponse({
            orderId,
            token: trackingToken,
            dineInTabId: resolvedDineInTabId || undefined,
            tableId: actualTableId || undefined,
            dineInToken: dineInToken || undefined
        });

    } catch (error) {
        console.error('[createOrderV2] Error:', error);

        return buildErrorResponse({
            message: `Backend Error: ${error.message}`,
            status: 500
        });
    }
}

/**
 * Generate secure tracking token (same as V1)
 */
async function generateSecureToken(firestore, userId) {
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h validity

    const tokenData = {
        userId: userId,  // Store unified userId (UID or guest ID)
        expiresAt: expiry,
        type: 'tracking',
        scopes: ['track_orders', 'active_orders']
    };

    await firestore.collection('auth_tokens').doc(token).set(tokenData);

    return token;
}


