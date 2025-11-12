

'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

async function getBusinessRef(req) {
    const firestore = await getFirestore();
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    console.log("[API dine-in-tables] getBusinessRef: Starting verification.");
    
    // For POST requests for creating a tab, auth is not required.
    // We check the body for a restaurantId instead.
    if (req.method === 'POST') {
         // Because req.json() consumes the body, we can't call it here and in the POST handler.
         // The POST handler will be responsible for finding the businessRef for this specific action.
         return null; 
    }

    // All other requests (GET, PATCH, DELETE) MUST be authenticated.
    const uid = await verifyAndGetUid(req);
    let finalUserId = uid;

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
        console.log(`[API dine-in-tables] getBusinessRef: Admin impersonation. Target UID: ${finalUserId}`);
    } else if (!userDoc.exists || !['owner', 'restaurant-owner', 'shop-owner', 'admin'].includes(userDoc.data().role)) {
         throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }
    
    console.log(`[API dine-in-tables] getBusinessRef: Searching business for owner UID: ${finalUserId}`);
    const collectionsToTry = ['restaurants', 'shops'];
    for (const collection of collectionsToTry) {
        const query = await firestore.collection(collection).where('ownerId', '==', finalUserId).limit(1).get();
        if (!query.empty) {
            console.log(`[API dine-in-tables] getBusinessRef: Found business in '${collection}'.`);
            return query.docs[0].ref;
        }
    }
    
    console.error(`[API dine-in-tables] getBusinessRef: Could not associate request with any business for UID ${finalUserId}.`);
    throw { message: 'No business associated with this request.', status: 404 };
}


export async function GET(req) {
    const firestore = await getFirestore();
    try {
        const businessRef = await getBusinessRef(req);
        if (!businessRef) throw { message: 'Business reference not found.', status: 404 };
        console.log(`[API dine-in-tables] GET: Business ref found: ${businessRef.path}`);

        // --- START: ONE-TIME DATA CLEANUP ---
        const thirtyDaysAgoForCleanup = subDays(new Date(), 30);
        const oldPendingOrdersQuery = firestore.collection('orders')
            .where('restaurantId', '==', businessRef.id)
            .where('deliveryType', '==', 'dine-in')
            .where('status', '==', 'pending')
            .where('orderDate', '<', thirtyDaysAgoForCleanup);
        const oldPendingOrdersSnap = await oldPendingOrdersQuery.get();
        if (!oldPendingOrdersSnap.empty) {
            console.log(`[API dine-in-tables] CLEANUP: Found ${oldPendingOrdersSnap.size} old, pending dine-in orders to delete.`);
            const deleteBatch = firestore.batch();
            oldPendingOrdersSnap.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();
            console.log(`[API dine-in-tables] CLEANUP: Successfully deleted old pending orders.`);
        }
        // --- END: ONE-TIME DATA CLEANUP ---

        const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
        console.log(`[API dine-in-tables] GET: Fetched ${tablesSnap.size} tables.`);
        
        let tablesData = tablesSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), pendingOrders: [] }));
        const tableMap = new Map(tablesData.map(t => [t.id, t]));

        // --- Fetch pending orders and associate them ---
        const pendingOrdersSnap = await firestore.collection('orders')
            .where('restaurantId', '==', businessRef.id)
            .where('deliveryType', '==', 'dine-in')
            .where('status', '==', 'pending')
            .get();
            
        console.log(`[API dine-in-tables] GET: Fetched ${pendingOrdersSnap.size} pending dine-in orders.`);

        pendingOrdersSnap.forEach(orderDoc => {
            const orderData = orderDoc.data();
            const tableId = orderData.tableId;
            
            const table = tableMap.get(tableId);

            if (table) {
                // Check if an active tab already corresponds to this pending order's tabId
                const isOrderInActiveTab = Object.values(table.tabs || {}).some(tab => 
                    (tab.orders || []).some(o => o.id === orderDoc.id)
                );

                if (!isOrderInActiveTab) {
                    table.pendingOrders.push({ id: orderDoc.id, ...orderData });
                }
            }
        });
        
        tablesData = Array.from(tableMap.values());

        const serviceRequestsSnap = await businessRef.collection('serviceRequests').where('status', '==', 'pending').orderBy('createdAt', 'desc').get();
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

        console.log("[API dine-in-tables] GET: Request successful. Sending response.");
        return NextResponse.json({ tables: tablesData, serviceRequests, closedTabs }, { status: 200 });

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
            console.log("[API dine-in-tables] POST request received with action: create_tab");
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
                    
                    const newTabData = { 
                        id: newTabId, 
                        tableId, 
                        restaurantId: businessRef.id, 
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
            } catch(txError) {
                console.error("[API dine-in-tables] CRITICAL Transaction Error (create_tab):", txError);
                return NextResponse.json({ message: txError.message }, { status: 400 });
            }
        }
        
        // Authenticated POST for creating/updating a table
        const businessRef = await getBusinessRef(req);
        if (!businessRef) return NextResponse.json({ message: 'Business not found or authentication failed.', status: 404 });
        
        console.log("[API dine-in-tables] POST request received to create/update table.");
        const { tableId, max_capacity } = body;
        if (!tableId || !max_capacity || max_capacity < 1) return NextResponse.json({ message: 'Table ID and a valid capacity are required.' }, { status: 400 });
        const tableRef = businessRef.collection('tables').doc(tableId);
        await tableRef.set({ id: tableId, max_capacity: Number(max_capacity), current_pax: 0, createdAt: FieldValue.serverTimestamp(), state: 'available', tabs: {} }, { merge: true });
        
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
        const { tableId, action, tabId, newTableId, newCapacity, paymentMethod, paxCount } = await req.json();
        
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

                // Assuming all orders in the tab are being marked as paid
                 Object.values(tabToClose.orders || {}).forEach(order => {
                    const orderRef = firestore.collection('orders').doc(order.id);
                    transaction.update(orderRef, { 
                        status: 'delivered', 
                        paymentDetails: { ...(order.paymentDetails || {}), method: paymentMethod || 'cod' }
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



    