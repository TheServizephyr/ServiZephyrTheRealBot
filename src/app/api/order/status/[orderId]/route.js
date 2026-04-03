import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import { kv, isKvConfigured } from '@/lib/kv';
import { createRequestCache } from '@/lib/requestCache';
import { trackEndpointRead } from '@/lib/readTelemetry';
import { trackApiTelemetry } from '@/lib/opsTelemetry';
import {
    buildOrderStatusCacheKey,
    buildOrderStatusCacheVariantKey,
    mergeOrderStatusCachedVariant,
    readOrderStatusCachedVariant,
} from '@/lib/orderStatusCache';
import { enforceRateLimit, readSignedGuestSessionCookie, verifyScopedAuthToken } from '@/lib/public-auth';
import { recordSecurityAnomaly } from '@/lib/security/security-events';
import { hashAuditValue, logRequestAudit } from '@/lib/security/request-audit';

// Final states that should NOT be cached (polling already stopped on track page)
const FINAL_STATES = ['delivered', 'cancelled', 'rejected'];
const isOrderStatusDebugEnabled = process.env.DEBUG_ORDER_STATUS === 'true';
const debugLog = (...args) => {
    if (isOrderStatusDebugEnabled) {
        console.log(...args);
    }
};
const getClientIp = (req) => {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
};

export async function GET(request, { params }) {
    const telemetryStartedAt = Date.now();
    let telemetryStatus = 200;
    let telemetryError = null;
    let telemetryEndpoint = 'api.order.status.full';
    let telemetryContext = null;
    let auditActorUid = null;
    const auditTokenId = hashAuditValue(request.nextUrl.searchParams.get('token') || params?.orderId || '');
    const respond = (payload, status = 200, headers = undefined, metadata = {}) => {
        telemetryStatus = status;
        logRequestAudit({
            req: request,
            statusCode: status,
            source: 'order_status',
            actorUid: auditActorUid,
            tokenId: auditTokenId,
            metadata: {
                endpoint: telemetryEndpoint,
                ...metadata,
            },
        });
        return NextResponse.json(payload, {
            status,
            ...(headers ? { headers } : {}),
        });
    };

    debugLog("[API][Order Status] GET request received.");
    try {
        const { orderId } = params;
        const liteMode = ['1', 'true', 'yes'].includes(String(request.nextUrl.searchParams.get('lite') || '').toLowerCase());
        telemetryEndpoint = liteMode ? 'api.order.status.lite' : 'api.order.status.full';
        telemetryContext = {
            liteMode,
            orderId: orderId || null,
        };

        if (!orderId) {
            debugLog("[API][Order Status] Error: Order ID is missing from params.");
            return respond({ message: 'Order ID is missing.' }, 400, undefined, {
                outcome: 'missing_order_id',
            });
        }

        // Cache lookup happens only after auth mode is known so public and private payloads never mix.
        const isKvAvailable = isKvConfigured();

        // STEP 2: Cache MISS - Fetch from Firestore with request-scoped deduplication
        const requestCache = createRequestCache();
        const firestore = await getFirestore();
        const rateKey = `order-status:${getClientIp(request)}:${String(orderId || 'unknown')}`;
        const rate = await enforceRateLimit(firestore, {
            key: rateKey,
            limit: 120,
            windowSec: 60,
            req: request,
            auditContext: 'order_status',
        });
        if (!rate.allowed) {
            return respond({ message: 'Too many tracking requests. Please retry shortly.' }, 429, undefined, {
                outcome: 'rate_limited',
                orderId,
            });
        }
        debugLog(`[API][Order Status] Fetching order document: ${orderId}`);

        let orderSnap;
        let orderRef;

        // If orderId is a Tab ID (starts with 'tab_'), find the most recent order for this tab
        if (orderId.startsWith('tab_')) {
            debugLog(`[API][Order Status] ID is a Tab ID. Querying for latest order in tab: ${orderId}`);
            // ✅ FIXED: Using indexed query with .orderBy and .limit
            const tabOrdersQuery = await firestore.collection('orders')
                .where('dineInTabId', '==', orderId)
                .orderBy('createdAt', 'desc')
                .limit(1)
                .get();

            if (tabOrdersQuery.empty) {
                debugLog(`[API][Order Status] Error: No orders found for tab ${orderId}.`);
                return respond({ message: 'No orders found for this tab.' }, 404, undefined, {
                    outcome: 'not_found',
                    mode: 'tab',
                    orderId,
                });
            }

            orderSnap = tabOrdersQuery.docs[0];
            orderRef = orderSnap.ref;
            debugLog(`[API][Order Status] Found latest order for tab via index: ${orderSnap.id}`);
        } else {
            // Normal Order ID lookup
            orderRef = firestore.collection('orders').doc(orderId);
            orderSnap = await orderRef.get();

            if (!orderSnap.exists) {
                debugLog(`[API][Order Status] Error: Order document ${orderId} not found.`);
                return respond({ message: 'Order not found.' }, 404, undefined, {
                    outcome: 'not_found',
                    mode: 'order',
                    orderId,
                });
            }
        }

        const orderData = orderSnap.data();
        auditActorUid = String(orderData.userId || orderData.customerId || '').trim() || null;

        // 🔐 IDENTITY GATING (P1): Verify requester has permission to view this status
        // Allow if:
        // 1. Valid tracking link (possession of orderId is usually enough for public track, but we add trackingToken check)
        // 2. Logged in and matches customerId/userId

        const trackingToken = request.nextUrl.searchParams.get('token');
        let isAuthorizedData = false;
        let authMode = 'none';

        // Condition A: Correct Tracking Token provided
        if (trackingToken && orderData.trackingToken === trackingToken) {
            const tokenCheck = await verifyScopedAuthToken(firestore, trackingToken, {
                allowedTypes: ['tracking', 'whatsapp'],
                requiredScopes: ['track_orders'],
                subjectId: orderData.userId || orderData.customerId || orderData.customerPhone || '',
                orderId: orderSnap.id,
                req: request,
                auditContext: 'order_status',
            });
            if (tokenCheck.valid) {
                isAuthorizedData = true;
                authMode = 'token';
            }
        }

        // Condition B: Authenticated User (Owner or Customer)
        if (!isAuthorizedData) {
            try {
                const uid = await verifyAndGetUid(request);
                if (uid === orderData.userId || uid === orderData.customerId || uid === orderData.restaurantId) {
                    isAuthorizedData = true;
                    authMode = 'user';
                }
            } catch (e) {
                // Not authenticated or error, ignore
            }
        }

        // Reject both missing-token and invalid-token public access. Merely passing any token value
        // must never authorize a public tracking response.
        if (!isAuthorizedData) {
            console.warn(`[API][Order Status] Access denied for order ${orderId}. No valid token or identity.`);
            void recordSecurityAnomaly({
                type: 'order_status_probe',
                key: `${getClientIp(request)}:${orderId}`,
                threshold: 10,
                windowSec: 300,
                req: request,
                source: 'order_status',
                metadata: { hasToken: !!trackingToken },
            });
            return respond(
                {
                    message: trackingToken
                        ? 'Unauthorized. Invalid or expired tracking token.'
                        : 'Unauthorized. Tracking token required.',
                },
                403,
                undefined,
                {
                    outcome: trackingToken ? 'invalid_token' : 'missing_token',
                    orderId,
                    authMode,
                }
            );
        }

        const isPublicTokenAccess = authMode === 'token';
        const guestSession = isPublicTokenAccess
            ? readSignedGuestSessionCookie(request.cookies, ['track_orders'])
            : null;
        const canRevealCustomerAddress = !isPublicTokenAccess || (
            guestSession
            && [orderData.userId, orderData.customerId]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .includes(String(guestSession.subjectId || '').trim())
        );
        const cacheVisibility = isPublicTokenAccess ? 'public' : 'private';
        const addressVisibility = canRevealCustomerAddress ? 'address' : 'masked';
        const cacheKey = buildOrderStatusCacheKey(orderId);
        const cacheVariantKey = buildOrderStatusCacheVariantKey({
            liteMode,
            cacheVisibility,
            addressVisibility,
        });
        let cachedRecord = null;

        if (isKvAvailable && cacheKey) {
            try {
                cachedRecord = await kv.get(cacheKey);
                const cachedData = readOrderStatusCachedVariant(cachedRecord, cacheVariantKey);
                if (cachedData) {
                    debugLog(`[Order Status API] ✅ Cache HIT for ${cacheKey} (${cacheVariantKey})`);
                    return respond(cachedData, 200, {
                        'X-Cache': 'HIT',
                        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                    }, {
                        outcome: 'resolved',
                        cache: 'hit',
                        mode: cacheVisibility,
                        addressVisibility,
                    });
                }
                debugLog(`[Order Status API] ❌ Cache MISS for ${cacheKey} (${cacheVariantKey}) - Fetching from Firestore`);
            } catch (cacheError) {
                console.warn('[Order Status API] Cache check failed:', cacheError);
            }
        }

        // Fast path for polling/token checks: avoids extra business + rider reads and heavy aggregation.
        if (liteMode) {
            const litePayload = {
                order: {
                    id: orderSnap.id,
                    customerOrderId: orderData.customerOrderId,
                    restaurantId: orderData.restaurantId || null,
                    status: orderData.status,
                    customerName: orderData.customerName || null,
                    customerPhone: isPublicTokenAccess ? null : (orderData.customerPhone || null),
                    deliveryType: orderData.deliveryType || 'delivery',
                    dineInToken: orderData.dineInToken || null,
                    tableId: orderData.tableId || null,
                    dineInTabId: orderData.dineInTabId || orderData.tabId || null,
                    isCarOrder: orderData.isCarOrder || orderData.deliveryType === 'car-order',
                    carSpot: orderData.carSpot || null,
                    carDetails: orderData.carDetails || null,
                    trackingToken: isPublicTokenAccess ? null : (orderData.trackingToken || null),
                    createdAt: orderData.createdAt?.toDate ? orderData.createdAt.toDate() : orderData.createdAt,
                }
            };

            const isFinalStateLite = FINAL_STATES.includes(orderData.status);
            if (!isFinalStateLite && isKvAvailable && cacheKey) {
                try {
                    await kv.set(
                        cacheKey,
                        mergeOrderStatusCachedVariant(cachedRecord, cacheVariantKey, litePayload),
                        { ex: 30 }
                    );
                } catch {
                    // Non-fatal
                }
            }
            await trackEndpointRead('api.order.status.lite', 1);

            return respond(litePayload, 200, {
                'X-Mode': 'lite',
                'X-Cache': 'MISS',
            });
        }

        const businessType = orderData.businessType || 'restaurant';
        const collectionName = businessType === 'street-vendor'
            ? 'street_vendors'
            : ((businessType === 'shop' || businessType === 'store') ? 'shops' : 'restaurants');
        const normalizedBusinessType = businessType === 'shop' ? 'store' : businessType;

        let deliveryBoyData = null;

        if (orderData.deliveryBoyId) {
            debugLog(`[API][Order Status] Fetching delivery boy: ${orderData.deliveryBoyId} from drivers collection.`);

            const driverDocRef = firestore.collection('drivers').doc(orderData.deliveryBoyId);
            const driverDoc = await requestCache.get(
                `driver:${orderData.deliveryBoyId}`,
                () => driverDocRef.get()
            );

            if (driverDoc.exists) {
                const driverData = driverDoc.data();

                // ✅ STEP 3B: Detect stale rider (offline detection)
                let riderOnline = true;

                if (driverData.lastLocationUpdate) {
                    const lastUpdate = driverData.lastLocationUpdate.toDate().getTime();
                    const now = Date.now();
                    const diffMinutes = (now - lastUpdate) / (1000 * 60);

                    if (diffMinutes > 2) { // ⚠️ 2 minutes no update = offline
                        riderOnline = false;
                        debugLog(`[API][Order Status] Rider ${orderData.deliveryBoyId} appears offline. Last update: ${diffMinutes.toFixed(1)} min ago.`);
                    }
                }

                // ✅ STEP 7A: Calculate distance and ETA
                let distanceKm = null;
                let eta = null;

                if (driverData.currentLocation && orderData.customerLocation) {
                    // Haversine formula for distance calculation
                    const getDistanceKm = (lat1, lon1, lat2, lon2) => {
                        const R = 6371; // Earth radius in km
                        const dLat = (lat2 - lat1) * Math.PI / 180;
                        const dLon = (lon2 - lon1) * Math.PI / 180;

                        const a =
                            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                            Math.cos(lat1 * Math.PI / 180) *
                            Math.cos(lat2 * Math.PI / 180) *
                            Math.sin(dLon / 2) * Math.sin(dLon / 2);

                        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                        return R * c;
                    };

                    // Extract coordinates (handle both GeoPoint and plain objects)
                    const riderLat = driverData.currentLocation._latitude || driverData.currentLocation.latitude;
                    const riderLng = driverData.currentLocation._longitude || driverData.currentLocation.longitude;
                    const customerLat = orderData.customerLocation._latitude || orderData.customerLocation.latitude;
                    const customerLng = orderData.customerLocation._longitude || orderData.customerLocation.longitude;

                    if (riderLat && riderLng && customerLat && customerLng) {
                        distanceKm = getDistanceKm(riderLat, riderLng, customerLat, customerLng);

                        // ✅ STEP 7B: Smart ETA estimation (VAGUE for safety)
                        // User requested to remove specific timings to avoid anger due to straight-line inaccuracy.
                        const estimateETA = (dist) => {
                            if (dist < 2) return "Arriving Soon";
                            return "On the Way";
                        };

                        eta = estimateETA(distanceKm);
                        debugLog(`[API][Order Status] Distance: ${distanceKm.toFixed(2)} km, ETA: ${eta}`);
                    }
                }

                deliveryBoyData = {
                    id: driverDoc.id,
                    ...driverData,
                    isOnline: riderOnline,
                    distanceKm: distanceKm ? parseFloat(distanceKm.toFixed(2)) : null, // ✅ STEP 7A
                    eta: eta // ✅ STEP 7B
                };
                debugLog(`[API][Order Status] Delivery boy found. Online: ${riderOnline}, Distance: ${distanceKm?.toFixed(2) || 'N/A'} km`);
            } else {
                console.warn(`[API][Order Status] Delivery boy with ID ${orderData.deliveryBoyId} not found in the main 'drivers' collection.`);

                // Fallback: restaurant-level rider profile (for legacy/manual rider setups)
                try {
                    const riderSubDoc = await requestCache.get(
                        `rider_subdoc:${collectionName}:${orderData.restaurantId}:${orderData.deliveryBoyId}`,
                        () => firestore
                            .collection(collectionName)
                            .doc(orderData.restaurantId)
                            .collection('deliveryBoys')
                            .doc(orderData.deliveryBoyId)
                            .get()
                    );

                    if (riderSubDoc.exists) {
                        const riderData = riderSubDoc.data() || {};
                        deliveryBoyData = {
                            id: riderSubDoc.id,
                            ...riderData,
                            isOnline: riderData.status === 'Available' || riderData.status === 'online',
                            distanceKm: null,
                            eta: null,
                            currentLocation: riderData.currentLocation || riderData.location || null
                        };
                        debugLog(`[API][Order Status] Fallback rider found in ${collectionName}/${orderData.restaurantId}/deliveryBoys/${orderData.deliveryBoyId}`);
                    }
                } catch (fallbackErr) {
                    console.warn('[API][Order Status] Rider subcollection fallback failed:', fallbackErr?.message || fallbackErr);
                }
            }
        }

        const businessDoc = await requestCache.get(
            `business:${collectionName}:${orderData.restaurantId}`,
            () => firestore.collection(collectionName).doc(orderData.restaurantId).get()
        );

        if (!businessDoc || !businessDoc.exists) {
            debugLog(`[API][Order Status] Error: Business ${orderData.restaurantId} not found in collection ${collectionName}.`);
            return respond({ message: 'Business associated with order not found.' }, 404);
        }
        const businessData = businessDoc.data();
        debugLog("[API][Order Status] Business found.");

        const restaurantLocationForMap = (businessData.address && typeof businessData.address.latitude === 'number' && typeof businessData.address.longitude === 'number')
            ? { lat: businessData.address.latitude, lng: businessData.address.longitude }
            : null;

        // For dine-in orders with dineInTabId, aggregate ALL orders in the same tab
        let aggregatedItems = orderData.items || [];
        let aggregatedSubtotal = orderData.subtotal || 0;
        let aggregatedCgst = orderData.cgst || 0;
        let aggregatedSgst = orderData.sgst || 0;
        let aggregatedDeliveryCharge = Number(orderData.deliveryCharge || 0);
        let aggregatedServiceFee = Number(orderData.serviceFee || 0);
        let aggregatedServiceFeeLabel = String(orderData.serviceFeeLabel || '').trim() || null;
        let aggregatedTotal = orderData.totalAmount || 0;
        let aggregatedPaymentStatus = orderData.paymentStatus || 'pending'; // Start with current order's status

        if (orderData.deliveryType === 'dine-in' || orderData.deliveryType === 'car-order') {
            debugLog(`[API][Order Status] Dine-in-like order detected (${orderData.deliveryType}). Attempting aggregation...`);
            try {
                // STRATEGY: 
                // 1. If 'dineInToken' exists, group mainly by Token (matches Owner Dashboard behavior).
                // 2. Fallback to 'dineInTabId'/'tabId' if Token is missing.

                const dineInToken = orderData.dineInToken;
                const currentTabId = orderData.dineInTabId || orderData.tabId;

                let tabOrdersSnapshot = { empty: true, docs: [] };
                let aggregationMethod = 'none';

                if (dineInToken) {
                    debugLog(`[API][Order Status] Aggregating by Token: ${dineInToken}`);
                    aggregationMethod = 'token';

                    // Dine-in keeps table constraint, car-order uses token+restaurant grouping.
                    let tokenQuery = firestore
                        .collection('orders')
                        .where('restaurantId', '==', orderData.restaurantId)
                        .where('dineInToken', '==', dineInToken)
                        .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'rejected', 'cancelled']);

                    if (orderData.deliveryType === 'dine-in' && orderData.tableId) {
                        tokenQuery = tokenQuery.where('tableId', '==', orderData.tableId);
                    }

                    tabOrdersSnapshot = await tokenQuery.get();

                } else if (currentTabId) {
                    debugLog(`[API][Order Status] Aggregating by ID (Token missing): ${currentTabId}`);
                    aggregationMethod = 'id';

                    // Fallback: Dual ID Query
                    const [snap1, snap2] = await Promise.all([
                        firestore.collection('orders')
                            .where('restaurantId', '==', orderData.restaurantId)
                            .where('dineInTabId', '==', currentTabId)
                            .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'rejected', 'cancelled'])
                            .get(),
                        firestore.collection('orders')
                            .where('restaurantId', '==', orderData.restaurantId)
                            .where('tabId', '==', currentTabId)
                            .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready_for_pickup', 'delivered', 'rejected', 'cancelled'])
                            .get()
                    ]);
                    // Merge snaps
                    const uniqueDocs = new Map();
                    snap1.forEach(d => uniqueDocs.set(d.id, d));
                    snap2.forEach(d => uniqueDocs.set(d.id, d));

                    tabOrdersSnapshot = {
                        empty: uniqueDocs.size === 0,
                        docs: Array.from(uniqueDocs.values()),
                        forEach: (cb) => uniqueDocs.forEach((val, key) => cb({ id: key, data: () => val.data(), ...val })) // Mock forEach for consistent API if needed, or just iterate docs
                    };
                }

                // Process Snapshot
                const docsToProcess = tabOrdersSnapshot.docs || [];
                if (docsToProcess.length > 0) {
                    aggregatedItems = [];
                    aggregatedSubtotal = 0;
                    aggregatedCgst = 0;
                    aggregatedSgst = 0;
                    aggregatedDeliveryCharge = 0;
                    aggregatedServiceFee = 0;
                    aggregatedServiceFeeLabel = null;
                    aggregatedTotal = 0;
                    // Reset payment status to pending before checking all docs (unless we want to prioritize 'paid')
                    // Logic: If ANY order is paid, the bill is PAID.
                    // If ANY order is pay_at_counter (and not paid), status is pay_at_counter.
                    let hasPaid = false;
                    let hasPayAtCounter = false;

                    const batchesList = [];
                    const processedIds = new Set();
                    const seenCartItems = new Set(); // DEDUPLICATION: Track unique items

                    // Using simple loop instead of .forEach to handle both Snapshot and Array
                    for (const doc of docsToProcess) {
                        // doc might be a QueryDocumentSnapshot (has .data()) or our mock (has .data())
                        // Our mock above passed the raw doc, which IS a Snapshot.
                        // Wait, in 'id' fallback, I stored 'd' which is QueryDocumentSnapshot.

                        if (processedIds.has(doc.id)) continue;
                        processedIds.add(doc.id);

                        const tabOrder = doc.data();

                        // ADD TO BATCHES
                        batchesList.push({
                            id: doc.id,
                            ...tabOrder
                        });

                        // Check payment status from this order
                        if (tabOrder.paymentStatus === 'paid') hasPaid = true;
                        if (tabOrder.paymentStatus === 'pay_at_counter') hasPayAtCounter = true;

                        // AGGREGATE BILL (Exclude cancelled/rejected for strict billing, but keep in list)
                        if (!['rejected', 'cancelled'].includes(tabOrder.status)) {
                            if (tabOrder.items) {
                                // DEDUPLICATION: Only add unique items
                                for (const item of tabOrder.items) {
                                    const itemKey = `${doc.id}-${item.cartItemId || item.id}`;
                                    if (!seenCartItems.has(itemKey)) {
                                        seenCartItems.add(itemKey);
                                        aggregatedItems.push(item);
                                    }
                                }
                            }
                            aggregatedSubtotal += tabOrder.subtotal || 0;
                            aggregatedCgst += tabOrder.cgst || 0;
                            aggregatedSgst += tabOrder.sgst || 0;
                            aggregatedDeliveryCharge += Number(tabOrder.deliveryCharge || 0);
                            aggregatedServiceFee += Number(tabOrder.serviceFee || 0);
                            if (!aggregatedServiceFeeLabel) {
                                aggregatedServiceFeeLabel = String(tabOrder.serviceFeeLabel || '').trim() || null;
                            }
                            aggregatedTotal += tabOrder.totalAmount || 0;
                        }
                    }

                    // Determination logic
                    if (hasPaid) aggregatedPaymentStatus = 'paid';
                    else if (hasPayAtCounter) aggregatedPaymentStatus = 'pay_at_counter';
                    else aggregatedPaymentStatus = 'pending';

                    // Sort batches: Oldest First
                    batchesList.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

                    orderData.batches = batchesList;
                    debugLog(`[API][Order Status] Aggregated ${batchesList.length} orders via ${aggregationMethod}. Payment Status: ${aggregatedPaymentStatus}`);

                    // CALCULATE COMPOSITE STATUS
                    // Don't just take the latest order's status (which might be cancelled)
                    // Instead, look at ALL batches to determine the "Global" status
                    const activeBatches = batchesList.filter(b => !['cancelled', 'rejected'].includes(b.status));

                    if (activeBatches.length > 0) {
                        // Priority: Ready > Preparing > Confirmed > Pending > Delivered
                        // We want to show the most "active/urgent" status to the user
                        const hasStatus = (s) => activeBatches.some(b => b.status === s);

                        if (hasStatus('ready_for_pickup')) orderData.status = 'ready_for_pickup';
                        else if (hasStatus('preparing')) orderData.status = 'preparing';
                        else if (hasStatus('confirmed')) orderData.status = 'confirmed';
                        else if (hasStatus('pending')) orderData.status = 'pending';
                        else orderData.status = 'delivered'; // All active batches are delivered
                    } else if (batchesList.length > 0) {
                        // All batches are cancelled or rejected
                        // Use the status of the LATEST batch (likely 'cancelled')
                        // orderData.status is already set from the doc, which is fine
                    }
                }
            } catch (err) {
                console.error("[API][Order Status] Error aggregating tab orders:", err);
            }
        }

        const normalizeDialablePhone = (value) => {
            if (!value) return null;
            const raw = String(value).trim();
            if (!raw) return null;

            if (raw.startsWith('+')) {
                const withCountryCode = `+${raw.slice(1).replace(/\D/g, '')}`;
                return withCountryCode.length > 1 ? withCountryCode : null;
            }

            const digitsOnly = raw.replace(/\D/g, '');
            return digitsOnly || null;
        };

        const restaurantContactPhoneRaw =
            orderData.restaurantPhone ||
            businessData.ownerPhone ||
            businessData.phone ||
            businessData.phoneNumber ||
            businessData.contactPhone ||
            businessData.contact?.phone ||
            businessData.ownerDetails?.phone ||
            businessData.mobileNumber ||
            businessData.whatsappNumber ||
            null;
        const restaurantContactPhone = normalizeDialablePhone(restaurantContactPhoneRaw);
        const resolvedCustomerAddress =
            orderData.customerAddress ||
            orderData.customer?.address ||
            orderData.address ||
            null;

        const responsePayload = {
            order: {
                id: orderSnap.id, // Primary ID
                customerOrderId: orderData.customerOrderId, // 10-digit customer-facing ID
                restaurantId: orderData.restaurantId || null,
                status: orderData.status,
                customerLocation: canRevealCustomerAddress ? (orderData.customerLocation || null) : null,
                restaurantLocation: restaurantLocationForMap,
                customerName: orderData.customerName,
                customerAddress: canRevealCustomerAddress ? resolvedCustomerAddress : null,
                customerPhone: isPublicTokenAccess ? null : orderData.customerPhone,
                restaurantPhone: restaurantContactPhone,
                createdAt: orderData.createdAt?.toDate ? orderData.createdAt.toDate() : orderData.createdAt, // Added for bundling logic
                items: aggregatedItems, // Aggregated items (Active)
                batches: orderData.batches || [], // NEW FIELD
                subtotal: aggregatedSubtotal, // Aggregated subtotal
                cgst: aggregatedCgst, // Aggregated cgst
                sgst: aggregatedSgst, // Aggregated sgst
                deliveryCharge: aggregatedDeliveryCharge,
                serviceFee: aggregatedServiceFee,
                serviceFeeLabel: aggregatedServiceFee > 0 ? (aggregatedServiceFeeLabel || 'Additional Charge') : null,
                totalAmount: aggregatedTotal, // Aggregated total
                paymentStatus: aggregatedPaymentStatus, // <--- ADDED THIS FIELD
                paymentDetails: isPublicTokenAccess ? null : (orderData.paymentDetails || null),
                deliveryType: orderData.deliveryType,
                dineInToken: orderData.dineInToken,
                tableId: orderData.tableId,
                dineInTabId: orderData.dineInTabId,
                isCarOrder: orderData.isCarOrder || orderData.deliveryType === 'car-order',
                carSpot: orderData.carSpot || null,
                carDetails: orderData.carDetails || null,

                trackingToken: isPublicTokenAccess ? null : (orderData.trackingToken || null),
            },
            restaurant: {
                id: businessDoc.id,
                name: businessData.name,
                address: businessData.address,
                ownerPhone: restaurantContactPhone,
                phone: restaurantContactPhone,
                botDisplayNumber: businessData.botDisplayNumber || businessData.whatsappNumber || null,
                whatsappNumber: businessData.botDisplayNumber || businessData.whatsappNumber || null,
                businessType: (businessData.businessType === 'shop'
                    ? 'store'
                    : (businessData.businessType || normalizedBusinessType || 'restaurant')) // CRITICAL: Router needs this!
            },
            deliveryBoy: deliveryBoyData ? {
                id: deliveryBoyData.id,
                name: deliveryBoyData.name || deliveryBoyData.fullName || 'Delivery Partner',
                address: businessData.address,
                photoUrl: deliveryBoyData.profilePictureUrl || deliveryBoyData.photoURL || deliveryBoyData.photoUrl || null,
                rating: deliveryBoyData.avgRating || 4.5,
                phone: isPublicTokenAccess ? null : (deliveryBoyData.phone || deliveryBoyData.phoneNumber || null),
                location: deliveryBoyData.currentLocation || deliveryBoyData.location || null,
                isOnline: deliveryBoyData.isOnline !== false
            } : null
        };

        // STEP 3: Cache Decision - Final state check
        const isFinalState = FINAL_STATES.includes(orderData.status);

        if (isFinalState) {
            // DON'T CACHE final states (polling already stopped via Phase 2 rules)
            debugLog(`[Order Status API] Order ${orderId} in FINAL state (${orderData.status}) - NOT caching`);
            await trackEndpointRead('api.order.status.full', Math.max(1, requestCache.size()));
            return respond(responsePayload, 200, {
                'X-Cache': 'SKIP',
                'X-Final-State': 'true',
            }, {
                outcome: 'resolved',
                cache: 'skip',
                mode: cacheVisibility,
                finalState: orderData.status,
            });
        }

        // STEP 4: ACTIVE ORDER - Cache for 60 seconds
        if (isKvAvailable && cacheKey) {
            try {
                await kv.set(
                    cacheKey,
                    mergeOrderStatusCachedVariant(cachedRecord, cacheVariantKey, responsePayload),
                    { ex: 60 }
                );
                debugLog(`[Order Status API] ✅ Cached ${cacheKey} (${cacheVariantKey}) for 60 seconds (status: ${orderData.status})`);
            } catch (cacheError) {
                console.error('[Order Status API] Cache SET failed:', cacheError);
                // Non-fatal - response will still be sent
            }
        }

        debugLog("[API][Order Status] Successfully built response payload. Tracking token included:", !!responsePayload.order.trackingToken);
        debugLog(`[RequestCache] Deduplicated reads - Cache entries used: ${requestCache.size()}`);
        await trackEndpointRead('api.order.status.full', Math.max(1, requestCache.size()));
        return respond(responsePayload, 200, {
            'X-Cache': 'MISS',
            'X-Request-Cache-Size': requestCache.size().toString(),
        }, {
            outcome: 'resolved',
            cache: 'miss',
            mode: cacheVisibility,
            addressVisibility,
        });

    } catch (error) {
        telemetryStatus = error?.status || 500;
        telemetryError = error?.message || 'Failed to fetch order status';
        console.error("[API][Order Status] CRITICAL ERROR:", error);
        return respond({ message: `Backend Error: ${error.message}` }, telemetryStatus, undefined, {
            outcome: 'error',
            error: error?.message || 'unknown_error',
        });
    } finally {
        void trackApiTelemetry({
            endpoint: telemetryEndpoint,
            durationMs: Date.now() - telemetryStartedAt,
            statusCode: telemetryStatus,
            errorMessage: telemetryError,
            context: telemetryContext,
        });
    }
}
