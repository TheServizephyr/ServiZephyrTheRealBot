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
import { createOrderV1 } from '@/app/api/order/create/legacy/createOrderV1';

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
            diningPreference = null,
            idempotencyKey,
            existingOrderId, // Add-on flow
        } = body;

        // ========================================
        // PAYMENT METHOD ROUTING
        // ===============================================
        // V1: Online payments (Razorpay, PhonePe) - Not tested in V2 yet
        // V2: COD, Cash, Counter - Tested and working
        const isOnlinePayment = paymentMethod === 'online' ||
            paymentMethod === 'razorpay' ||
            paymentMethod === 'phonepe';

        if (isOnlinePayment) {
            console.log('[createOrderV2] 🔄 Online payment → Using V1 (not tested in V2)');
            return await createOrderV1(req);
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
            const duplicateCheck = await idempotencyRepository.checkDuplicate(idempotencyKey);

            if (duplicateCheck.isDuplicate) {
                console.log(`[createOrderV2] Duplicate request detected, returning existing order`);

                // Get tracking token
                const existingOrder = await orderRepository.getById(duplicateCheck.orderId);

                return NextResponse.json({
                    message: 'Order already exists',
                    razorpay_order_id: duplicateCheck.razorpayOrderId,
                    firestore_order_id: duplicateCheck.orderId,
                    token: existingOrder?.trackingToken
                }, { status: 200 });
            }

            // Reserve key
            await idempotencyRepository.reserve(idempotencyKey, {
                restaurantId,
                paymentMethod
            });

            console.log(`[createOrderV2] Idempotency key reserved`);

        } catch (error) {
            if (error.message === 'Request already in progress') {
                return buildErrorResponse({
                    message: error.message,
                    status: 400
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
                restaurantId,
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

        // ========================================
        // STEP 5: BRANCH BY PAYMENT TYPE
        // ========================================

        // Normalize phone
        const normalizedPhone = phone ? (phone.length > 10 ? phone.slice(-10) : phone) : null;
        const userId = normalizedPhone || `anon_${nanoid(10)}`;

        // Customer location (for delivery)
        const customerLocation = (deliveryType === 'delivery' && address && typeof address.latitude === 'number')
            ? new GeoPoint(address.latitude, address.longitude)
            : null;

        // Generate tracking token
        const trackingToken = await generateSecureToken(firestore, normalizedPhone || `order_${Date.now()}`);

        // ========================================
        // ONLINE PAYMENT FLOW (Razorpay/PhonePe)
        // ========================================
        if (isOnlinePayment) {
            console.log(`[createOrderV2] Handling online payment: ${paymentMethod}`);

            // CRITICAL: Create Firestore order FIRST (same as V1)
            // Status: 'awaiting_payment' (webhook will change to 'pending')
            const firestoreOrderId = firestore.collection('orders').doc().id;

            const orderData = {
                customerName: name || 'Guest',
                customerId: userId,
                customerAddress: address?.full || null,
                customerPhone: normalizedPhone,
                customerLocation: customerLocation,
                restaurantId: restaurantId,
                restaurantName: business.data.name,
                businessType: business.type,
                deliveryType,
                pickupTime: body.pickupTime || '',
                tipAmount: tipAmount || 0,
                items: pricing.validatedItems, // Server-validated
                subtotal: pricing.serverSubtotal, // Server-calculated
                cgst: cgst || 0,
                sgst: sgst || 0,
                deliveryCharge: deliveryCharge || 0,
                diningPreference: diningPreference,
                packagingCharge: packagingCharge || 0,
                totalAmount: grandTotal,
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
                billDetails: { subtotal: pricing.serverSubtotal, grandTotal, cgst, sgst, deliveryCharge, tipAmount },
                items: pricing.validatedItems,
                restaurantId,
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
                amount: grandTotal,
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
                    amount: grandTotal
                });
            }
        }

        // ========================================
        // STEP 6: COD/COUNTER FLOW
        // ========================================
        console.log(`[createOrderV2] Creating COD/Counter order`);

        // ✅ DINE-IN TOKEN GENERATION (for post-paid dine-in)
        let dineInToken = null;
        let newTokenNumber = null;

        if (deliveryType === 'dine-in' && business.data.dineInModel === 'post-paid') {
            console.log(`[createOrderV2] 🎫 Post-paid dine-in detected, generating token`);
            const dineInTabId = body.dineInTabId;

            if (dineInTabId) {
                try {
                    // Check for existing orders with this tabId to reuse token
                    const existingOrdersSnapshot = await firestore
                        .collection('orders')
                        .where('restaurantId', '==', restaurantId)
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
                // No tabId, generate token anyway
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
            customerName: name || 'Guest',
            customerId: userId,
            customerAddress: address?.full || null,
            customerPhone: normalizedPhone,
            customerLocation: customerLocation,
            restaurantId: restaurantId,
            restaurantName: business.data.name,
            businessType: business.type,
            deliveryType,
            pickupTime: body.pickupTime || '',
            tipAmount: tipAmount || 0,
            items: pricing.validatedItems, // Server-validated items
            subtotal: pricing.serverSubtotal, // Server-calculated
            cgst: cgst || 0,
            sgst: sgst || 0,
            deliveryCharge: deliveryCharge || 0,
            diningPreference: diningPreference,
            packagingCharge: packagingCharge || 0,
            totalAmount: grandTotal,
            status: 'pending', // SAME status as V1
            orderDate: FieldValue.serverTimestamp(),
            notes: notes || null,
            paymentDetails: [{
                method: 'cod',
                amount: grandTotal,
                status: 'pending',
                timestamp: new Date()
            }],
            trackingToken: trackingToken,
            // ✅ Dine-in fields
            dineInTabId: body.dineInTabId || null,
            tableId: body.tableId?.toUpperCase() || null,  // ✅ Normalize to uppercase
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

        // ✅ Update token counter for post-paid dine-in
        if (newTokenNumber !== null && deliveryType === 'dine-in' && business.data.dineInModel === 'post-paid') {
            try {
                await firestore.collection(business.collection).doc(business.id).update({
                    lastOrderToken: newTokenNumber
                });
                console.log(`[createOrderV2] 🔢 Updated lastOrderToken to ${newTokenNumber}`);
            } catch (err) {
                console.warn(`[createOrderV2] Failed to update token counter:`, err);
            }
        }

        // ✅ DINE-IN TAB UPDATES (CRITICAL: add to subcollection + update tab)
        if (deliveryType === 'dine-in' && body.dineInTabId && business.data.dineInModel === 'post-paid') {
            const dineInTabId = body.dineInTabId;
            try {
                const tabRef = firestore.collection(business.collection).doc(business.id)
                    .collection('dineInTabs').doc(dineInTabId);

                const tabSnap = await tabRef.get();
                const tabStatus = tabSnap.data()?.status;

                // ✅ Allow 'inactive' (form created), 'pending' (reserved), and 'active' (has orders)
                // ❌ Skip 'closed', 'cleared', or non-existent tabs
                if (tabSnap.exists && ['inactive', 'pending', 'active'].includes(tabStatus)) {
                    const batch = firestore.batch();

                    // Add to tab's orders subcollection
                    const tabOrderRef = tabRef.collection('orders').doc(orderId);
                    batch.set(tabOrderRef, {
                        orderId: orderId,
                        totalAmount: grandTotal,
                        status: 'pending',
                        createdAt: FieldValue.serverTimestamp()
                    });

                    // Update tab document (pending → active transition)
                    batch.update(tabRef, {
                        totalBill: FieldValue.increment(grandTotal),
                        status: 'active',  // ✅ Activate tab when first order placed
                        updatedAt: FieldValue.serverTimestamp()
                    });

                    await batch.commit();
                    console.log(`[createOrderV2] ✅ Tab ${dineInTabId} (${tabStatus}→active): +₹${grandTotal}, order added`);
                } else {
                    console.warn(`[createOrderV2] ⚠️ Tab ${dineInTabId} not found or status=${tabStatus}, skipping`);
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
async function generateSecureToken(firestore, identifier) {
    const token = nanoid(24);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h validity

    await firestore.collection('auth_tokens').doc(token).set({
        phone: identifier,
        expiresAt: expiry,
        type: 'tracking'
    });

    return token;
}
