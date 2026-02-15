
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function getBusinessRef(firestore, restaurantId) {
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

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const restaurantId = searchParams.get('restaurantId');
        const tableId = searchParams.get('tableId');

        if (!restaurantId || !tableId) {
            return NextResponse.json({ message: 'Restaurant ID and Table ID are required.' }, { status: 400 });
        }

        const firestore = await getFirestore();
        const businessInfo = await getBusinessRef(firestore, restaurantId);

        if (!businessInfo) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }

        // Case-insensitive table lookup
        const tablesSnap = await businessInfo.collection('tables').get();

        let matchedTable = null;
        let actualTableId = null;

        tablesSnap.forEach(doc => {
            const data = doc.data();
            if (data.isDeleted) return; // Skip deleted tables
            if (doc.id.toLowerCase() === tableId.toLowerCase()) {
                matchedTable = data;
                actualTableId = doc.id;
            }
        });

        if (!matchedTable) {
            return NextResponse.json({ message: 'Table configuration not found.' }, { status: 404 });
        }

        const tableData = matchedTable;

        // Fetch active tabs for this table.
        // NOTE: Tab documents can become stale if orders are cancelled/rejected/cleaned.
        // We therefore validate occupancy from active orders and only then trust tabs for join UI.
        const tabsSnap = await businessInfo.collection('dineInTabs')
            .where('tableId', '==', actualTableId)
            .where('status', '==', 'active')
            .get();
        const activeTabsRaw = tabsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const activeOrdersQuery = await firestore.collection('orders')
            .where('restaurantId', '==', businessInfo.id)
            .where('deliveryType', '==', 'dine-in')
            .where('tableId', '==', actualTableId)
            .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'pay_at_counter'])
            .get();

        const activePartyPaxMap = new Map();
        const activeTabIdsFromOrders = new Set();
        activeOrdersQuery.docs.forEach((doc) => {
            const orderData = doc.data() || {};
            const partyKey = orderData.dineInTabId
                || orderData.tabId
                || orderData.dineInToken
                || `${actualTableId}:${String(orderData.tab_name || orderData.customerName || doc.id).toLowerCase()}`;
            if (!activePartyPaxMap.has(partyKey)) {
                activePartyPaxMap.set(partyKey, Number(orderData.pax_count) || 1);
            }

            if (orderData.dineInTabId) activeTabIdsFromOrders.add(String(orderData.dineInTabId));
            if (orderData.tabId) activeTabIdsFromOrders.add(String(orderData.tabId));
        });

        let validActiveTabs = [];
        if (!activeOrdersQuery.empty && activeTabIdsFromOrders.size > 0) {
            validActiveTabs = activeTabsRaw.filter(tab => activeTabIdsFromOrders.has(String(tab.id)));
        } else if (!activeOrdersQuery.empty) {
            // Legacy fallback: active orders exist but without tab ids.
            validActiveTabs = activeTabsRaw;
        }

        // Source of truth: current pax should follow active dine-in orders, not stale tab docs.
        const current_pax = Array.from(activePartyPaxMap.values()).reduce((sum, pax) => sum + pax, 0);

        // NEW: Check for uncleaned orders (delivered but not cleaned)
        const uncleanedOrdersQuery = await firestore.collection('orders')
            .where('restaurantId', '==', businessInfo.id)
            .where('deliveryType', '==', 'dine-in')
            .where('tableId', '==', actualTableId)
            .where('status', '==', 'delivered')
            .get();

        // Filter for orders that are NOT cleaned (cleaned field is missing or false)
        const uncleanedOrders = uncleanedOrdersQuery.docs.filter(doc => {
            const orderData = doc.data();
            return orderData.cleaned !== true;
        });

        const uncleanedOrdersCount = uncleanedOrders.length;
        const hasUncleanedOrders = uncleanedOrdersCount > 0;

        // Calculate pax from uncleaned orders by UNIQUE party.
        // Multiple delivered orders from the same party should not multiply occupied dirty seats.
        const uncleanedPartyPaxMap = new Map();
        uncleanedOrders.forEach((doc) => {
            const orderData = doc.data() || {};
            const partyKey = orderData.dineInTabId
                || orderData.tabId
                || orderData.dineInToken
                || `${actualTableId}:${String(orderData.tab_name || orderData.customerName || doc.id).toLowerCase()}`;
            if (!uncleanedPartyPaxMap.has(partyKey)) {
                uncleanedPartyPaxMap.set(partyKey, Number(orderData.pax_count) || 1);
            }
        });
        const uncleanedPax = Array.from(uncleanedPartyPaxMap.values()).reduce((sum, pax) => sum + pax, 0);

        // FIXED: Subtract both current_pax AND uncleaned_pax from capacity
        const availableSeats = Math.max(0, tableData.max_capacity - current_pax - uncleanedPax);

        console.log(`[API tables] Table ${actualTableId}: ${uncleanedOrdersCount} uncleaned orders (${uncleanedPax} pax), current: ${current_pax}, available: ${availableSeats}/${tableData.max_capacity}`);

        return NextResponse.json({
            tableId: actualTableId, // Return actual table ID from database
            max_capacity: tableData.max_capacity,
            current_pax,
            activeTabs: validActiveTabs,
            // Determine state based on the calculated pax count.
            state: current_pax >= tableData.max_capacity ? 'full' : (current_pax > 0 ? 'occupied' : 'available'),
            // NEW: Cleaning status for customer-facing blocking
            hasUncleanedOrders,
            uncleanedOrdersCount,
            availableSeats
        }, { status: 200 });

    } catch (error) {
        console.error("GET TABLE STATUS ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}

// POST: Public endpoint for customers to create a new tab (no auth required)
export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { action, tableId, restaurantId, pax_count, tab_name } = await req.json();

        if (action !== 'create_tab') {
            return NextResponse.json({ message: 'Invalid action.' }, { status: 400 });
        }

        if (!tableId || !restaurantId || !pax_count || !tab_name) {
            return NextResponse.json({ message: 'Table ID, Restaurant ID, pax count, and tab name are required.' }, { status: 400 });
        }

        const businessRef = await getBusinessRef(firestore, restaurantId);
        if (!businessRef) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }

        // Case-insensitive table lookup
        const tablesSnap = await businessRef.collection('tables').get();

        let actualTableId = null;
        tablesSnap.forEach(doc => {
            const data = doc.data();
            if (data.isDeleted) return;
            if (doc.id.toLowerCase() === tableId.toLowerCase()) {
                actualTableId = doc.id;
            }
        });

        if (!actualTableId) {
            return NextResponse.json({ message: 'Table not found.' }, { status: 404 });
        }

        const tableRef = businessRef.collection('tables').doc(actualTableId);
        const newTabId = `tab_${Date.now()}`;

        try {
            await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error("Table not found.");

                const tableData = tableDoc.data();

                // Calculate live occupancy from active dine-in orders and uncleaned delivered orders.
                const activeOrdersQuery = firestore.collection('orders')
                    .where('restaurantId', '==', businessRef.id)
                    .where('deliveryType', '==', 'dine-in')
                    .where('tableId', '==', actualTableId)
                    .where('status', 'in', ['pending', 'accepted', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'pay_at_counter']);
                const activeOrdersSnap = await transaction.get(activeOrdersQuery);

                const activePartyPaxMap = new Map();
                activeOrdersSnap.docs.forEach((doc) => {
                    const orderData = doc.data() || {};
                    const partyKey = orderData.dineInTabId
                        || orderData.tabId
                        || orderData.dineInToken
                        || `${actualTableId}:${String(orderData.tab_name || orderData.customerName || doc.id).toLowerCase()}`;
                    if (!activePartyPaxMap.has(partyKey)) {
                        activePartyPaxMap.set(partyKey, Number(orderData.pax_count) || 1);
                    }
                });
                const currentActivePax = Array.from(activePartyPaxMap.values()).reduce((sum, pax) => sum + pax, 0);

                const uncleanedOrdersQuery = firestore.collection('orders')
                    .where('restaurantId', '==', businessRef.id)
                    .where('deliveryType', '==', 'dine-in')
                    .where('tableId', '==', actualTableId)
                    .where('status', '==', 'delivered');
                const uncleanedOrdersSnap = await transaction.get(uncleanedOrdersQuery);

                const uncleanedPartyPaxMap = new Map();
                uncleanedOrdersSnap.docs.forEach((doc) => {
                    const orderData = doc.data() || {};
                    if (orderData.cleaned === true) return;
                    const partyKey = orderData.dineInTabId
                        || orderData.tabId
                        || orderData.dineInToken
                        || `${actualTableId}:${String(orderData.tab_name || orderData.customerName || doc.id).toLowerCase()}`;
                    if (!uncleanedPartyPaxMap.has(partyKey)) {
                        uncleanedPartyPaxMap.set(partyKey, Number(orderData.pax_count) || 1);
                    }
                });
                const uncleanedPax = Array.from(uncleanedPartyPaxMap.values()).reduce((sum, pax) => sum + pax, 0);

                const availableCapacity = Math.max(0, tableData.max_capacity - currentActivePax - uncleanedPax);

                if (pax_count > availableCapacity) {
                    throw new Error(`Capacity exceeded. Only ${availableCapacity} seats available.`);
                }

                const newTabRef = businessRef.collection('dineInTabs').doc(newTabId);
                const newTabData = {
                    id: newTabId,
                    tableId: actualTableId, // Use actual table ID from database
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
                    current_pax: currentActivePax + Number(pax_count),
                    state: 'occupied'
                });
            });
            return NextResponse.json({ message: 'Tab created successfully!', tabId: newTabId }, { status: 201 });
        } catch (txError) {
            console.error("[API tables] Transaction Error (create_tab):", txError);
            return NextResponse.json({ message: txError.message }, { status: 400 });
        }

    } catch (error) {
        console.error("POST TABLE/TAB ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}

// PATCH: Public endpoint for customers to mark they are done (table needs cleaning)
export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const { restaurantId, tableId, action } = await req.json();

        if (action !== 'customer_done') {
            return NextResponse.json({ message: 'Invalid action.' }, { status: 400 });
        }

        if (!restaurantId || !tableId) {
            return NextResponse.json({ message: 'Restaurant ID and Table ID are required.' }, { status: 400 });
        }

        const businessRef = await getBusinessRef(firestore, restaurantId);
        if (!businessRef) {
            return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }

        // Case-insensitive table lookup
        const tablesSnap = await businessRef.collection('tables').get();

        let actualTableId = null;
        tablesSnap.forEach(doc => {
            const data = doc.data();
            if (data.isDeleted) return; // Skip deleted tables
            if (doc.id.toLowerCase() === tableId.toLowerCase()) {
                actualTableId = doc.id;
            }
        });

        if (!actualTableId) {
            return NextResponse.json({ message: 'Table not found.' }, { status: 404 });
        }

        const tableRef = businessRef.collection('tables').doc(actualTableId);

        // Mark table as needs cleaning - customer is done
        await tableRef.update({
            state: 'needs_cleaning',
            customerMarkedDoneAt: FieldValue.serverTimestamp()
        });

        return NextResponse.json({ message: 'Table marked for cleaning. Thank you!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH TABLE ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
