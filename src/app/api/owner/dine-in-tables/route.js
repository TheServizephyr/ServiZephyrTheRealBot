import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';

export async function GET(req) {
    const firestore = await getFirestore();
    try {
        const { businessId, businessSnap } = await verifyOwnerWithAudit(req, 'fetch_dine_in_tables');
        const businessRef = businessSnap.ref;

        // 1. Fetch ALL tables from the `/tables` subcollection. This is our source of truth.
        const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
        const tableMap = new Map();

        tablesSnap.forEach(doc => {
            const data = doc.data();
            tableMap.set(doc.id, {
                id: doc.id,
                ...data,
                _db_pax: data.current_pax || 0, // Capture DB state for sync check
                _db_state: data.state || 'available',
                tabs: {}, // Initialize as empty object
                pendingOrders: [] // Initialize as empty array
            });
        });

        // 2. Fetch all active tabs
        // DISABLED: Loading tabs from dineInTabs causes duplicates because orders are already grouped below
        // const activeTabsSnap = await businessRef.collection('dineInTabs').where('status', '==', 'active').get();

        // 3. Group active tabs by their tableId
        // activeTabsSnap.forEach(tabDoc => {
        //     const tabData = tabDoc.data();
        //     if (tableMap.has(tabData.tableId)) {
        //         const table = tableMap.get(tabData.tableId);
        //         table.tabs[tabData.id] = { ...tabData, orders: {} };
        //     }
        // });

        // 4. Fetch all relevant orders that are not finished or rejected
        // IMPORTANT: Include 'delivered' status - tabs should stay visible until cleaned
        // NOTE: Can't use multiple inequality filters in Firestore, so filtering 'cleaned' in code
        const ordersQuery = firestore.collection('orders')
            .where('restaurantId', '==', businessRef.id)
            .where('deliveryType', '==', 'dine-in')
            .where('status', 'not-in', ['picked_up', 'rejected', 'cancelled']);

        const ordersSnap = await ordersQuery.get();

        // 5. Group active orders by tab_name for same table - this ensures same customer shows as ONE entry
        // ✅ Filter out cleaned orders in code (can't do in query due to Firestore limitation)
        // Structure: { tableId_tabName: { orders: [...], hasPending: bool, ... } }
        const orderGroups = new Map();

        ordersSnap.forEach(orderDoc => {
            const orderData = orderDoc.data();

            // ✅ Skip cleaned orders (filter in code since can't use 2 inequalities in Firestore)
            if (orderData.cleaned === true) {
                return; // Skip this order
            }

            const tableId = orderData.tableId;
            const tabId = orderData.dineInTabId;
            const status = orderData.status;

            // Get table - Try exact match first, then case-insensitive
            let table = tableMap.get(tableId);

            if (!table && tableId) {
                // Try case-insensitive lookup for backward compatibility
                const upperTableId = tableId.toUpperCase();
                table = tableMap.get(upperTableId);

                if (table) {
                    console.log(`[Dine-In API] Case-insensitive match: "${tableId}" → "${upperTableId}"`);
                }
            }

            if (!table) {
                // Order has invalid tableId - skip this orphaned order silently
                // console.log(`[Dine-In API] Skipping orphaned order ${orderDoc.id} - table ${tableId} not found`);
                return; // Skip this order
            }

            // NOTE: dineInTabs loading disabled above, so all orders go to orderGroups
            // (This ensures single detailed card per tab)

            // CRITICAL: Group by dineInToken to prevent duplicate cards
            // Orders with same token should ALWAYS be in the same group
            const tabName = orderData.tab_name || orderData.customerName || 'Guest';
            const dineInToken = orderData.dineInToken;

            // Priority: dineInToken > tabId > tableId_tabName
            // This ensures orders with same token are grouped even if tabId differs
            let groupKey;
            if (dineInToken) {
                // Use token as key - prevents duplicates when token is same
                groupKey = `${tableId}_token_${dineInToken}`;
            } else if (tabId) {
                // Fallback to tabId
                groupKey = tabId;
            } else {
                // Last resort: table + name
                groupKey = `${tableId}_${tabName}`;
            }

            if (!orderGroups.has(groupKey)) {
                orderGroups.set(groupKey, {
                    id: groupKey,
                    tableId,
                    tab_name: tabName,
                    pax_count: orderData.pax_count || 1,
                    orders: {},
                    dineInToken: orderData.dineInToken,
                    dineInTabId: tabId, // Store tabId for reference
                    ordered_by: orderData.ordered_by,
                    ordered_by_name: orderData.ordered_by_name,
                    paymentMethod: orderData.paymentMethod,
                    paymentDetails: orderData.paymentDetails,
                });
            }

            const group = orderGroups.get(groupKey);
            group.orders[orderDoc.id] = { id: orderDoc.id, ...orderData };

            // Keep the latest token
            if (orderData.dineInToken && !group.dineInToken) {
                group.dineInToken = orderData.dineInToken;
            }

            // Update tab_name and pax_count to latest values
            if (orderData.tab_name) {
                group.tab_name = orderData.tab_name;
            }
            if (orderData.pax_count) {
                group.pax_count = orderData.pax_count;
            }
        });

        // ✅ Filter out completed tabs from dashboard
        // Check tab status in Firestore and exclude completed tabs
        const tabIds = Array.from(new Set(
            Array.from(orderGroups.values())
                .map(g => g.dineInTabId)
                .filter(Boolean)
        ));

        const completedTabIds = new Set();

        if (tabIds.length > 0) {
            // Batch fetch tab statuses
            const tabPromises = tabIds.map(async (tabId) => {
                try {
                    // Try restaurant subcollection (V2)
                    const tabRef = businessRef.collection('dineInTabs').doc(tabId);
                    const tabSnap = await tabRef.get();

                    // ✅ ONLY exclude if tab EXISTS and status='completed'
                    // Non-existent tabs are valid (backwards compatibility with old orders)
                    if (tabSnap.exists && tabSnap.data().status === 'completed') {
                        completedTabIds.add(tabId);
                        console.log(`[Dine-In API] ✅ Hiding completed tab from dashboard: ${tabId}`);
                    }
                } catch (err) {
                    console.warn(`[Dine-In API] Error checking tab ${tabId}:`, err.message);
                }
            });

            await Promise.all(tabPromises);
        }

        // Now add grouped orders to tables
        // ✅ Cleaned orders already excluded by query
        orderGroups.forEach((group, groupKey) => {
            const table = tableMap.get(group.tableId);
            if (!table) return;

            const orders = Object.values(group.orders);
            const hasPending = orders.some(o => o.status === 'pending');
            const hasConfirmed = orders.some(o => o.status !== 'pending' && o.status !== 'rejected');

            // Calculate total amount for all orders
            const totalAmount = orders.reduce((sum, o) => sum + (o.totalAmount || o.grandTotal || 0), 0);

            // Get the "main" order status (lowest in progression)
            const statusPriority = { 'pending': 0, 'confirmed': 1, 'preparing': 2, 'ready_for_pickup': 3, 'delivered': 4 };
            const lowestStatus = orders.reduce((lowest, o) => {
                const orderPriority = statusPriority[o.status] ?? 99;
                const lowestPriority = statusPriority[lowest] ?? 99;
                return orderPriority < lowestPriority ? o.status : lowest;
            }, 'delivered');

            // Determine payment status
            const isOnlinePayment = orders.some(o => o.paymentDetails?.method === 'razorpay' || o.paymentDetails?.method === 'phonepe');
            const isPaidStatus = orders.some(o => o.paymentStatus === 'paid');
            const isPaid = isOnlinePayment || isPaidStatus;
            const isServed = lowestStatus === 'delivered';

            const groupData = {
                ...group,
                totalAmount,
                hasPending,
                hasConfirmed,
                status: hasPending ? 'pending' : 'active',
                mainStatus: lowestStatus, // For determining which button to show
                items: orders.flatMap(o => o.items || []), // Legacy merged items
                // Add orderBatches array with individual order metadata
                orderBatches: orders
                    .map(o => ({
                        id: o.id,
                        items: o.items || [],
                        status: o.status,
                        totalAmount: o.totalAmount || o.grandTotal || 0,
                        orderDate: o.orderDate,
                        paymentStatus: o.paymentStatus,
                        paymentMethod: o.paymentMethod,
                        canCancel: ['pending', 'confirmed'].includes(o.status)
                    }))
                    .sort((a, b) => {
                        const timeA = a.orderDate?._seconds || 0;
                        const timeB = b.orderDate?._seconds || 0;
                        return timeA - timeB;
                    }),
                isPaid, // NEW: Payment status
                paymentStatus: isPaid ? 'paid' : (orders.some(o => o.paymentStatus === 'pay_at_counter' || o.paymentMethod === 'counter') ? 'pay_at_counter' : 'pending'),
                needsCleaning: isServed && isPaid && !group.cleaned, // NEW: Needs cleaning if served + paid but not cleaned
            };

            // If has any pending, put in pendingOrders
            if (hasPending) {
                table.pendingOrders.push(groupData);
            } else {
                // Active orders go to tabs (detailed view)
                // Override any existing tab from dineInTabs with full orderGroup details
                table.tabs[groupKey] = groupData;
            }
        });

        // 5.5. Calculate hasPending, status, mainStatus for tabs (for button display)
        tableMap.forEach(table => {
            Object.values(table.tabs).forEach(tab => {
                const orders = Object.values(tab.orders || {});
                if (orders.length > 0) {
                    const hasPending = orders.some(o => o.status === 'pending');
                    const hasConfirmed = orders.some(o => o.status !== 'pending' && o.status !== 'rejected');

                    // Calculate total amount
                    const totalAmount = orders.reduce((sum, o) => sum + (o.totalAmount || o.grandTotal || 0), 0);

                    // Get main status (lowest in progression)
                    const statusPriority = { 'pending': 0, 'confirmed': 1, 'preparing': 2, 'ready_for_pickup': 3, 'delivered': 4 };
                    const lowestStatus = orders.reduce((lowest, o) => {
                        const orderPriority = statusPriority[o.status] ?? 99;
                        const lowestPriority = statusPriority[lowest] ?? 99;
                        return orderPriority < lowestPriority ? o.status : lowest;
                    }, 'delivered');

                    // Update tab with calculated fields
                    tab.hasPending = hasPending;
                    tab.hasConfirmed = hasConfirmed;
                    tab.status = hasPending ? 'pending' : 'active';
                    tab.mainStatus = lowestStatus;
                    tab.totalAmount = totalAmount;

                    // CRITICAL: Return orders as ARRAY not object, sorted by timestamp
                    tab.orderBatches = orders
                        .map(o => ({
                            id: o.id,
                            items: o.items || [],
                            status: o.status,
                            totalAmount: o.totalAmount || o.grandTotal || 0,
                            orderDate: o.orderDate, // Firestore timestamp
                            paymentStatus: o.paymentStatus,
                            paymentMethod: o.paymentMethod,
                            canCancel: ['pending', 'confirmed'].includes(o.status) // Helper for UI
                        }))
                        .sort((a, b) => {
                            // Sort by orderDate (oldest first)
                            const timeA = a.orderDate?._seconds || 0;
                            const timeB = b.orderDate?._seconds || 0;
                            return timeA - timeB;
                        });

                    // Keep merged items for backward compatibility (legacy UI)
                    tab.items = orders.flatMap(o => o.items || []);

                    const isPaid = orders.some(o => o.paymentStatus === 'paid' || o.paymentDetails?.method === 'razorpay' || o.paymentDetails?.method === 'phonepe');
                    tab.paymentStatus = isPaid ? 'paid' : (orders.some(o => o.paymentStatus === 'pay_at_counter' || o.paymentMethod === 'counter') ? 'pay_at_counter' : 'pending');
                }
            });
        });

        // 6. Recalculate current_pax and state for EVERY table based on live data
        tableMap.forEach(table => {
            const totalPaxInTabs = Object.values(table.tabs).reduce((sum, tab) => sum + (tab.pax_count || 0), 0);

            // For pending orders: group by tab_name to avoid duplicate counting
            // Multiple orders from same party should only count pax once
            const pendingParties = new Map();
            table.pendingOrders.forEach(order => {
                const partyKey = order.tab_name || order.customerName || order.id;
                if (!pendingParties.has(partyKey)) {
                    pendingParties.set(partyKey, order.pax_count || 1);
                }
            });
            const totalPaxInPending = Array.from(pendingParties.values()).reduce((sum, pax) => sum + pax, 0);

            const current_pax = totalPaxInTabs + totalPaxInPending;

            // Overwrite database value with calculated value - cap at max_capacity
            table.current_pax = Math.min(current_pax, table.max_capacity || 99);

            // Update state based on live pax count, unless it needs cleaning
            if (table.state === 'needs_cleaning') {
                // Keep the state as is
            } else if (current_pax > 0) {
                table.state = 'occupied';
            } else {
                table.state = 'available';
            }
        });

        // 6.5. Self-Healing: Update DB if calculated state/pax differs from DB
        // This fixes "Occupied" ghost state when orders are cancelled externally
        const tablesToUpdate = [];
        tableMap.forEach(table => {
            const stateChanged = table.state !== table._db_state;
            // Only update pax if state also changed or pax diff is significant, 
            // OR if strictly occupied/available mismatch (occupied but pax 0, or available but pax > 0)
            const paxChanged = table.current_pax !== table._db_pax;

            if (stateChanged || (paxChanged && table.state === 'occupied')) {
                tablesToUpdate.push({
                    ref: businessRef.collection('tables').doc(table.id),
                    data: {
                        current_pax: table.current_pax,
                        state: table.state,
                        lastSyncedAt: FieldValue.serverTimestamp() // Audit trail
                    }
                });
            }
        });

        if (tablesToUpdate.length > 0) {
            console.log(`[Dine-In API] Self-healing ${tablesToUpdate.length} tables in background...`);
            const batch = firestore.batch();
            tablesToUpdate.forEach(t => batch.update(t.ref, t.data));

            // Background execution
            batch.commit().catch(e => console.error("[Dine-In API] Background self-heal failed:", e));
        }

        const finalTablesData = Array.from(tableMap.values());

        // Fetch other data as before
        const serviceRequestsSnap = await businessRef.collection('serviceRequests').where('status', '==', 'pending').orderBy('createdAt', 'desc').get();
        const serviceRequests = serviceRequestsSnap.docs.map(doc => ({ ...doc.data(), createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().toISOString() : new Date().toISOString() }));

        const thirtyDaysAgo = subDays(new Date(), 30);
        const closedTabsQuery = businessRef.collection('dineInTabs').where('status', '==', 'closed').where('closedAt', '>=', thirtyDaysAgo).orderBy('closedAt', 'desc');
        const closedTabsSnap = await closedTabsQuery.get();
        const closedTabs = closedTabsSnap.docs.map(doc => ({ ...doc.data(), closedAt: doc.data().closedAt.toDate().toISOString() }));

        return NextResponse.json({ tables: finalTablesData, serviceRequests, closedTabs }, { status: 200 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL GET ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    const firestore = await getFirestore();
    const body = await req.json();

    try {
        const businessRef = await getBusinessRef(req);
        if (!businessRef) return NextResponse.json({ message: 'Business not found or authentication failed.', status: 404 });

        if (body.action === 'create_tab') {
            const { tableId, pax_count, tab_name } = body;
            if (!tableId || !pax_count || !tab_name) {
                return NextResponse.json({ message: 'Table ID, pax count, and tab name are required.' }, { status: 400 });
            }

            const tableRef = businessRef.collection('tables').doc(tableId);
            const newTabId = `tab_${Date.now()}`;

            try {
                await firestore.runTransaction(async (transaction) => {
                    const tableDoc = await transaction.get(tableRef);
                    if (!tableDoc.exists) throw new Error("Table not found.");

                    const tableData = tableDoc.data();
                    const availableCapacity = tableData.max_capacity - (tableData.current_pax || 0);

                    if (pax_count > availableCapacity) {
                        throw new Error(`Capacity exceeded. Only ${availableCapacity} seats available.`);
                    }

                    const newTabRef = businessRef.collection('dineInTabs').doc(newTabId);
                    const newTabData = {
                        id: newTabId,
                        tableId,
                        restaurantId: businessRef.id,
                        status: 'inactive', // Tab starts as inactive until first order
                        tab_name,
                        pax_count: Number(pax_count),
                        createdAt: FieldValue.serverTimestamp(),
                        totalBill: 0,
                        orders: {}
                    };
                    transaction.set(newTabRef, newTabData);

                    transaction.update(tableRef, {
                        current_pax: FieldValue.increment(Number(pax_count)),
                        state: 'occupied'
                    });
                });
                return NextResponse.json({ message: 'Tab created successfully!', tabId: newTabId }, { status: 201 });
            } catch (txError) {
                console.error("[API dine-in-tables] CRITICAL Transaction Error (create_tab):", txError);
                return NextResponse.json({ message: txError.message }, { status: 400 });
            }
        }

        const { tableId, max_capacity } = body;
        if (!tableId || !max_capacity || max_capacity < 1) return NextResponse.json({ message: 'Table ID and a valid capacity are required.' }, { status: 400 });
        const tableRef = businessRef.collection('tables').doc(tableId);
        await tableRef.set({ id: tableId, max_capacity: Number(max_capacity), createdAt: FieldValue.serverTimestamp(), state: 'available', current_pax: 0 }, { merge: true });

        return NextResponse.json({ message: 'Table saved successfully.' }, { status: 201 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL POST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    const firestore = await getFirestore();
    try {
        const businessRef = await getBusinessRef(req);
        const body = await req.json();
        const { tableId, action, tabId, paymentMethod, paxCount, newTableId, newCapacity } = body;

        const tableRef = businessRef.collection('tables').doc(tableId);

        // Handle table editing (updating table ID or capacity)
        if (newTableId !== undefined || newCapacity !== undefined) {
            const tableDoc = await tableRef.get();
            if (!tableDoc.exists) {
                return NextResponse.json({ message: 'Table not found.' }, { status: 404 });
            }

            const currentData = tableDoc.data();

            // If table ID is changing, we need to create new doc and delete old
            if (newTableId && newTableId !== tableId) {
                const newTableRef = businessRef.collection('tables').doc(newTableId);
                const existingNew = await newTableRef.get();
                if (existingNew.exists) {
                    return NextResponse.json({ message: 'A table with this ID already exists.' }, { status: 400 });
                }

                // Create new table with updated data
                await newTableRef.set({
                    ...currentData,
                    id: newTableId,
                    max_capacity: newCapacity ? Number(newCapacity) : currentData.max_capacity
                });

                // Delete old table
                await tableRef.delete();

                return NextResponse.json({ message: 'Table updated successfully.' }, { status: 200 });
            } else {
                // Just update capacity
                await tableRef.update({
                    max_capacity: newCapacity ? Number(newCapacity) : currentData.max_capacity
                });
                return NextResponse.json({ message: 'Table capacity updated successfully.' }, { status: 200 });
            }
        }

        // Handle clear_tab action - NEW APPROACH
        if (action === 'clear_tab') {
            if (!tabId) {
                return NextResponse.json({ message: 'Tab ID is required for clear_tab action.' }, { status: 400 });
            }

            // ✅ PHASE 1 INTEGRATION: Verify integrity before clearing
            try {
                const { isValid, mismatch } = await verifyTabIntegrity(tabId);
                if (!isValid) {
                    console.warn(`[Clear Tab] Tab ${tabId} had mismatch of ₹${mismatch}, auto-corrected`);
                }
            } catch (integrityErr) {
                console.warn('[Clear Tab] Integrity check failed:', integrityErr.message);
                // Continue with clearing even if check fails
            }

            // ✅ PHASE 1 INTEGRATION: Check all orders paid
            try {
                const allPaid = await areAllOrdersPaid(tabId);
                if (!allPaid) {
                    return NextResponse.json(
                        { error: 'Cannot clear tab: Some orders are not paid yet' },
                        { status: 400 }
                    );
                }
            } catch (paidCheckErr) {
                console.warn('[Clear Tab] Payment check failed:', paidCheckErr.message);
                // Continue cautiously
            }

            // Find all orders with this dineInTabId and mark them as 'picked_up' to exclude from active tabs
            const ordersQuery = await firestore.collection('orders')
                .where('restaurantId', '==', businessRef.id)
                .where('deliveryType', '==', 'dine-in')
                .where('dineInTabId', '==', tabId)
                .where('status', 'not-in', ['picked_up', 'rejected'])
                .get();

            if (ordersQuery.empty) {
                return NextResponse.json({ message: 'No active orders found for this tab.' }, { status: 404 });
            }

            // Batch update all orders to 'picked_up' status
            const batch = firestore.batch();
            ordersQuery.forEach(orderDoc => {
                batch.update(orderDoc.ref, {
                    status: 'picked_up',
                    statusHistory: FieldValue.arrayUnion({
                        status: 'picked_up',
                        timestamp: new Date()
                    }),
                    tabClosedAt: FieldValue.serverTimestamp()
                });
            });

            await batch.commit();

            // Close ALL dineInTabs associated with these orders
            try {
                // Get all unique table IDs from the orders
                const tableIds = [...new Set(ordersQuery.docs.map(doc => doc.data().tableId))];

                for (const tableId of tableIds) {
                    if (!tableId) continue;

                    // Find ALL active tabs for this table - close them all when clearing
                    const tabsQuery = await businessRef.collection('dineInTabs')
                        .where('tableId', '==', tableId)
                        .where('status', '==', 'active')
                        .get();

                    if (tabsQuery.empty) continue;

                    // Close ALL tabs for this table (Clear Table = clear everything)
                    const tabBatch = firestore.batch();

                    tabsQuery.docs.forEach(tabDoc => {
                        tabBatch.update(tabDoc.ref, {
                            status: 'closed',
                            closedAt: FieldValue.serverTimestamp()
                        });
                    });

                    await tabBatch.commit();
                    console.log(`[API clear_tab] Closed ${tabsQuery.size} tab(s) for table ${tableId}`);
                }
            } catch (tabError) {
                console.warn('[API dine-in-tables] Could not close dineInTabs:', tabError.message);
                // Don't fail the entire operation if this fails
            }

            return NextResponse.json({ message: 'Tab cleared successfully.' }, { status: 200 });
        }


        if (action === 'mark_paid') {
            if (!tableId || !tabId) return NextResponse.json({ message: 'Table and Tab ID are required.' }, { status: 400 });

            await firestore.runTransaction(async (transaction) => {
                const tabRef = businessRef.collection('dineInTabs').doc(tabId);
                const tableDoc = await transaction.get(tableRef);
                const tabDoc = await transaction.get(tabRef);

                if (!tabDoc.exists) throw new Error("Tab to close not found.");

                const tabData = tabDoc.data();

                Object.keys(tabData.orders || {}).forEach(orderId => {
                    const orderRef = firestore.collection('orders').doc(orderId);
                    transaction.update(orderRef, {
                        status: 'delivered',
                        paymentDetails: { ...(tabData.orders[orderId]?.paymentDetails || {}), method: paymentMethod || 'cod' }
                    });
                });

                const tabPax = tabData.pax_count || 0;

                transaction.update(tabRef, {
                    status: 'closed',
                    closedAt: FieldValue.serverTimestamp(),
                    paymentMethod: paymentMethod || 'cod'
                });

                if (tableDoc.exists) {
                    transaction.update(tableRef, {
                        state: 'needs_cleaning',
                        lastClosedAt: FieldValue.serverTimestamp(),
                        current_pax: FieldValue.increment(-tabPax),
                    });
                }
            });
            return NextResponse.json({ message: `Table ${tableId} marked as needing cleaning.` }, { status: 200 });
        }

        if (action === 'mark_cleaned') {
            await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error("Table not found.");

                const activeTabsQuery = businessRef.collection('dineInTabs').where('tableId', '==', tableId).where('status', '==', 'active');
                const activeTabsSnap = await transaction.get(activeTabsQuery);

                const newPax = activeTabsSnap.docs.reduce((sum, doc) => sum + (doc.data().pax_count || 0), 0);

                transaction.update(tableRef, {
                    state: newPax > 0 ? 'occupied' : 'available',
                    current_pax: newPax
                });
            });
            return NextResponse.json({ message: `Table ${tableId} cleaning acknowledged.` }, { status: 200 });
        }

        return NextResponse.json({ message: 'No valid action or edit data provided.' }, { status: 400 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL PATCH ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function DELETE(req) {
    const firestore = await getFirestore();
    try {
        const businessRef = await getBusinessRef(req);
        const { tableId } = await req.json();
        if (!tableId) return NextResponse.json({ message: 'Table ID is required.' }, { status: 400 });

        // PREVENT DELETION OF OCCUPIED TABLES
        const activeTabs = await businessRef.collection('dineInTabs')
            .where('tableId', '==', tableId)
            .where('status', '==', 'active')
            .get();

        if (!activeTabs.empty) {
            const occupiedCount = activeTabs.docs.reduce((sum, doc) => sum + (doc.data().pax_count || 0), 0);
            return NextResponse.json({
                message: `Cannot delete table ${tableId}. There are ${occupiedCount} customers currently seated (${activeTabs.size} active session). Please clear all sessions first.`,
                activeSessions: activeTabs.size,
                occupiedSeats: occupiedCount
            }, { status: 400 });
        }

        // CRITICAL: Cleanup all associated data before deleting table
        console.log(`[API DELETE] Cleaning up all data for table ${tableId}`);

        // 1. Delete ALL tabs (active and inactive) for this table
        const allTabsQuery = await businessRef.collection('dineInTabs')
            .where('tableId', '==', tableId)
            .get();

        const tabIds = allTabsQuery.docs.map(doc => doc.id);
        console.log(`[API DELETE] Found ${tabIds.length} tabs to delete:`, tabIds);

        const batch = firestore.batch();
        allTabsQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        // 2. Delete ALL orders associated with this table
        const ordersQuery = await firestore.collection('orders')
            .where('restaurantId', '==', businessRef.id)
            .where('tableId', '==', tableId)
            .get();

        console.log(`[API DELETE] Found ${ordersQuery.size} orders to delete`);
        ordersQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        // 3. Delete the table document itself
        const tableRef = businessRef.collection('tables').doc(tableId);
        batch.delete(tableRef);

        // Commit all deletions in one transaction
        await batch.commit();

        console.log(`[API DELETE] Successfully deleted table ${tableId} and all associated data`);
        return NextResponse.json({
            message: 'Table deleted successfully.',
            deletedTabs: tabIds.length,
            deletedOrders: ordersQuery.size
        }, { status: 200 });
    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL DELETE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
