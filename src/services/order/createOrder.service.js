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
import { getFirestore, FieldValue, GeoPoint } from '@/lib/firebase-admin';

// V1 Fallback for online payments (not tested in V2)
import { createOrderV1, processOrderV1 } from '@/app/api/order/create/legacy/createOrderV1_LEGACY';

import { deobfuscateGuestId, getOrCreateGuestProfile } from '@/lib/guest-utils';
import { calculateHaversineDistance, calculateDeliveryCharge } from '@/lib/distance';

// Services
import { calculateServerTotal, validatePriceMatch, calculateTaxes, PricingError } from './orderPricing';
import { findBusinessById } from '@/services/business/businessService';
import { paymentService } from '@/services/payment/payment.service';

// Repositories
import { orderRepository } from '@/repositories/order.repository';
import { businessRepository } from '@/repositories/business.repository';
import { idempotencyRepository } from '@/repositories/idempotency.repository';

// Response builders
import {
    buildCODResponse,
    buildRazorpayResponse,
    buildPhonePeResponse,
    buildAddonResponse,
    buildSplitBillResponse,
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
            price: item.portion.price || 0
        };
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
export async function createOrderV2(req) {
    console.log('[createOrderV2] Processing order request');

    try {
        const firestore = await getFirestore();

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
            businessType,      // ✅ Support all: 'restaurant', 'shop', 'street-vendor'
            deliveryType,      // ✅ Support all: 'dine-in', 'delivery', 'pickup', 'street-vendor-pre-order'
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
            discount = 0,
            diningPreference = null,
            idempotencyKey,
            existingOrderId, // Add-on flow
            guestRef,       // ✅ NEW: Guest Identity Ref
            guestToken      // ✅ NEW: Guest Identity Token (Session Check)
        } = body;

        // ✅ SANITIZATION: Only allow diningPreference for dine-in orders
        const sanitizedDiningPreference = (deliveryType === 'dine-in') ? diningPreference : null;

        // ✅ CRITICAL: Street vendors DON'T support add-ons!
        // Force new order creation by ignoring existingOrderId
        const finalExistingOrderId = (businessType === 'street-vendor') ? null : existingOrderId;

        if (businessType === 'street-vendor' && existingOrderId) {
            console.log(`[createOrderV2] 🚫 Street vendor detected - IGNORING existingOrderId ${existingOrderId}, creating NEW order`);
        }

        // ========================================
        // PAYMENT METHOD ROUTING
        // ===============================================
        // V1: Online payments (Razorpay, PhonePe) - Not tested in V2 yet
        // V2: COD, Cash, Counter - Tested and working
        const isOnlinePayment = paymentMethod === 'online' ||
            paymentMethod === 'razorpay' ||
            paymentMethod === 'phonepe';

        if (isOnlinePayment) {
            console.log('[createOrderV2] 🔄 Online payment → Using V1 (Body passed directly)');
            return await processOrderV1(body, firestore);
        }

        console.log('[createOrderV2] ✅ COD/Cash/Counter → Using V2 (tested)');

        // Basic validation
        if (!idempotencyKey) {
            return buildErrorResponse({
                message: 'Missing idempotency key. Please refresh and try again.',
                status: 400
            });
        }

        if (!restaurantId || !items || grandTotal === undefined) {
            return buildErrorResponse({
                message: 'Missing required fields for order creation.',
                status: 400
            });
        }

        // ========================================
        // STEP 2: BUSINESS LOOKUP
        // ========================================
        console.log(`[createOrderV2] Looking up business: ${restaurantId}`);

        const business = await findBusinessById(firestore, restaurantId);

        if (!business) {
            return buildErrorResponse({
                message: 'This business does not exist.',
                status: 404
            });
        }

        console.log(`[createOrderV2] Business found: ${business.data.name}`);

        // ========================================
        // STEP 3: IDEMPOTENCY CHECK
        // ========================================
        console.log(`[createOrderV2] Checking idempotency: ${idempotencyKey}`);

        try {
            const idempotencyResult = await idempotencyRepository.reserveAtomic(idempotencyKey, {
                restaurantId,
                paymentMethod
            });

            if (idempotencyResult.isDuplicate) {
                console.log(`[createOrderV2] Duplicate request detected, returning existing order`);

                // Get tracking token
                const existingOrder = await orderRepository.getById(idempotencyResult.orderId);

                return NextResponse.json({
                    message: 'Order already exists',
                    razorpay_order_id: idempotencyResult.razorpayOrderId,
                    firestore_order_id: idempotencyResult.orderId,
                    token: existingOrder?.trackingToken
                }, { status: 200 });
            }

            console.log(`[createOrderV2] Idempotency key reserved atomically`);

        } catch (error) {
            if (error.message === 'Request already in progress') {
                return buildErrorResponse({
                    message: error.message,
                    status: 429 // Use 429 for rate limit/concurrency
                });
            }
            throw error;
        }

        // ========================================
        // STEP 4: SERVER-SIDE PRICING (SECURITY)
        // ========================================
        console.log(`[createOrderV2] Calculating server-side prices`);

        let pricing;
        try {
            pricing = await calculateServerTotal({
                restaurantId: business.id, // ✅ FIX: Use resolved Business ID (not slug/ownerId)
                items,
                businessType: business.type
            });

            // Validate against client subtotal
            validatePriceMatch(subtotal, pricing.serverSubtotal);

            console.log(`[createOrderV2] Price validation passed: ₹${pricing.serverSubtotal}`);

        } catch (error) {
            if (error instanceof PricingError) {
                // Mark idempotency as failed
                await idempotencyRepository.fail(idempotencyKey, error);

                return buildErrorResponse({
                    message: error.message,
                    code: error.code,
                    status: 400
                });
            }
            throw error;
        }

        // --- SERVER-SIDE BILLING CALCULATIONS ---
        const taxes = calculateTaxes(pricing.serverSubtotal, business.data);
        const serverCgst = taxes.cgst;
        const serverSgst = taxes.sgst;
        const safeDiscount = 0;
        if (Number(discount) > 0) {
            console.warn('[createOrderV2] Ignoring client-provided discount; server side discount validation is required.');
        }

        // Re-validate delivery range/charge on server to prevent client tampering.
        let validatedDeliveryCharge = 0;
        if (deliveryType === 'delivery') {
            const customerLat = toFiniteNumber(address?.latitude ?? address?.lat);
            const customerLng = toFiniteNumber(address?.longitude ?? address?.lng);
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

            if (!address?.full || customerLat === null || customerLng === null || restaurantLat === null || restaurantLng === null) {
                await idempotencyRepository.fail(idempotencyKey, new Error('Invalid delivery address coordinates'));
                return buildErrorResponse({
                    message: 'A valid delivery address is required.',
                    status: 400
                });
            }

            const deliveryConfigSnap = await business.ref.collection('delivery_settings').doc('config').get();
            const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
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
            };

            if (settings.deliveryEnabled === false) {
                await idempotencyRepository.fail(idempotencyKey, new Error('Delivery disabled'));
                return buildErrorResponse({
                    message: 'Delivery is currently disabled for this restaurant.',
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

        const serverGrandTotal = pricing.serverSubtotal + serverCgst + serverSgst +
            validatedDeliveryCharge + (packagingCharge || 0) + (tipAmount || 0) +
            (platformFee || 0) + (convenienceFee || 0) + (serviceFee || 0) - safeDiscount;

        console.log(`[createOrderV2] Server billing verification: CGST=${serverCgst}, SGST=${serverSgst}, GrandTotal=${serverGrandTotal}`);

        // Optionally override body fields with server-verified ones
        // subtotal = pricing.serverSubtotal;
        // cgst = serverCgst;
        // sgst = serverSgst;
        // grandTotal = serverGrandTotal;

        // ========================================
        // STEP 5: BRANCH BY PAYMENT TYPE
        // ========================================

        // --- USER IDENTIFICATION (UID-FIRST PRIORITY) ---
        // Use getOrCreateGuestProfile to ensure:
        // 1. Logged-in users → use UID
        // 2. Guest users → create/use guest profile
        // 3. Security: UID prioritized over phone numbers

        const requestPhoneNormalized = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;

        let userId, normalizedPhone, isGuest;
        let finalCustomerName = name || 'Guest';

        if (requestPhoneNormalized) {
            // Call getOrCreateGuestProfile - UID first, then guest ID
            const profileResult = await getOrCreateGuestProfile(firestore, requestPhoneNormalized);
            userId = profileResult.userId;  // UID or guest ID
            isGuest = profileResult.isGuest;
            normalizedPhone = requestPhoneNormalized;
            const profileData = profileResult.data || {};

            console.log(`[createOrderV2] ✅ User identified: ${userId}, isGuest: ${isGuest}`);

            // ✅ AUTO-POPULATE CUSTOMER NAME
            // If name is missing or "Guest", try to get it from profile (if identified)
            if ((!name || name === 'Guest')) {
                if (profileData.name) {
                    finalCustomerName = profileData.name;
                    console.log(`[createOrderV2] ✅ Auto-populated customer name from profile result: ${finalCustomerName}`);
                } else if (userId && !isGuest) {
                    // Fallback: explicit fetch for logged-in users if profileData was missing (rare)
                    try {
                        const userDoc = await firestore.collection('users').doc(userId).get();
                        if (userDoc.exists && userDoc.data().name) {
                            finalCustomerName = userDoc.data().name;
                            console.log(`[createOrderV2] ✅ Auto-populated customer name from user doc: ${finalCustomerName}`);
                        }
                    } catch (err) {
                        console.warn(`[createOrderV2] Failed to fetch user profile for name:`, err);
                    }
                }
            }
        } else {
            // No phone - anonymous order
            userId = `anon_${nanoid(10)}`;
            isGuest = true;
            normalizedPhone = null;

            console.log(`[createOrderV2] ⚠️ Anonymous order: ${userId}`);
        }

        // Default if still missing
        if (!finalCustomerName) finalCustomerName = 'Guest';
        // Also check if address has a name property if specifically provided
        if ((!finalCustomerName || finalCustomerName === 'Guest') && address && address.name) {
            finalCustomerName = address.name;
            console.log(`[createOrderV2] ✅ Auto-populated customer name from address: ${finalCustomerName}`);
        }


        // Customer location (for delivery)
        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;

        // ✅ CRITICAL: For dine-in, lookup actual table ID (case-insensitive)
        let actualTableId = body.tableId;
        if (deliveryType === 'dine-in' && body.tableId) {
            try {
                const tablesSnap = await business.ref.collection('tables').get();
                tablesSnap.forEach(doc => {
                    if (doc.id.toLowerCase() === body.tableId.toLowerCase()) {
                        actualTableId = doc.id; // Use actual cased ID from DB
                    }
                });
                console.log(`[createOrderV2] Table ID normalized: ${body.tableId} → ${actualTableId}`);
            } catch (err) {
                console.warn(`[createOrderV2] Failed to lookup table ID:`, err);
                // Fallback to provided ID
            }
        }

        // ✅ CRITICAL FIX: For add-on orders, reuse existing order's token
        let trackingToken;

        if (finalExistingOrderId) {
            console.log(`[createOrderV2] Add-on order detected - fetching existing order token from ${finalExistingOrderId}`);
            try {
                const existingOrderDoc = await firestore.collection('orders').doc(finalExistingOrderId).get();
                if (existingOrderDoc.exists) {
                    trackingToken = existingOrderDoc.data().trackingToken;
                    console.log(`[createOrderV2] ✅ Reusing existing order token: ${trackingToken}`);
                } else {
                    console.warn(`[createOrderV2] Existing order ${finalExistingOrderId} not found! Generating new token.`);
                    trackingToken = await generateSecureToken(firestore, userId);
                }
            } catch (err) {
                console.error(`[createOrderV2] Failed to fetch existing order token:`, err);
                trackingToken = await generateSecureToken(firestore, userId);
            }
        } else {
            // New order - generate fresh token
            trackingToken = await generateSecureToken(firestore, userId);
        }

        // ========================================
        // ONLINE PAYMENT FLOW (Razorpay/PhonePe)
        // ========================================
        if (isOnlinePayment) {
            console.log(`[createOrderV2] Handling online payment: ${paymentMethod}`);

            // CRITICAL: Create Firestore order FIRST (same as V1)
            // Status: 'awaiting_payment' (webhook will change to 'pending')
            const firestoreOrderId = firestore.collection('orders').doc().id;

            const orderData = {
                customerName: finalCustomerName,
                customerId: userId,
                userId: userId,  // ✅ NEW: Unified userId field
                customerAddress: address?.full || null,
                customerPhone: normalizedPhone,
                customerLocation: customerLocation,
                restaurantId: business.id, // ✅ FIX: Use resolved Business ID
                restaurantName: business.data.name,
                businessType: business.type,
                deliveryType,
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
                discount: safeDiscount,
                totalAmount: serverGrandTotal, // Server-calculated
                status: 'awaiting_payment', // SAME as V1
                orderDate: FieldValue.serverTimestamp(),
                notes: notes || null,
                paymentDetails: [],
                trackingToken: trackingToken
            };

            // Create order in Firestore
            await orderRepository.create(orderData, firestoreOrderId);
            console.log(`[createOrderV2] Firestore order created: ${firestoreOrderId}`);

            // Build servizephyr_payload for webhook (V1 parity)
            const servizephyrPayload = {
                customerDetails: { name, phone: normalizedPhone, address },
                billDetails: { subtotal: pricing.serverSubtotal, grandTotal: serverGrandTotal, cgst: serverCgst, sgst: serverSgst, deliveryCharge: validatedDeliveryCharge, tipAmount },
                items: pricing.validatedItems.map(optimizeItemSnapshot), // OPTIMIZED
                restaurantId: business.id, // ✅ FIX
                userId,
                businessType: business.type,
                deliveryType,
                trackingToken,
                isNewUser: false // TODO: implement customer check
            };

            // Create payment gateway order
            const gateway = paymentService.determineGateway(paymentMethod);
            const paymentOrder = await paymentService.createPaymentOrder({
                gateway,
                amount: serverGrandTotal,
                orderId: firestoreOrderId,
                metadata: { restaurantName: business.data.name },
                servizephyrPayload
            });

            // Mark idempotency as completed
            await idempotencyRepository.complete(idempotencyKey, {
                orderId: firestoreOrderId,
                razorpayOrderId: paymentOrder.id,
                paymentMethod
            });

            // Return response based on gateway
            if (gateway === 'razorpay') {
                return buildRazorpayResponse({
                    razorpayOrderId: paymentOrder.id,
                    orderId: firestoreOrderId,
                    token: trackingToken
                });
            } else {
                return buildPhonePeResponse({
                    phonePeOrderId: paymentOrder.id,
                    orderId: firestoreOrderId,
                    token: trackingToken,
                    amount: serverGrandTotal
                });
            }
        }

        // ========================================
        // STEP 6: COD/COUNTER FLOW
        // ========================================
        console.log(`[createOrderV2] Creating COD/Counter order`);

        // ✅ DINE-IN TOKEN GENERATION (for post-paid dine-in AND street-vendor orders)
        let dineInToken = null;
        let newTokenNumber = null;

        // Generate token for:
        // 1. Post-paid dine-in orders (existing)
        // 2. Street vendor orders (NEW - they also need physical pickup tokens!)
        const needsPhysicalToken = (
            (deliveryType === 'dine-in' && business.data.dineInModel === 'post-paid') ||
            (business.type === 'street-vendor')
        );

        if (needsPhysicalToken) {
            console.log(`[createOrderV2] 🎫 Physical token needed (dine-in or street-vendor), generating token`);
            const dineInTabId = body.dineInTabId;

            if (dineInTabId) {
                try {
                    // Check for existing orders with this tabId to reuse token
                    const existingOrdersSnapshot = await firestore
                        .collection('orders')
                        .where('restaurantId', '==', restaurantId) // Can keep search on restaurantId as long as consistent
                        .where('dineInTabId', '==', dineInTabId)
                        .where('status', 'in', ['pending', 'accepted', 'preparing', 'ready', 'delivered'])
                        .limit(1)
                        .get();

                    if (!existingOrdersSnapshot.empty) {
                        // REUSE token from existing order
                        const existingOrder = existingOrdersSnapshot.docs[0].data();
                        dineInToken = existingOrder.dineInToken;

                        if (!dineInToken) {
                            // Existing order has no token, generate new
                            const lastToken = business.data.lastOrderToken || 0;
                            newTokenNumber = lastToken + 1;
                            const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                            const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                            const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                            dineInToken = `${newTokenNumber}-${randomChar1}${randomChar2}`;
                            console.log(`[createOrderV2] ⚠️ Existing order had no token, generated: ${dineInToken}`);
                        } else {
                            newTokenNumber = business.data.lastOrderToken || 0;
                            console.log(`[createOrderV2] ✅ REUSING token: ${dineInToken}`);
                        }
                    } else {
                        // Generate NEW token
                        const lastToken = business.data.lastOrderToken || 0;
                        newTokenNumber = lastToken + 1;
                        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                        dineInToken = `${newTokenNumber}-${randomChar1}${randomChar2}`;
                        console.log(`[createOrderV2] 🆕 NEW token generated: ${dineInToken}`);
                    }
                } catch (err) {
                    console.error(`[createOrderV2] Token generation error:`, err);
                    // Fallback: generate new token
                    const lastToken = business.data.lastOrderToken || 0;
                    newTokenNumber = lastToken + 1;
                    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                    dineInToken = `${newTokenNumber}-${randomChar1}${randomChar2}`;
                }
            } else {
                // No tabId, generate token anyway (street vendors always get tokens!)
                const lastToken = business.data.lastOrderToken || 0;
                newTokenNumber = lastToken + 1;
                const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const randomChar1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                const randomChar2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                dineInToken = `${newTokenNumber}-${randomChar1}${randomChar2}`;
                console.log(`[createOrderV2] ⚠️ No tabId, generated token: ${dineInToken}`);
            }
        }

        // Build order data (SAME structure as V1)
        const orderData = {
            customerName: (deliveryType === 'dine-in' ? (body.tab_name || body.customerName || 'Guest') : finalCustomerName),
            customerId: userId,
            userId: userId,  // ✅ NEW: Unified userId field for queries
            customerAddress: address?.full || null,
            customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: business.id, // ✅ FIX: Use resolved Business ID
            restaurantName: business.data.name,
            businessType: business.type,
            deliveryType,
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
            discount: safeDiscount,
            totalAmount: serverGrandTotal,
            status: 'pending', // SAME status as V1
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            // ✅ Dine-in specific fields
            ...(deliveryType === 'dine-in' && {
                tableId: actualTableId, // Use normalized table ID
                pax_count: body.pax_count,
                tab_name: body.tab_name,
                dineInTabId: body.dineInTabId
            }),
            paymentDetails: [{
                method: 'cod',
                amount: serverGrandTotal,
                status: 'pending',
                timestamp: new Date()
            }],
            trackingToken: trackingToken,
            // ✅ Dine-in fields
            dineInTabId: body.dineInTabId || null,
            tableId: actualTableId || null,  // USE normalized table ID
            dineInToken: dineInToken, // Token for post-paid dine-in
        };

        console.log(`[createOrderV2] 💾 Order data prepared with dineInToken: '${dineInToken}'`);

        // Create order
        const orderId = await orderRepository.create(orderData);

        console.log(`[createOrderV2] Order created: ${orderId}`);

        // Mark idempotency as completed
        await idempotencyRepository.complete(idempotencyKey, {
            orderId,
            paymentMethod: 'cod'
        });

        // ✅ Update token counter for post-paid dine-in AND street vendors
        if (newTokenNumber !== null) {
            try {
                await firestore.collection(business.collection).doc(business.id).update({
                    lastOrderToken: newTokenNumber
                });
                console.log(`[createOrderV2] 🔢 Updated lastOrderToken to ${newTokenNumber} for ${business.type}`);
            } catch (err) {
                console.warn(`[createOrderV2] Failed to update token counter:`, err);
            }
        }

        // ✅ DINE-IN TAB UPDATES (CRITICAL: add to subcollection + update tab)
        // PERMANENT FIX: ALWAYS create/update tab document for proper lifecycle tracking
        if (deliveryType === 'dine-in' && body.dineInTabId && business.data.dineInModel === 'post-paid') {
            const dineInTabId = body.dineInTabId;
            try {
                const tabRef = firestore.collection(business.collection).doc(business.id)
                    .collection('dineInTabs').doc(dineInTabId);

                const tabSnap = await tabRef.get();
                const batch = firestore.batch();

                if (tabSnap.exists) {
                    // ✅ Tab exists - update it
                    const tabStatus = tabSnap.data()?.status;

                    // Only update if not completed/closed
                    if (['inactive', 'pending', 'active'].includes(tabStatus)) {
                        // Add to tab's orders subcollection
                        const tabOrderRef = tabRef.collection('orders').doc(orderId);
                        batch.set(tabOrderRef, {
                            orderId: orderId,
                            totalAmount: grandTotal,
                            status: 'pending',
                            createdAt: FieldValue.serverTimestamp()
                        });

                        // Update tab document
                        batch.update(tabRef, {
                            totalBill: FieldValue.increment(grandTotal),
                            status: 'active',
                            updatedAt: FieldValue.serverTimestamp()
                        });

                        await batch.commit();
                        console.log(`[createOrderV2] ✅ Updated existing tab ${dineInTabId} (${tabStatus}→active): +₹${grandTotal}`);
                    } else {
                        console.warn(`[createOrderV2] ⚠️ Tab ${dineInTabId} status=${tabStatus}, cannot add order`);
                    }
                } else {
                    // ✅ Tab doesn't exist - CREATE IT (PERMANENT FIX)
                    console.log(`[createOrderV2] 🆕 Creating new tab document for ${dineInTabId}`);

                    // Create tab document
                    batch.set(tabRef, {
                        id: dineInTabId,
                        tableId: actualTableId, // Use normalized table ID
                        tab_name: body.tab_name || 'Guest',
                        pax_count: body.pax_count || 1,
                        status: 'active',
                        totalBill: grandTotal,
                        paidAmount: 0,
                        pendingAmount: grandTotal,
                        createdAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });

                    // Add to tab's orders subcollection
                    const tabOrderRef = tabRef.collection('orders').doc(orderId);
                    batch.set(tabOrderRef, {
                        orderId: orderId,
                        totalAmount: grandTotal,
                        status: 'pending',
                        createdAt: FieldValue.serverTimestamp()
                    });

                    await batch.commit();
                    console.log(`[createOrderV2] ✅ Created new tab ${dineInTabId} with order ${orderId}`);
                }
            } catch (tabErr) {
                console.error(`[createOrderV2] ❌ Tab update failed:`, tabErr);
            }
        }

        // ========================================
        // STEP 7: RETURN RESPONSE
        // ========================================
        return buildCODResponse({
            orderId,
            token: trackingToken
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
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h validity

    const tokenData = {
        userId: userId,  // Store unified userId (UID or guest ID)
        expiresAt: expiry,
        type: 'tracking'
    };

    await firestore.collection('auth_tokens').doc(token).set(tokenData);

    return token;
}


