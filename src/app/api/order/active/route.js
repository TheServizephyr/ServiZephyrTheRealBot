
import { NextResponse } from 'next/server';
import { getDecodedAuthContext, getFirestore } from '@/lib/firebase-admin';
import { cookies } from 'next/headers';
import { getOrCreateGuestProfile } from '@/lib/guest-utils';
import { trackEndpointRead } from '@/lib/readTelemetry';
import { trackApiTelemetry } from '@/lib/opsTelemetry';
import {
    enforceRateLimit,
    readSignedGuestSessionCookie,
    resolveGuestAccessRef,
    setSignedGuestSessionCookie,
    verifyAppCheckToken,
    verifyScopedAuthToken,
} from '@/lib/public-auth';
import { hashAuditValue, logRequestAudit } from '@/lib/security/request-audit';

export const dynamic = 'force-dynamic';
const DEFAULT_ROUTE_GUEST_SCOPES = ['customer_lookup', 'active_orders', 'checkout', 'track_orders'];

const getClientIp = (req) => {
    const forwardedFor = req.headers.get('x-forwarded-for') || '';
    return forwardedFor.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
};

const normalizeScopes = (scopes = []) => [...new Set((Array.isArray(scopes) ? scopes : [scopes]).map((value) => String(value || '').trim()).filter(Boolean))];

const toDate = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

async function resolveGuestAccessRefForRoute(firestore, ref, requiredScopes = []) {
    const resolved = await resolveGuestAccessRef(firestore, ref, {
        requiredScopes,
        allowLegacy: true,
        touch: true,
    });
    if (resolved) return resolved;

    const safeRef = String(ref || '').trim();
    if (!safeRef) return null;

    const sessionDoc = await firestore.collection('guest_sessions').doc(safeRef).get();
    if (!sessionDoc.exists) {
        console.warn(`[API /order/active] guest_sessions/${safeRef} not found during fallback resolution.`);
        return null;
    }

    const sessionData = sessionDoc.data() || {};
    const expiresAt = toDate(sessionData.expiresAt);
    const expired = !expiresAt || Date.now() >= expiresAt.getTime();
    const revoked = String(sessionData.status || '').toLowerCase() === 'revoked';
    const effectiveScopes = normalizeScopes(
        Array.isArray(sessionData.scopes) && sessionData.scopes.length > 0
            ? sessionData.scopes
            : DEFAULT_ROUTE_GUEST_SCOPES
    );
    const missingScopes = normalizeScopes(requiredScopes).filter((scope) => !effectiveScopes.includes(scope));

    if (expired || revoked || missingScopes.length > 0) {
        console.warn('[API /order/active] Fallback ref inspection rejected session.', {
            ref: safeRef,
            expired,
            revoked,
            missingScopes,
            subjectId: String(sessionData.subjectId || '').trim(),
            status: String(sessionData.status || ''),
        });
        return null;
    }

    console.warn(`[API /order/active] Resolved ref ${safeRef} via direct guest_sessions fallback.`);
    return {
        subjectId: String(sessionData.subjectId || '').trim(),
        subjectType: String(sessionData.subjectType || 'guest').trim() || 'guest',
        phone: String(sessionData.phone || '').trim(),
        businessId: String(sessionData.businessId || '').trim(),
        scopes: effectiveScopes,
        sessionId: sessionDoc.id,
        source: 'session_ref_fallback',
        legacy: false,
    };
}

// GET: Fetch order data by tabId, phone, or ref
export async function GET(req) {
    const telemetryStartedAt = Date.now();
    let telemetryStatus = 200;
    let telemetryError = null;
    let telemetryContext = null;
    let auditActorUid = null;
    const urlForAudit = new URL(req.url);
    const auditTokenId = hashAuditValue(
        urlForAudit.searchParams.get('ref')
        || urlForAudit.searchParams.get('phone')
        || urlForAudit.searchParams.get('tabId')
        || urlForAudit.searchParams.get('token')
        || ''
    );
    const respond = (payload, status = 200, metadata = {}) => {
        telemetryStatus = status;
        logRequestAudit({
            req,
            statusCode: status,
            source: 'order_active',
            actorUid: auditActorUid,
            tokenId: auditTokenId,
            metadata,
        });
        return NextResponse.json(payload, { status });
    };

    try {
        console.log("[API] GET /order/active called");
        const { searchParams } = new URL(req.url);
        const tabId = searchParams.get('tabId');
        const phone = searchParams.get('phone');
        const ref = searchParams.get('ref');
        telemetryContext = {
            hasTabId: !!tabId,
            hasPhone: !!phone,
            hasRef: !!ref,
        };

        if (!tabId && !phone && !ref) {
            return respond({ message: 'TabId, Phone, or Ref is required' }, 400, {
                outcome: 'missing_identifier',
            });
        }

        const firestore = await getFirestore();
        const rateKey = `order-active:${getClientIp(req)}:${String(ref || phone || tabId || 'anon').slice(0, 96)}`;
        const rate = await enforceRateLimit(firestore, {
            key: rateKey,
            limit: 45,
            windowSec: 60,
            req,
            auditContext: 'order_active',
        });
        if (!rate.allowed) {
            return respond({ message: 'Too many active-order requests. Please slow down.' }, 429, {
                outcome: 'rate_limited',
                hasTabId: !!tabId,
                hasPhone: !!phone,
                hasRef: !!ref,
            });
        }

        // SCENARIO 1: DELIVERY/TAKEAWAY (Query by User Identity)
        if (phone || ref) {
            await verifyAppCheckToken(req, { required: false });

            // --- SECURITY CHECK ---
            const cookieStore = cookies();
            const guestSession = readSignedGuestSessionCookie(cookieStore, ['active_orders']);
            const sessionUser = guestSession?.subjectId || null;
            console.log(`[API /order/active] Security Check - Session: ${sessionUser}, Ref: ${ref}, AuthCookieOrHeader: ${!!req.headers.get('authorization') || !!req.cookies?.get?.('auth_session')}`);

            let targetCustomerId = null;
            let targetPhone = null;
            let isAuthorized = false;

            // Resolve Target Identity
            if (ref) {
                const refSession = await resolveGuestAccessRefForRoute(firestore, ref, ['active_orders']);
                targetCustomerId = refSession?.subjectId || null;
                if (!targetCustomerId) {
                    if (phone) {
                        targetPhone = phone.replace(/\D/g, '').slice(-10);
                        console.warn(`[API /order/active] Ref invalid, falling back to phone lookup for ${targetPhone ? 'provided phone' : 'missing phone'}`);
                    } else {
                        return respond({ message: 'Invalid Ref' }, 400, {
                            outcome: 'invalid_ref',
                        });
                    }
                }
                if (refSession && refSession.legacy !== true) {
                    isAuthorized = true;
                    auditActorUid = refSession.subjectId;
                    setSignedGuestSessionCookie(cookieStore, {
                        subjectId: refSession.subjectId,
                        subjectType: refSession.subjectType,
                        sessionId: refSession.sessionId || ref,
                        scopes: refSession.scopes || ['active_orders'],
                        maxAgeSec: 7 * 24 * 60 * 60,
                    });
                }
            } else if (phone) {
                targetPhone = phone.replace(/\D/g, '').slice(-10);
            }

            // 1. Check Logged-in User (UID Priority)
            try {
                    const decodedToken = await getDecodedAuthContext(req, { checkRevoked: false, allowSessionCookie: true });
                    const loggedInUid = decodedToken.uid;

                    // STRICT IDENTITY CHECK: Logged-in user must match target (customer or phone)
                    if (targetCustomerId && loggedInUid === targetCustomerId) {
                        isAuthorized = true;
                    } else if (targetPhone) {
                        // Resolve phone to UID/GuestID to verify
                        const profileResult = await getOrCreateGuestProfile(firestore, targetPhone);
                        if (loggedInUid === profileResult.userId) {
                            isAuthorized = true;
                        }
                    }

                    if (isAuthorized) {
                        console.log(`[API /order/active] ✅ Authorized via Auth Header (UID: ${loggedInUid})`);
                    } else {
                        console.warn(`[API /order/active] ❌ Auth Header UID ${loggedInUid} does not match target ${targetCustomerId || targetPhone}`);
                    }

                } catch (e) {
                    console.warn(`[API /order/active] No authenticated user context:`, e.message);
                }

            // 2. Check signed guest session cookie
            if (!isAuthorized && sessionUser) {
                if (targetCustomerId && sessionUser === targetCustomerId) isAuthorized = true;
                if (targetPhone && sessionUser === targetPhone) isAuthorized = true;
            }

            // 3. Fallback: Check scoped token param
            if (!isAuthorized && !tabId) {
                const token = searchParams.get('token');
                if (token) {
                    const tokenCheck = await verifyScopedAuthToken(firestore, token, {
                        allowedTypes: ['tracking', 'whatsapp'],
                        requiredScopes: ['active_orders'],
                        subjectId: targetCustomerId || targetPhone || '',
                        req,
                        auditContext: 'order_active',
                    });
                    if (tokenCheck.valid) isAuthorized = true;
                }
            }

            if (!isAuthorized) {
                console.warn(`[API /order/active] Unauthorized access attempt for ${phone || ref}`);
                return respond({ message: 'Unauthorized. Invalid or expired public session.' }, 401, {
                    outcome: 'unauthorized',
                    hasRef: !!ref,
                    hasPhone: !!phone,
                });
            }

            // --- QUERY EXECUTION ---
            // CRITICAL: Use userId for queries (UID for logged-in, guest ID for guests)
            const ordersRef = firestore.collection('orders');
            const activeStatuses = ['pending', 'placed', 'accepted', 'confirmed', 'preparing', 'prepared', 'ready', 'ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived'];
            const ONE_DAY_MS = 24 * 60 * 60 * 1000;
            const yesterday = new Date(Date.now() - ONE_DAY_MS);

            let userId;

            if (targetCustomerId) {
                // Guest ID ref provided - use directly
                userId = targetCustomerId;
                console.log(`[API /order/active] Using Guest ID: ${userId}`);
            } else if (targetPhone) {
                // Phone provided - check for UID first, then guest ID
                const profileResult = await getOrCreateGuestProfile(firestore, targetPhone);
                userId = profileResult.userId;  // UID or guest ID
                console.log(`[API /order/active] Resolved userId: ${userId}, isGuest: ${profileResult.isGuest}`);
            }

            if (!userId) {
                return respond({ message: 'Could not resolve user identity' }, 400, {
                    outcome: 'identity_resolution_failed',
                });
            }
            auditActorUid = userId;

            // Query primarily by userId. Add phone-based fallbacks to support
            // mixed identity histories (guest -> logged-in migration, legacy docs, etc.).
            const primarySnapshot = await ordersRef
                .where('userId', '==', userId)
                .where('status', 'in', activeStatuses)
                .limit(20)
                .get();

            const snapshots = [primarySnapshot];

            // Use normalized phone fallback when available.
            let phoneForFallback = targetPhone || null;
            if (!phoneForFallback && targetCustomerId?.startsWith('g_')) {
                try {
                    const guestDoc = await firestore.collection('guest_profiles').doc(targetCustomerId).get();
                    const guestPhone = guestDoc.exists ? guestDoc.data()?.phone : null;
                    if (guestPhone) phoneForFallback = guestPhone;
                } catch (e) {
                    console.warn('[API /order/active] Failed to resolve guest phone fallback:', e.message);
                }
            }

            // Fallback queries are expensive; execute only when primary userId query has no results.
            if (primarySnapshot.empty && phoneForFallback) {
                const [snapByCustomerPhone, snapByNestedCustomerPhone] = await Promise.all([
                    ordersRef
                        .where('customerPhone', '==', phoneForFallback)
                        .where('status', 'in', activeStatuses)
                        .limit(20)
                        .get(),
                    ordersRef
                        .where('customer.phone', '==', phoneForFallback)
                        .where('status', 'in', activeStatuses)
                        .limit(20)
                        .get()
                ]);
                snapshots.push(snapByCustomerPhone, snapByNestedCustomerPhone);
            }
            const uniqueDocs = new Map();
            snapshots.forEach((snap) => {
                snap.forEach((doc) => uniqueDocs.set(doc.id, doc));
            });
            const estimatedReads = snapshots.reduce((sum, snap) => sum + (snap?.size || 0), 0);
            await trackEndpointRead('api.order.active', estimatedReads);

            const finalActiveOrders = [];
            uniqueDocs.forEach((doc) => {
                const d = doc.data();
                const createdTime = d.orderDate || d.createdAt; // Support both

                // Allow order if created within last 24h OR if no date (legacy support/safety)
                if (!createdTime || (createdTime.toMillis && createdTime.toMillis() > yesterday.getTime())) {
                    finalActiveOrders.push({
                        orderId: doc.id,
                        status: d.status,
                        trackingToken: d.trackingToken || d.token,
                        restaurantId: d.restaurantId,
                        restaurantName: d.restaurantName || d.businessName || 'Restaurant', // ✅ Added for UI display
                        totalAmount: d.grandTotal || d.totalAmount,
                        items: d.items || [],
                        deliveryType: d.deliveryType,
                        // Return dates for sorting & display
                        orderDate: d.orderDate,
                        createdAt: d.createdAt,
                        customerOrderId: d.customerOrderId // ✅ Added for UI display
                    });
                }
            });

            // Sort in memory: Newest First
            finalActiveOrders.sort((a, b) => {
                const timeA = (a.orderDate?.toMillis ? a.orderDate.toMillis() : (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));
                const timeB = (b.orderDate?.toMillis ? b.orderDate.toMillis() : (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0));
                return timeB - timeA;
            });

            console.log(`[API /order/active] Returning ${finalActiveOrders.length} active orders.`);
            return respond({ activeOrders: finalActiveOrders }, 200, {
                outcome: 'resolved',
                mode: 'customer',
                orderCount: finalActiveOrders.length,
            });
        }

        // SCENARIO 2: DINE-IN (Query by TabId)
        // (Existing logic follows...)

        // Fetch ALL orders for this dine-in tab using Dual-Strategy (Robust)
        // Query by ID only to avoid "Missing Index" errors with status filters
        const [snap1, snap2] = await Promise.all([
            firestore.collection('orders')
                .where('dineInTabId', '==', tabId)
                .get(),
            firestore.collection('orders')
                .where('tabId', '==', tabId)
                .get()
        ]);

        // Merge results using Map to handle duplicates
        const uniqueDocs = new Map();
        snap1.forEach(doc => uniqueDocs.set(doc.id, doc));
        snap2.forEach(doc => uniqueDocs.set(doc.id, doc));

        console.log(`[API /order/active] TabId: ${tabId}`);
        console.log(`[API /order/active] Snap1 (dineInTabId) found: ${snap1.size}`);
        console.log(`[API /order/active] Snap2 (tabId) found: ${snap2.size}`);

        let initialDocs = [];
        snap1.forEach(doc => initialDocs.push(doc));
        snap2.forEach(doc => initialDocs.push(doc));

        // --- ENHANCED AGGREGATION: Token based fallback ---
        // If orders found have a dineInToken, fetch ALL orders with that token.
        // This fixes the case where older orders might miss the tabId but share the token.
        let dineInToken = null;
        let restaurantId = null;

        if (initialDocs.length > 0) {
            const firstData = initialDocs[0].data();
            dineInToken = firstData.dineInToken;
            restaurantId = firstData.restaurantId;
        }

        if (dineInToken && restaurantId) {
            console.log(`[API /order/active] Found dineInToken: ${dineInToken}. Fetching related orders...`);
            const tokenQuery = await firestore.collection('orders')
                .where('restaurantId', '==', restaurantId)
                .where('dineInToken', '==', dineInToken)
                .get();

            console.log(`[API /order/active] Token query found: ${tokenQuery.size} docs.`);
            tokenQuery.forEach(doc => uniqueDocs.set(doc.id, doc));
        }
        // --------------------------------------------------

        snap1.forEach(doc => uniqueDocs.set(doc.id, doc));
        snap2.forEach(doc => uniqueDocs.set(doc.id, doc));

        console.log(`[API /order/active] Total unique docs after token merge: ${uniqueDocs.size}`);
        const dineInEstimatedReads = (snap1?.size || 0) + (snap2?.size || 0) + (uniqueDocs?.size || 0);
        await trackEndpointRead('api.order.active', dineInEstimatedReads);

        if (uniqueDocs.size === 0) {
            console.log('[API /order/active] No documents found. Returning 404.');
            return respond({ message: 'No orders found for this tab' }, 404, {
                outcome: 'not_found',
                mode: 'tab',
            });
        }

        // Aggregate all items and calculate totals
        let allItems = [];
        let subtotal = 0;
        let tab_name = '';
        let customerName = '';

        // Sort by creation time to keep order consistent
        const sortedDocs = Array.from(uniqueDocs.values()).sort((a, b) => {
            return (a.data().createdAt?.toMillis() || 0) - (b.data().createdAt?.toMillis() || 0);
        });

        sortedDocs.forEach(doc => {
            const order = doc.data();
            console.log(`[API /order/active] Processing Order: ${doc.id} | Status: ${order.status} | Amount: ${order.totalAmount || 0}`);

            // Filter statuses in MEMORY (Robust)
            if (['cancelled', 'rejected', 'picked_up'].includes(order.status)) {
                console.log(`[API /order/active] Skipping order (status: ${order.status}): ${doc.id}`);
                return;
            }

            allItems = allItems.concat(order.items || []);
            // Use totalAmount if available, otherwise subtotal (legacy)
            // Ensure we don't double count if fields exist differently
            const orderTotal = order.totalAmount || order.grandTotal || order.subtotal || 0;
            subtotal += orderTotal;

            if (!tab_name) tab_name = order.tab_name || order.customerName || '';
            if (!customerName) customerName = order.customerName || '';
        });

        console.log(`[API /order/active] Final Aggregated Subtotal: ${subtotal}`);

        return respond({
            items: allItems,
            subtotal,
            totalAmount: subtotal,
            grandTotal: subtotal,
            tab_name,
            customerName
        }, 200, {
            outcome: 'resolved',
            mode: 'tab',
            itemCount: allItems.length,
        });

    } catch (error) {
        telemetryStatus = error?.status || 500;
        telemetryError = error?.message || 'Failed to load active order';
        console.error("GET /api/order/active error:", error);
        return respond({ message: 'Internal Server Error' }, telemetryStatus, {
            outcome: 'error',
            error: error?.message || 'unknown_error',
        });
    } finally {
        void trackApiTelemetry({
            endpoint: 'api.order.active',
            durationMs: Date.now() - telemetryStartedAt,
            statusCode: telemetryStatus,
            errorMessage: telemetryError,
            context: telemetryContext,
        });
    }
}


export async function POST(req) {
    const previewBody = await req.clone().json().catch(() => ({}));
    const auditTokenId = hashAuditValue(previewBody?.phone || previewBody?.token || previewBody?.restaurantId || '');
    const respond = (payload, status = 200, metadata = {}) => {
        logRequestAudit({
            req,
            statusCode: status,
            source: 'order_active_legacy_post',
            actorUid: null,
            tokenId: auditTokenId,
            metadata,
        });
        return NextResponse.json(payload, { status });
    };
    try {
        const { phone, token, restaurantId } = await req.json();

        if (!phone || !token || !restaurantId) {
            return respond({ message: 'Missing required fields' }, 400, {
                outcome: 'missing_fields',
            });
        }

        const firestore = await getFirestore();

        // 1. Verify Session Token
        const tokenDoc = await firestore.collection('auth_tokens').doc(token).get();
        if (!tokenDoc.exists) {
            return respond({ message: 'Invalid session token' }, 401, {
                outcome: 'invalid_token',
            });
        }

        const tokenData = tokenDoc.data();
        if (tokenData.phone !== phone) {
            return respond({ message: 'Token mismatch' }, 403, {
                outcome: 'token_mismatch',
            });
        }
        if (tokenData.expiresAt.toDate() < new Date()) {
            return respond({ message: 'Session expired' }, 401, {
                outcome: 'expired',
            });
        }

        // 2. Query for Active Order
        // Statuses considered "active": pending, accepted, preparing, ready, ready_for_pickup
        // Statuses considered "closed": delivered, picked_up, rejected, cancelled

        const ordersRef = firestore.collection('orders');
        const activeOrderQuery = await ordersRef
            .where('restaurantId', '==', restaurantId)
            .where('customer.phone', '==', phone)
            .where('status', 'in', ['pending', 'placed', 'accepted', 'confirmed', 'preparing', 'prepared', 'ready', 'ready_for_pickup', 'dispatched', 'on_the_way', 'rider_arrived']) // Added all active statuses
            .orderBy('orderDate', 'desc')
            .limit(1)
            .get();

        if (activeOrderQuery.empty) {
            return respond({ activeOrder: null }, 200, {
                outcome: 'resolved',
                orderFound: false,
            });
        }

        const orderDoc = activeOrderQuery.docs[0];
        const orderData = orderDoc.data();



        return respond({
            activeOrder: {
                orderId: orderDoc.id,
                status: orderData.status,
                trackingToken: orderData.trackingToken || token, // Use existing or current token
                restaurantId: orderData.restaurantId
            }
        }, 200, {
            outcome: 'resolved',
            orderFound: true,
        });

    } catch (error) {
        console.error("API Error /api/order/active:", error);
        return respond({ message: 'Internal Server Error' }, 500, {
            outcome: 'error',
            error: error?.message || 'unknown_error',
        });
    }
}
