
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

async function getBusinessRef(req) {
    const firestore = await getFirestore();
    // For POST requests for creating a tab, auth is not required.
    if (req.method === 'POST') {
         // The POST handler will be responsible for finding the businessRef.
         return null; 
    }

    // All other requests (GET, PATCH, DELETE) MUST be authenticated.
    const uid = await verifyAndGetUid(req);
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    let finalUserId = uid;

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    } else if (!userDoc.exists || !['owner', 'restaurant-owner', 'shop-owner', 'admin'].includes(userDoc.data().role)) {
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

        // 1. Fetch all tables to get their structure (capacity, etc.)
        const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
        const tablesData = tablesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const tableMap = new Map(tablesData.map(t => [t.id, { ...t, tabs: {}, pendingOrders: [] }]));

        // 2. Fetch all relevant dine-in orders (pending AND active)
        const ordersQuery = firestore.collection('orders')
            .where('restaurantId', '==', businessRef.id)
            .where('deliveryType', '==', 'dine-in')
            .where('status', 'in', ['pending', 'confirmed', 'preparing', 'ready_for_pickup']);
            
        const ordersSnap = await ordersQuery.get();

        // 3. Process and group orders by table and tab
        ordersSnap.forEach(orderDoc => {
            const orderData = orderDoc.data();
            const tableId = orderData.tableId;
            const tabId = orderData.dineInTabId;
            
            const table = tableMap.get(tableId);
            if (!table) return; // Skip if order is for a non-existent table

            if (orderData.status === 'pending') {
                 table.pendingOrders.push({ id: orderDoc.id, ...orderData });
            } else if (tabId) {
                if (!table.tabs[tabId]) {
                    // This is the first time we're seeing this active tab, create it.
                    table.tabs[tabId] = {
                        id: tabId,
                        tableId: tableId,
                        tab_name: orderData.tab_name || 'Guest',
                        pax_count: orderData.pax_count || 1,
                        createdAt: orderData.orderDate,
                        status: 'active',
                        orders: {},
                    };
                }
                // Add the order to its tab
                table.tabs[tabId].orders[orderDoc.id] = { id: orderDoc.id, ...orderData };
            }
        });
        
        const finalTablesData = Array.from(tableMap.values());

        // --- Fetch other data as before ---
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
    const body = await req.json(); // Read the body once

    try {
        // This block handles the special unauthenticated 'create_tab' action
        if (body.action === 'create_tab' && body.restaurantId) {
            const { tableId, pax_count, tab_name, restaurantId } = body;
            if (!tableId || !pax_count || !tab_name) {
                return NextResponse.json({ message: 'Table ID, pax count, and tab name are required.' }, { status: 400 });
            }
            
            const businessRef = firestore.collection('restaurants').doc(restaurantId);
            const tableRef = businessRef.collection('tables').doc(tableId);
            const newTabId = `tab_${Date.now()}`;

            try {
                await firestore.runTransaction(async (transaction) => {
                    const tableDoc = await transaction.get(tableRef);
                    if (!tableDoc.exists) throw new Error("Table not found.");
                    
                    const tableData = tableDoc.data();
                    const currentPaxInTabs = Object.values(tableData.tabs || {}).reduce((sum, tab) => sum + (tab.pax_count || 0), 0);
                    const availableCapacity = tableData.max_capacity - currentPaxInTabs;

                    if (pax_count > availableCapacity) {
                        throw new Error(`Capacity exceeded. Only ${availableCapacity} seats available.`);
                    }
                    
                    // Create an empty tab in the table's subcollection
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
                    };
                    transaction.set(newTabRef, newTabData);
                    
                    transaction.update(tableRef, {
                        current_pax: FieldValue.increment(Number(pax_count)),
                        state: 'occupied'
                    });
                });
                return NextResponse.json({ message: 'Tab created successfully!', tabId: newTabId }, { status: 201 });
            } catch(txError) {
                console.error("[API dine-in-tables] CRITICAL Transaction Error (create_tab):", txError);
                return NextResponse.json({ message: txError.message }, { status: 400 });
            }
        }
        
        // Authenticated POST for creating/updating a table
        const businessRef = await getBusinessRef(req);
        if (!businessRef) return NextResponse.json({ message: 'Business not found or authentication failed.', status: 404 });
        
        const { tableId, max_capacity } = body;
        if (!tableId || !max_capacity || max_capacity < 1) return NextResponse.json({ message: 'Table ID and a valid capacity are required.' }, { status: 400 });
        const tableRef = businessRef.collection('tables').doc(tableId);
        await tableRef.set({ id: tableId, max_capacity: Number(max_capacity), current_pax: 0, createdAt: FieldValue.serverTimestamp(), state: 'available' }, { merge: true });
        
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
        const { tableId, action, tabId, paymentMethod, paxCount } = await req.json();
        
        const tableRef = businessRef.collection('tables').doc(tableId);

        if (action === 'clear_tab') {
            if (!tabId || !tableId) return NextResponse.json({ message: 'Tab ID and Table ID are required to clear a tab.' }, { status: 400 });
            
            await firestore.runTransaction(async (transaction) => {
                const tabRef = businessRef.collection('dineInTabs').doc(tabId);
                const tableDoc = await transaction.get(tableRef);
                const tabDoc = await transaction.get(tabRef);

                if (tableDoc.exists) {
                    const tabPax = tabDoc.exists() ? (tabDoc.data().pax_count || 0) : (paxCount || 0);
                    const newPax = Math.max(0, (tableDoc.data().current_pax || 0) - tabPax);
                    transaction.update(tableRef, {
                        current_pax: newPax,
                        state: newPax > 0 ? 'occupied' : 'available'
                    });
                }

                if(tabDoc.exists) {
                    transaction.delete(tabRef);
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
                
                const ordersQuery = firestore.collection('orders').where('dineInTabId', '==', tabId);
                const ordersSnap = await transaction.get(ordersQuery);

                ordersSnap.forEach(orderDoc => {
                    transaction.update(orderDoc.ref, {
                        status: 'delivered', 
                        paymentDetails: { ...(orderDoc.data().paymentDetails || {}), method: paymentMethod || 'cod' }
                    });
                });
                
                const tabData = tabDoc.data();
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

    