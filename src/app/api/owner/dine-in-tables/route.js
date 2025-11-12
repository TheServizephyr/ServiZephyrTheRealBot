
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

async function getBusinessRef(req, body = null) {
    const firestore = await getFirestore();
    let finalUserId = null;
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    console.log("[API dine-in-tables] getBusinessRef: Starting verification.");

    // This block handles authenticated users (owners or impersonating admins)
    try {
        const uid = await verifyAndGetUid(req);
        finalUserId = uid;
        const userDoc = await firestore.collection('users').doc(uid).get();

        if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
            finalUserId = impersonatedOwnerId;
            console.log(`[API dine-in-tables] getBusinessRef: Admin impersonation. Target UID: ${finalUserId}`);
        } else if (!userDoc.exists || !['owner', 'restaurant-owner', 'shop-owner', 'admin'].includes(userDoc.data().role)) {
             throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
        }
    } catch (error) {
        // If auth fails, we only proceed if it's a create_tab action, which is unauthenticated.
        if (req.method === 'POST' && body?.action === 'create_tab') {
            console.log("[API dine-in-tables] getBusinessRef: Unauthenticated but valid 'create_tab' action. Proceeding without user ID.");
            finalUserId = null; // Explicitly set to null for clarity
        } else {
            // For any other case (GET, PATCH, DELETE, or POST without create_tab), re-throw the auth error.
            console.error("[API dine-in-tables] getBusinessRef: Authentication error and not a valid unauthenticated action. Throwing error.");
            throw error;
        }
    }
    
    // If we have a user ID (either original or impersonated), find their business.
    if (finalUserId) {
        console.log(`[API dine-in-tables] getBusinessRef: Searching business for owner UID: ${finalUserId}`);
        const collectionsToTry = ['restaurants', 'shops'];
        for (const collection of collectionsToTry) {
            const query = await firestore.collection(collection).where('ownerId', '==', finalUserId).limit(1).get();
            if (!query.empty) {
                console.log(`[API dine-in-tables] getBusinessRef: Found business in '${collection}'.`);
                return query.docs[0].ref;
            }
        }
    }
    
    // This block handles the unauthenticated 'create_tab' action by looking up the business by ID.
    if (req.method === 'POST' && body?.action === 'create_tab' && body?.restaurantId) {
         console.log(`[API dine-in-tables] getBusinessRef: Searching for business by ID for create_tab: ${body.restaurantId}`);
         const collectionsToTry = ['restaurants', 'shops'];
         for (const collection of collectionsToTry) {
            const businessRef = firestore.collection(collection).doc(body.restaurantId);
            const businessSnap = await businessRef.get();
            if (businessSnap.exists) {
                console.log(`[API dine-in-tables] getBusinessRef: Found business by ID in '${collection}'.`);
                return businessRef;
            }
         }
         console.error(`[API dine-in-tables] getBusinessRef: Business not found for ID: ${body.restaurantId}`);
         return null; // Business not found
    }
    
    // If no business could be found by any method, throw an error.
    console.error(`[API dine-in-tables] getBusinessRef: Could not associate request with any business.`);
    throw { message: 'No business associated with this request.', status: 404 };
}


export async function GET(req) {
    const firestore = await getFirestore();
    try {
        const businessRef = await getBusinessRef(req);
        if (!businessRef) throw { message: 'Business reference not found.', status: 404 };
        console.log(`[API dine-in-tables] GET: Business ref found: ${businessRef.path}`);

        const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
        console.log(`[API dine-in-tables] GET: Fetched ${tablesSnap.size} tables.`);
        
        const activeTabIds = [];
        tablesSnap.docs.forEach(doc => {
            const tableData = doc.data();
            if (tableData.tabs) {
                Object.keys(tableData.tabs).forEach(tabId => {
                    if (tableData.tabs[tabId].status === 'active') {
                        activeTabIds.push(tabId);
                    }
                });
            }
        });
        console.log(`[API dine-in-tables] GET: Found ${activeTabIds.length} active tab IDs.`);


        const ordersByTab = {};
        if (activeTabIds.length > 0) {
            // Firestore 'in' queries are limited to 30 items. If more tabs, we'd need to chunk this.
            const ordersSnap = await firestore.collection('orders')
                .where('restaurantId', '==', businessRef.id)
                .where('dineInTabId', 'in', activeTabIds)
                .get();

            ordersSnap.forEach(doc => {
                const order = doc.data();
                if (order.dineInTabId) {
                    if (!ordersByTab[order.dineInTabId]) {
                        ordersByTab[order.dineInTabId] = [];
                    }
                    ordersByTab[order.dineInTabId].push({ id: doc.id, ...order });
                }
            });
        }


        const tablesData = tablesSnap.docs.map(tableDoc => {
            const table = tableDoc.data();
            const activeTabs = table.tabs || {};
            const processedTabs = Object.values(activeTabs).map(tab => {
                const tabOrders = ordersByTab[tab.id] || [];
                
                const latestOrder = tabOrders.length > 0 
                    ? tabOrders.reduce((latest, o) => {
                        const latestDate = latest.orderDate?.toDate ? latest.orderDate.toDate() : new Date(latest.orderDate);
                        const oDate = o.orderDate?.toDate ? o.orderDate.toDate() : new Date(o.orderDate);
                        return oDate > latestDate ? o : latest;
                    })
                    : null;
                const latestOrderTime = latestOrder?.orderDate || null;


                const totalBill = tabOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
                
                const allItems = tabOrders.flatMap(o => o.items || []);
                const itemMap = new Map();
                allItems.forEach(item => {
                    const uniqueItemKey = `${item.name}-${item.portion?.name || ''}`;
                    const existing = itemMap.get(uniqueItemKey);
                    if (existing) {
                        itemMap.set(uniqueItemKey, { ...existing, qty: existing.qty + (item.quantity || 1), orderItemIds: [...existing.orderItemIds, item.cartItemId] });
                    } else {
                        itemMap.set(uniqueItemKey, { ...item, qty: item.quantity || 1, orderItemIds: [item.cartItemId] });
                    }
                });


                return { ...tab, orders: tabOrders, totalBill, latestOrderTime, allItems: Array.from(itemMap.values()) };
            });
            return { ...table, id: tableDoc.id, tabs: processedTabs };
        });

        const serviceRequestsSnap = await businessRef.collection('serviceRequests').where('status', '==', 'pending').orderBy('createdAt', 'desc').get();
        console.log(`[API dine-in-tables] GET: Fetched ${serviceRequestsSnap.size} pending service requests.`);
        const serviceRequests = serviceRequestsSnap.docs.map(doc => ({ ...doc.data(), createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate().toISOString() : new Date().toISOString() }));

        const thirtyDaysAgo = subDays(new Date(), 30);
        const closedTabsQuery = businessRef.collection('tables').where('lastClosedAt', '>=', thirtyDaysAgo);

        const closedTabsSnap = await closedTabsQuery.get();
        
        let closedTabs = [];
        closedTabsSnap.forEach(doc => {
            const tableData = doc.data();
            if(tableData.closedTabs) {
                Object.values(tableData.closedTabs).forEach(tab => {
                    const closedAtDate = tab.closedAt?.toDate ? tab.closedAt.toDate() : new Date(tab.closedAt);
                    if (isAfter(closedAtDate, thirtyDaysAgo)) {
                         closedTabs.push({ ...tab, closedAt: closedAtDate.toISOString() });
                    }
                })
            }
        });
        closedTabs.sort((a,b) => new Date(b.closedAt) - new Date(a.closedAt));
        console.log(`[API dine-in-tables] GET: Fetched ${closedTabs.length} closed tabs from the last 30 days.`);

        console.log("[API dine-in-tables] GET: Request successful. Sending response.");
        return NextResponse.json({ tables: tablesData, serviceRequests, closedTabs }, { status: 200 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL GET ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    // Read the body ONCE and pass it to helpers that need it.
    const body = await req.json();
    const firestore = await getFirestore();

    // Action to create a new tab for a table
    if (body.action === 'create_tab') {
        console.log("[API dine-in-tables] POST request received with action: create_tab");
        const { tableId, pax_count, tab_name, restaurantId } = body;
        if (!restaurantId || !tableId || !pax_count || !tab_name) {
            return NextResponse.json({ message: 'Table ID, pax count, and tab name are required.' }, { status: 400 });
        }

        const businessRef = await getBusinessRef(req, body);
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
                const currentPaxInTabs = Object.values(tableData.tabs || {}).reduce((sum, tab) => sum + (tab.pax_count || 0), 0);
                const availableCapacity = tableData.max_capacity - currentPaxInTabs;

                if (pax_count > availableCapacity) {
                    throw new Error(`Capacity exceeded. Only ${availableCapacity} seats available.`);
                }
                
                const newTabData = { 
                    id: newTabId, 
                    tableId, 
                    restaurantId, 
                    status: 'active', 
                    tab_name, 
                    pax_count: Number(pax_count), 
                    createdAt: FieldValue.serverTimestamp(),
                    totalBill: 0,
                    orders: []
                };
                
                const updatePayload = {
                    [`tabs.${newTabId}`]: newTabData,
                    current_pax: FieldValue.increment(Number(pax_count)),
                    state: 'occupied'
                };
                
                transaction.update(tableRef, updatePayload);
            });
            console.log(`[API dine-in-tables] Successfully created tab ${newTabId}`);
            return NextResponse.json({ message: 'Tab created successfully!', tabId: newTabId }, { status: 201 });
        } catch(error) {
            console.error("[API dine-in-tables] CRITICAL Transaction Error (create_tab):", error);
            return NextResponse.json({ message: error.message }, { status: 400 });
        }
    }

    // Default action: Create a new table
    console.log("[API dine-in-tables] POST request received to create/update table.");
    const businessRef = await getBusinessRef(req, body);
    if (!businessRef) return NextResponse.json({ message: 'Authentication required to manage tables.' }, { status: 403 });
    const { tableId, max_capacity } = body;
    if (!tableId || !max_capacity || max_capacity < 1) return NextResponse.json({ message: 'Table ID and a valid capacity are required.' }, { status: 400 });
    const tableRef = businessRef.collection('tables').doc(tableId);
    await tableRef.set({ id: tableId, max_capacity: Number(max_capacity), current_pax: 0, createdAt: FieldValue.serverTimestamp(), state: 'available', tabs: {} }, { merge: true });
    
    return NextResponse.json({ message: 'Table saved successfully.' }, { status: 201 });
}

export async function PATCH(req) {
    const firestore = await getFirestore();
     try {
        const body = await req.json();
        const businessRef = await getBusinessRef(req, body);
        const { tableId, action, tabId, newTableId, newCapacity, paymentMethod, paxCount } = body;
        
        const tableRef = businessRef.collection('tables').doc(tableId);

        if (action === 'clear_tab') {
            if (!tabId || !tableId) return NextResponse.json({ message: 'Tab ID and Table ID are required to clear a tab.' }, { status: 400 });
            
            await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error("Table not found.");
                const tableData = tableDoc.data();
                const tabToClear = tableData.tabs?.[tabId];
                if (!tabToClear) {
                    return; 
                }
                
                const currentPax = tableData.current_pax || 0;
                const tabPax = tabToClear.pax_count || paxCount || 0;
                const newPax = Math.max(0, currentPax - tabPax);
                
                const updatePayload = {
                    [`tabs.${tabId}`]: FieldValue.delete(),
                    current_pax: newPax,
                    state: newPax > 0 ? 'occupied' : 'available'
                };
                transaction.update(tableRef, updatePayload);
            });
            return new NextResponse(null, { status: 204 });
        }


        if (action === 'mark_paid') {
            if (!tableId || !tabId) return NextResponse.json({ message: 'Table and Tab ID are required.' }, { status: 400 });

            await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error("Table not found.");
                const tableData = tableDoc.data();
                const tabToClose = tableData.tabs?.[tabId];
                if (!tabToClose) throw new Error("Tab to close not found.");

                const ordersQuery = firestore.collection('orders').where('dineInTabId', '==', tabId);
                const ordersSnap = await transaction.get(ordersQuery);
                ordersSnap.forEach(orderDoc => {
                    transaction.update(orderDoc.ref, { 
                        status: 'delivered', 
                        paymentDetails: { ...(orderDoc.data().paymentDetails || {}), method: paymentMethod || 'cod' }
                    });
                });
                
                const tabPax = tabToClose.pax_count || 0;
                
                const closedTabInfo = {
                  ...tabToClose,
                  status: 'closed',
                  closedAt: FieldValue.serverTimestamp(),
                  paymentMethod: paymentMethod || 'cod'
                };

                const updatePayload = {
                    [`tabs.${tabId}`]: FieldValue.delete(),
                    [`closedTabs.${tabId}`]: closedTabInfo,
                    current_pax: FieldValue.increment(-tabPax),
                    state: 'needs_cleaning',
                    lastClosedAt: FieldValue.serverTimestamp()
                };
                transaction.update(tableRef, updatePayload);
            });
            return NextResponse.json({ message: `Table ${tableId} marked as needing cleaning.` }, { status: 200 });
        }
        
        if (action === 'mark_cleaned') {
            await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error("Table not found.");
                const tableData = tableDoc.data();
                
                const newPax = Object.values(tableData.tabs || {}).reduce((sum, tab) => sum + tab.pax_count, 0);
                const newState = newPax > 0 ? 'occupied' : 'available';

                transaction.update(tableRef, { state: newState, current_pax: newPax });
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
    try {
        const body = await req.json();
        const businessRef = await getBusinessRef(req, body);
        const { tableId } = body;
        if (!tableId) return NextResponse.json({ message: 'Table ID is required.' }, { status: 400 });
        const tableRef = businessRef.collection('tables').doc(tableId);
        await tableRef.delete();
        return NextResponse.json({ message: 'Table deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL DELETE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
