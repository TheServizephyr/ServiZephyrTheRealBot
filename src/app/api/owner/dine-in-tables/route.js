

'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

async function getBusinessRef(req) {
    const firestore = await getFirestore();
    let finalUserId;
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    try {
        const uid = await verifyAndGetUid(req);
        finalUserId = uid;
        const userDoc = await firestore.collection('users').doc(uid).get();

        if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
            finalUserId = impersonatedOwnerId;
        } else if (req.method === 'POST' && !userDoc.exists) {
            // Allow unauthenticated POST only for create_tab action
            const body = await req.clone().json();
            if (body.action !== 'create_tab') {
                throw { message: 'Authentication required for this action.', status: 403 };
            }
            finalUserId = null;
        } else if (!userDoc.exists || !['owner', 'restaurant-owner', 'shop-owner', 'admin'].includes(userDoc.data().role)) {
             throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
        }
    } catch (error) {
        if (req.method === 'POST') {
             try {
                const body = await req.clone().json();
                if (body.action === 'create_tab') {
                    finalUserId = null;
                } else {
                    throw { message: 'Authentication required for this action.', status: 403 };
                }
             } catch (e) {
                 throw { message: 'Invalid request body.', status: 400 };
             }
        } else {
            throw error;
        }
    }
    
    if (finalUserId) {
        const collectionsToTry = ['restaurants', 'shops'];
        for (const collection of collectionsToTry) {
            const query = await firestore.collection(collection).where('ownerId', '==', finalUserId).limit(1).get();
            if (!query.empty) {
                return query.docs[0].ref;
            }
        }
    }
    
    // For unauthenticated tab creation, find business by ID
    if (req.method === 'POST') {
         const body = await req.clone().json();
         if (body.action === 'create_tab' && body.restaurantId) {
             const collectionsToTry = ['restaurants', 'shops'];
             for (const collection of collectionsToTry) {
                const businessRef = firestore.collection(collection).doc(body.restaurantId);
                const businessSnap = await businessRef.get();
                if (businessSnap.exists) return businessRef;
             }
             return null; // Business not found
         }
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    const firestore = await getFirestore();
    try {
        const businessRef = await getBusinessRef(req);
        if (!businessRef) throw { message: 'Business reference not found.', status: 404 };

        const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
        
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
                    const uniqueItemId = item.cartItemId || `${item.id}-${item.portion?.name}`;
                    const existing = itemMap.get(item.name);
                    if (existing) {
                        itemMap.set(item.name, { ...existing, qty: existing.qty + item.quantity });
                    } else {
                        itemMap.set(item.name, { ...item, qty: item.quantity });
                    }
                });


                return { ...tab, orders: tabOrders, totalBill, latestOrderTime, allItems: Array.from(itemMap.values()) };
            });
            return { ...table, id: tableDoc.id, tabs: processedTabs };
        });

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


        return NextResponse.json({ tables: tablesData, serviceRequests, closedTabs }, { status: 200 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL GET ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    const body = await req.json();
    const firestore = await getFirestore();

    // Action to create a new tab for a table
    if (body.action === 'create_tab') {
        const { tableId, pax_count, tab_name, restaurantId } = body;
        if (!restaurantId || !tableId || !pax_count || !tab_name) {
            return NextResponse.json({ message: 'Table ID, pax count, and tab name are required.' }, { status: 400 });
        }

        const businessRef = await getBusinessRef(req);
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
            // --- THE FIX ---
            return NextResponse.json({ message: 'Tab created successfully!', tabId: newTabId }, { status: 201 });
        } catch(error) {
            console.error("[API dine-in-tables] CRITICAL Transaction Error (create_tab):", error);
            return NextResponse.json({ message: error.message }, { status: 400 });
        }
    }

    // Default action: Create a new table
    const businessRef = await getBusinessRef(req);
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
                if (!tabToClear) return; // Already cleared, no-op
                
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



    