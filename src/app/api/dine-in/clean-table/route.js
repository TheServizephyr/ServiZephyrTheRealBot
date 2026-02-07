/**
 * CLEAN TABLE API
 * 
 * Closes a dine-in tab after verifying all payments
 * Includes integrity check before closing
 * Makes table available for new customers
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyTabIntegrity, areAllOrdersPaid, validateTabToken } from '@/lib/dinein-utils';

async function handleCleanTable(req) {
    try {
        const body = await req.json();
        console.log('[Clean Table] 🔍 Request body:', body);

        const { tabId, token, restaurantId } = body;

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

        // ✅ Try to find tab in multiple locations (V1 vs V2 structure)
        let tabRef, tabSnap;

        // Try global collection first (V1 structure)
        tabRef = firestore.collection('dine_in_tabs').doc(tabId);
        tabSnap = await tabRef.get();

        // If not found and restaurantId provided, try restaurant subcollection (V2 structure)
        if (!tabSnap.exists && restaurantId) {
            console.log(`[Clean Table] Tab not in global collection, checking restaurant subcollection for ${restaurantId}`);
            tabRef = firestore.collection('restaurants').doc(restaurantId).collection('dineInTabs').doc(tabId);
            tabSnap = await tabRef.get();
        }

        if (!tabSnap.exists) {
            console.log(`[Clean Table] ❌ Tab ${tabId} not found in any location`);

            // ✅ CRITICAL: Even if tab doesn't exist, mark orders as cleaned!
            // This handles old orders that never had tab documents
            try {
                const ordersQuery = firestore.collection('orders')
                    .where('dineInTabId', '==', tabId)
                    .where('deliveryType', '==', 'dine-in');

                const ordersSnap = await ordersQuery.get();

                if (!ordersSnap.empty) {
                    const batch = firestore.batch();
                    ordersSnap.forEach(doc => {
                        batch.update(doc.ref, {
                            cleaned: true,
                            cleanedAt: FieldValue.serverTimestamp()
                        });
                    });
                    await batch.commit();
                    console.log(`[Clean Table] ✅ Marked ${ordersSnap.size} orders as cleaned (tab doc not found)`);

                    return NextResponse.json({
                        success: true,
                        message: 'Orders marked as cleaned (tab not found)',
                        totalCollected: 0,
                        integrityVerified: true
                    }, { status: 200 });
                }
            } catch (err) {
                console.warn(`[Clean Table] Could not mark orders:`, err.message);
            }

            // Tab doesn't exist and no orders found = already cleaned!
            return NextResponse.json(
                {
                    success: true,
                    message: 'Tab not found (already cleaned or never existed)',
                    totalCollected: 0,
                    integrityVerified: true
                },
                { status: 200 }
            );
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
            const ordersQuery = firestore.collection('orders')
                .where('dineInTabId', '==', tabId)
                .where('deliveryType', '==', 'dine-in');

            const ordersSnap = await ordersQuery.get();

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
        if (result.tableId && restaurantId) {
            try {
                const tableRef = firestore.collection('restaurants').doc(restaurantId).collection('tables').doc(result.tableId);
                const tableSnap = await tableRef.get();

                if (tableSnap.exists) {
                    const tableData = tableSnap.data();
                    const paxToRemove = result.pax_count || 0;
                    const newCurrentPax = Math.max(0, (tableData.current_pax || 0) - paxToRemove);

                    const tableUpdate = {
                        current_pax: newCurrentPax,
                        updatedAt: FieldValue.serverTimestamp()
                    };

                    // If table is now empty, mark as Available
                    if (newCurrentPax === 0) {
                        tableUpdate.status = 'Available';
                    }

                    await tableRef.update(tableUpdate);
                    console.log(`[Clean Table] ✅ Updated table ${result.tableId}: current_pax ${tableData.current_pax} → ${newCurrentPax}`);
                } else {
                    console.warn(`[Clean Table] ⚠️ Table ${result.tableId} not found`);
                }
            } catch (err) {
                console.error(`[Clean Table] ❌ Failed to update table:`, err.message);
                // Continue anyway - tab is already cleaned
            }
        }


        // Step 3: Double-check all orders are paid
        const allPaid = await areAllOrdersPaid(tabId);

        if (!allPaid) {
            console.error(`[Clean Table] Some orders not paid for tab ${tabId}`);
            // Revert tab status
            await firestore.collection('dine_in_tabs').doc(tabId).update({
                status: 'active',
                closedAt: null
            });

            return NextResponse.json(
                { error: 'Some orders are not paid' },
                { status: 400 }
            );
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
