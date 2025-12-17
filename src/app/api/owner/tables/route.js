
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

        const tableRef = businessInfo.collection('tables').doc(tableId);
        const tableSnap = await tableRef.get();

        if (!tableSnap.exists) {
            return NextResponse.json({ message: 'Table configuration not found.' }, { status: 404 });
        }
        const tableData = tableSnap.data();

        // Fetch active tabs for this table
        const tabsSnap = await businessInfo.collection('dineInTabs')
            .where('tableId', '==', tableId)
            .where('status', '==', 'active')
            .get();

        const activeTabs = tabsSnap.docs.map(doc => doc.data());

        // Calculate current pax from ALL active tabs, not just one.
        const current_pax = activeTabs.reduce((sum, tab) => sum + (tab.pax_count || 0), 0);

        return NextResponse.json({
            tableId: tableId,
            max_capacity: tableData.max_capacity,
            current_pax,
            activeTabs,
            // Determine state based on the calculated pax count.
            state: current_pax >= tableData.max_capacity ? 'full' : (current_pax > 0 ? 'occupied' : 'available')
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
                    status: 'active',
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
