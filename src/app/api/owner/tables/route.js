
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

        // Fetch active tabs for this table
        const tabsSnap = await businessInfo.collection('dineInTabs')
            .where('tableId', '==', actualTableId)
            .where('status', '==', 'active')
            .get();

        const validActiveTabs = tabsSnap.docs.map(doc => doc.data());

        // Calculate current pax from active tabs
        const current_pax = validActiveTabs.reduce((sum, tab) => sum + (tab.pax_count || 0), 0);

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

        // NEW: Calculate total pax from uncleaned orders (their seats are dirty!)
        // DEFAULT to 1 pax per order if pax_count is missing (for old orders)
        const uncleanedPax = uncleanedOrders.reduce((sum, doc) => {
            const orderData = doc.data();
            return sum + (orderData.pax_count || 1);  // Fallback to 1 if missing
        }, 0);

        // FIXED: Subtract both current_pax AND uncleaned_pax from capacity
        const availableSeats = tableData.max_capacity - current_pax - uncleanedPax;

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

                // CRITICAL: Calculate live capacity from active tabs, not stale table field!
                // Query actual active tabs to get accurate current_pax
                const activeTabsQuery = await businessRef.collection('dineInTabs')
                    .where('tableId', '==', actualTableId)
                    .where('status', '==', 'active')
                    .get();

                // Sum pax from all active tabs
                const current_pax = activeTabsQuery.docs.reduce((sum, doc) => {
                    return sum + (doc.data().pax_count || 0);
                }, 0);

                const availableCapacity = tableData.max_capacity - current_pax;

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
                    current_pax: FieldValue.increment(Number(pax_count)),
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
