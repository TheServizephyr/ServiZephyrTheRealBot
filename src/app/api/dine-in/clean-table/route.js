/**
 * CLEAN TABLE API
 * 
 * Closes a dine-in tab after verifying all payments
 * Includes integrity check before closing
 * Makes table available for new customers
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyTabIntegrity, validateTabToken } from '@/lib/dinein-utils';

async function getBusinessRef(firestore, restaurantId) {
    if (!restaurantId) return null;

    let businessRef = firestore.collection('restaurants').doc(restaurantId);
    let businessSnap = await businessRef.get();

    if (businessSnap.exists) {
        return businessRef;
    }

    businessRef = firestore.collection('shops').doc(restaurantId);
    businessSnap = await businessRef.get();

    if (businessSnap.exists) {
        return businessRef;
    }

    return null;
}

async function handleCleanTable(req) {
    try {
        const body = await req.json();
        console.log('[Clean Table] 🔍 Request body:', body);

        const { tabId, token, restaurantId, tableId: incomingTableId } = body;

        if (!tabId) {
            console.log('[Clean Table] ❌ Missing tabId');
            return NextResponse.json(
                { error: 'Missing required field: tabId' },
                { status: 400 }
            );
        }

        // ✅ Token validation only if token is provided (customer flow)
        // Owner dashboard doesn't send token (already authenticated via Bearer)
        if (token) {
            const isValid = await validateTabToken(tabId, token);
            if (!isValid) {
                return NextResponse.json(
                    { error: 'Invalid token' },
                    { status: 401 }
                );
            }
        } else {
            console.log('[Clean Table] ℹ️ No token provided - assuming owner request');
        }

        const firestore = await getFirestore();

        const businessRef = await getBusinessRef(firestore, restaurantId);
        const businessId = businessRef?.id || restaurantId || null;

        // ✅ Try to find tab in multiple locations (V1 vs V2 structure)
        let tabRef, tabSnap;

        // Try global collection first (V1 structure)
        tabRef = firestore.collection('dine_in_tabs').doc(tabId);
        tabSnap = await tabRef.get();

        // If not found and restaurantId provided, try restaurant subcollection (V2 structure)
        if (!tabSnap.exists && businessRef) {
            console.log(`[Clean Table] Tab not in global collection, checking restaurant subcollection for ${restaurantId}`);
            tabRef = businessRef.collection('dineInTabs').doc(tabId);
            tabSnap = await tabRef.get();
        }

        if (!tabSnap.exists) {
            console.log(`[Clean Table] ❌ Tab ${tabId} not found in any location`);

            const sessionOrdersMap = new Map();

            const addSessionOrders = async (queryBuilder) => {
                try {
                    const snap = await queryBuilder.get();
                    snap.docs.forEach((doc) => sessionOrdersMap.set(doc.id, doc));
                } catch (err) {
                    console.warn('[Clean Table] Session order lookup failed:', err?.message || err);
                }
            };

            // 1) Primary lookup by dineInTabId.
            let q1 = firestore.collection('orders')
                .where('deliveryType', '==', 'dine-in')
                .where('dineInTabId', '==', tabId);
            if (businessId) q1 = q1.where('restaurantId', '==', businessId);
            await addSessionOrders(q1);

            // 2) Legacy lookup by tabId.
            let q2 = firestore.collection('orders')
                .where('deliveryType', '==', 'dine-in')
                .where('tabId', '==', tabId);
            if (businessId) q2 = q2.where('restaurantId', '==', businessId);
            await addSessionOrders(q2);

            // 3) Group-key token lookup: "<table>_token_<token>".
            const tokenFromGroupKey = String(tabId).includes('_token_')
                ? String(tabId).split('_token_')[1]
                : null;
            if (tokenFromGroupKey) {
                let q3 = firestore.collection('orders')
                    .where('deliveryType', '==', 'dine-in')
                    .where('dineInToken', '==', tokenFromGroupKey);
                if (businessId) q3 = q3.where('restaurantId', '==', businessId);
                await addSessionOrders(q3);
            }

            const sessionOrders = Array.from(sessionOrdersMap.values());
            if (sessionOrders.length === 0) {
                return NextResponse.json(
                    { error: 'Tab session not found. Nothing to clean.' },
                    { status: 404 }
                );
            }

            const firstOrderData = sessionOrders[0]?.data?.() || {};
            const resolvedTableId = incomingTableId || firstOrderData.tableId || firstOrderData.table || null;
            const possibleTabIds = new Set();
            sessionOrders.forEach((doc) => {
                const data = doc.data() || {};
                if (data.dineInTabId) possibleTabIds.add(String(data.dineInTabId));
                if (data.tabId) possibleTabIds.add(String(data.tabId));
            });

            let actualTableId = null;
            if (businessRef && resolvedTableId) {
                const tablesSnap = await businessRef.collection('tables').get();
                tablesSnap.forEach((doc) => {
                    if (String(doc.id).toLowerCase() === String(resolvedTableId).toLowerCase()) {
                        actualTableId = doc.id;
                    }
                });
            }

            const tabIdsToClose = new Set();
            if (businessRef) {
                for (const candidateTabId of possibleTabIds) {
                    if (!candidateTabId) continue;
                    const candidateTabRef = businessRef.collection('dineInTabs').doc(candidateTabId);
                    const candidateTabSnap = await candidateTabRef.get();
                    if (candidateTabSnap.exists) {
                        tabIdsToClose.add(candidateTabId);
                    }
                }

                // Recovery path: when orders carry drifted tabId, resolve the real open tab on the same table.
                if (tabIdsToClose.size === 0 && actualTableId) {
                    const openTabsSnap = await businessRef.collection('dineInTabs')
                        .where('tableId', '==', actualTableId)
                        .where('status', 'in', ['active', 'inactive'])
                        .get();

                    const expectedName = String(firstOrderData.tab_name || firstOrderData.customerName || '').trim().toLowerCase();
                    const expectedPax = Number(firstOrderData.pax_count || 0);

                    const rankedTabs = openTabsSnap.docs
                        .map((doc) => {
                            const data = doc.data() || {};
                            const tabName = String(data.tab_name || '').trim().toLowerCase();
                            const pax = Number(data.pax_count || 0);
                            const updatedAt = typeof data.updatedAt?.toMillis === 'function'
                                ? data.updatedAt.toMillis()
                                : (typeof data.createdAt?.toMillis === 'function' ? data.createdAt.toMillis() : 0);
                            let score = 0;
                            if (expectedName && tabName === expectedName) score += 3;
                            if (expectedPax > 0 && pax === expectedPax) score += 2;
                            return { id: doc.id, score, updatedAt };
                        })
                        .sort((a, b) => {
                            if (b.score !== a.score) return b.score - a.score;
                            return b.updatedAt - a.updatedAt;
                        });

                    if (rankedTabs.length === 1) {
                        tabIdsToClose.add(rankedTabs[0].id);
                    } else if (rankedTabs.length > 1 && rankedTabs[0].score > 0) {
                        tabIdsToClose.add(rankedTabs[0].id);
                    }
                }
            }

            const batch = firestore.batch();
            sessionOrders.forEach((doc) => {
                batch.set(doc.ref, {
                    cleaned: true,
                    cleanedAt: FieldValue.serverTimestamp()
                }, { merge: true });
            });

            if (businessRef) {
                for (const candidateTabId of tabIdsToClose) {
                    const candidateTabRef = businessRef.collection('dineInTabs').doc(candidateTabId);
                    batch.update(candidateTabRef, {
                        status: 'completed',
                        closedAt: FieldValue.serverTimestamp(),
                        cleanedAt: FieldValue.serverTimestamp()
                    });
                }
            }

            await batch.commit();

            // Sync table occupancy if table resolved.
            if (businessRef && actualTableId) {
                const openTabsSnap = await businessRef.collection('dineInTabs')
                    .where('tableId', '==', actualTableId)
                    .where('status', 'in', ['active', 'inactive'])
                    .get();

                const recalculatedPax = openTabsSnap.docs.reduce((sum, doc) => {
                    return sum + Math.max(0, Number(doc.data()?.pax_count || 0));
                }, 0);

                await businessRef.collection('tables').doc(actualTableId).set({
                    current_pax: recalculatedPax,
                    state: recalculatedPax > 0 ? 'occupied' : 'available',
                    cleanedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
            }

            return NextResponse.json({
                success: true,
                message: `Session cleaned using order fallback (${sessionOrders.length} orders).`,
                tabId,
                cleanedOrders: sessionOrders.length,
                closedTabIds: Array.from(tabIdsToClose)
            }, { status: 200 });
        }

        console.log(`[Clean Table] ✅ Found tab ${tabId}`);

        // Step 1: Verify integrity BEFORE closing (skip for now if not in global collection)
        let integrityValid = true;
        let mismatch = 0;

        try {
            const result = await verifyTabIntegrity(tabId);
            integrityValid = result.isValid;
            mismatch = result.mismatch || 0;
            if (!integrityValid) {
                console.warn(`[Clean Table] Tab ${tabId} had mismatch of ₹${mismatch}, auto-corrected`);
            }
        } catch (err) {
            console.warn(`[Clean Table] ⚠️ Integrity check failed (tab might be in subcollection):`, err.message);
            // Continue anyway for V2 tabs
        }

        const result = await firestore.runTransaction(async (transaction) => {
            // Use the tabRef determined by the dual lookup
            const tabSnap = await transaction.get(tabRef);

            if (!tabSnap.exists) {
                throw new Error('Tab not found');
            }

            const tabData = tabSnap.data();

            // Step 2: Check pending amount (skip for V2 tabs that don't have this field)
            if (tabData.pendingAmount !== undefined && tabData.pendingAmount > 0.01) {
                throw new Error(`Pending amount: ₹${tabData.pendingAmount.toFixed(2)}`);
            }

            // Close tab - only include fields that exist
            const updateData = {
                status: 'completed',
                closedAt: FieldValue.serverTimestamp()
            };

            // ✅ Only add optional fields if they exist (V1 tabs have these, V2 might not)
            if (tabData.totalAmount !== undefined) {
                updateData.finalTotalAmount = tabData.totalAmount;
            }
            if (tabData.paidAmount !== undefined) {
                updateData.finalPaidAmount = tabData.paidAmount;
            }

            transaction.update(tabRef, updateData);

            // ✅ CRITICAL: Mark all orders for this tab as cleaned
            // This ensures they move to history and table becomes available
            return {
                totalCollected: tabData.paidAmount || 0,
                integrityVerified: integrityValid,
                tabId: tabId,
                tableId: tabData.tableId,
                pax_count: tabData.pax_count || 0 // ✅ Needed for table cleanup
            };
        });

        // ✅ Mark all orders as cleaned (outside transaction for better error handling)
        try {
            let ordersSnap = await firestore.collection('orders')
                .where('deliveryType', '==', 'dine-in')
                .where('dineInTabId', '==', tabId)
                .get();
            if (ordersSnap.empty) {
                ordersSnap = await firestore.collection('orders')
                    .where('deliveryType', '==', 'dine-in')
                    .where('tabId', '==', tabId)
                    .get();
            }

            if (!ordersSnap.empty) {
                const batch = firestore.batch();
                ordersSnap.forEach(doc => {
                    batch.update(doc.ref, {
                        cleaned: true,
                        cleanedAt: FieldValue.serverTimestamp()
                    });
                });
                await batch.commit();
                console.log(`[Clean Table] ✅ Marked ${ordersSnap.size} orders as cleaned for tab ${tabId}`);
            }
        } catch (err) {
            console.warn(`[Clean Table] ⚠️ Could not mark orders as cleaned:`, err.message);
            // Continue anyway - tab is already marked completed
        }

        // ✅ CRITICAL: Update table document - decrement current_pax
        if (result.tableId && businessRef) {
            try {
                const tablesSnap = await businessRef.collection('tables').get();
                let actualTableId = null;
                tablesSnap.forEach((doc) => {
                    if (String(doc.id).toLowerCase() === String(result.tableId).toLowerCase()) {
                        actualTableId = doc.id;
                    }
                });

                if (actualTableId) {
                    const tableRef = businessRef.collection('tables').doc(actualTableId);
                    const tableSnap = await tableRef.get();
                    const tableData = tableSnap.data() || {};

                    const openTabsSnap = await businessRef.collection('dineInTabs')
                        .where('tableId', '==', actualTableId)
                        .where('status', 'in', ['active', 'inactive'])
                        .get();

                    const recalculatedPax = openTabsSnap.docs.reduce((sum, doc) => {
                        return sum + Math.max(0, Number(doc.data()?.pax_count || 0));
                    }, 0);

                    const paxToRemove = result.pax_count || 0;
                    const fallbackPax = Math.max(0, (tableData.current_pax || 0) - paxToRemove);
                    const newCurrentPax = openTabsSnap.empty ? fallbackPax : recalculatedPax;

                    await tableRef.set({
                        current_pax: newCurrentPax,
                        state: newCurrentPax > 0 ? 'occupied' : 'available',
                        cleanedAt: FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    }, { merge: true });
                    console.log(`[Clean Table] ✅ Updated table ${actualTableId}: current_pax ${tableData.current_pax || 0} → ${newCurrentPax}`);
                } else {
                    console.warn(`[Clean Table] ⚠️ Table ${result.tableId} not found`);
                }
            } catch (err) {
                console.error(`[Clean Table] ❌ Failed to update table:`, err.message);
                // Continue anyway - tab is already cleaned
            }
        }


        return NextResponse.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('[Clean Table Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to clean table' },
            { status: 500 }
        );
    }
}

export async function POST(req) {
    return handleCleanTable(req);
}

export async function PATCH(req) {
    return handleCleanTable(req);
}
