
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

async function getBusinessRef(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    let finalUserId = uid;

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    // Admin impersonation
    if (userRole === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    }
    // Employee access
    else if (employeeOfOwnerId) {
        const linkedOutlets = userData.linkedOutlets || [];
        const hasAccess = linkedOutlets.some(o => o.ownerId === employeeOfOwnerId && o.status === 'active');

        if (!hasAccess) {
            throw { message: 'Access Denied: You are not an employee of this outlet.', status: 403 };
        }
        finalUserId = employeeOfOwnerId;
    }
    // Owner access
    else if (!['owner', 'restaurant-owner', 'shop-owner', 'admin'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops'];
    for (const collection of collectionsToTry) {
        const query = await firestore.collection(collection).where('ownerId', '==', finalUserId).limit(1).get();
        if (!query.empty) {
            return query.docs[0].ref;
        }
    }

    throw { message: 'No business associated with this request.', status: 404 };
}


export async function GET(req) {
    const firestore = await getFirestore();
    try {
        const businessRef = await getBusinessRef(req);
        if (!businessRef) throw { message: 'Business reference not found.', status: 404 };

        // 1. Fetch ALL tables from the `/tables` subcollection. This is our source of truth.
        const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
        const tableMap = new Map();

        tablesSnap.forEach(doc => {
            tableMap.set(doc.id, {
                id: doc.id,
                ...doc.data(),
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
        // IMPORTANT: Include 'delivered' status - tabs should stay visible for payment/cleaning flow
        const ordersQuery = firestore.collection('orders')
            .where('restaurantId', '==', businessRef.id)
            .where('deliveryType', '==', 'dine-in')
            .where('status', 'not-in', ['picked_up', 'rejected']); // Removed 'delivered' from exclusion

        const ordersSnap = await ordersQuery.get();

        // 5. Group ALL orders by tab_name for same table - this ensures same customer shows as ONE entry
        // Structure: { tableId_tabName: { orders: [...], hasPending: bool, ... } }
        const orderGroups = new Map();

        ordersSnap.forEach(orderDoc => {
            const orderData = orderDoc.data();
            const tableId = orderData.tableId;
            const tabId = orderData.dineInTabId;
            const status = orderData.status;

            const table = tableMap.get(tableId);
            if (!table) return;

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

        // Now add grouped orders to tables
        // Determine if group has pending items or not
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
                items: orders.flatMap(o => o.items || []),
                isPaid, // NEW: Payment status
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
                    tab.items = orders.flatMap(o => o.items || []);
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

        if (action === 'clear_tab') {
            if (!tabId || !tableId) return NextResponse.json({ message: 'Tab ID and Table ID are required to clear a tab.' }, { status: 400 });

            await firestore.runTransaction(async (transaction) => {
                const tabRef = businessRef.collection('dineInTabs').doc(tabId);
                const orderRef = firestore.collection('orders').doc(tabId); // tabId might be an order ID
                const tableDoc = await transaction.get(tableRef);
                const tabDoc = await transaction.get(tabRef);
                const orderDoc = await transaction.get(orderRef);

                const isTab = tabDoc.exists;
                const isOrder = orderDoc.exists && !isTab;

                if (!isTab && !isOrder && !tableDoc.exists) {
                    throw new Error("Could not find tab or order to clear.");
                }

                if (tableDoc.exists && (isTab || isOrder)) {
                    const itemPaxCount = isTab
                        ? (tabDoc.data().pax_count || 0)
                        : (orderDoc.data().pax_count || paxCount || 0);
                    const newPax = Math.max(0, (tableDoc.data().current_pax || 0) - itemPaxCount);
                    transaction.update(tableRef, {
                        current_pax: newPax,
                        state: newPax > 0 ? 'occupied' : 'available'
                    });
                }

                if (isTab) {
                    // Delete the tab from dineInTabs collection
                    transaction.delete(tabRef);
                } else if (isOrder) {
                    // Reject/cancel the order
                    transaction.update(orderRef, {
                        status: 'rejected',
                        rejectionReason: 'Cleared by staff'
                    });
                }
            });
            return new NextResponse(null, { status: 204 });
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
        const tableRef = businessRef.collection('tables').doc(tableId);
        await tableRef.delete();
        return NextResponse.json({ message: 'Table deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL DELETE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
