
'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    console.log("[API dine-in-tables] Step 1: Verifying owner token.");

    let finalUserId;
    let isAdminImpersonating = false;

    // Try to get UID from token for authenticated requests (like from the dashboard)
    try {
        const uid = await verifyAndGetUid(req);
        finalUserId = uid;
        console.log(`[API dine-in-tables] Step 2: Owner/Admin UID Verified: ${uid}`);

        const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
        const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
        
        const userDoc = await firestore.collection('users').doc(uid).get();

        if (userDoc.exists && userDoc.data().role === 'admin' && impersonatedOwnerId) {
            finalUserId = impersonatedOwnerId;
            isAdminImpersonating = true;
            console.log(`[API dine-in-tables] Admin impersonation for owner ID: ${finalUserId}`);
        } else if (!userDoc.exists || (userDoc.data().role !== 'owner' && userDoc.data().role !== 'restaurant-owner' && userDoc.data().role !== 'shop-owner')) {
             throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
        }

    } catch (error) {
        // If token verification fails, it might be an unauthenticated customer request.
        // We'll proceed without a UID and rely on other data for POST requests.
        console.log("[API dine-in-tables] Step 2: No valid token found. Assuming unauthenticated customer request for POST.");
        finalUserId = null;
    }
    
    console.log(`[API dine-in-tables] Step 3: Searching for business for owner: ${finalUserId}`);
    
    if (finalUserId) {
        const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', finalUserId).limit(1).get();
        if (!restaurantsQuery.empty) {
            console.log("[API dine-in-tables] Found business in 'restaurants' collection.");
            return restaurantsQuery.docs[0].ref;
        }

        const shopsQuery = await firestore.collection('shops').where('ownerId', '==', finalUserId).limit(1).get();
        if (!shopsQuery.empty) {
            console.log("[API dine-in-tables] Found business in 'shops' collection.");
            return shopsQuery.docs[0].ref;
        }
    }
    
    // For GET requests, if we haven't found a business by now, it's an error.
    // For POST, we might not have a user ID, so we can't search this way.
    if (req.method === 'GET') {
      throw { message: 'No business associated with this owner.', status: 404 };
    }
    
    // For POST, we return null and let the POST handler find the business by ID.
    return null;
}


export async function GET(req) {
    console.log("[API dine-in-tables] GET request received.");
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        console.log(`[API dine-in-tables] Step 4: Business Ref obtained: ${businessRef.path}`);
        
        const [tablesSnap, tabsSnap, serviceRequestsSnap] = await Promise.all([
            businessRef.collection('tables').orderBy('createdAt', 'asc').get(),
            businessRef.collection('dineInTabs').where('status', '==', 'active').get(),
            businessRef.collection('serviceRequests').where('status', '==', 'pending').orderBy('createdAt', 'desc').get(),
        ]);
        console.log(`[API dine-in-tables] Step 5: Fetched initial data. Tables: ${tablesSnap.size}, Active Tabs: ${tabsSnap.size}, Service Requests: ${serviceRequestsSnap.size}`);
        
        const tablesData = {};
        for (const tableDoc of tablesSnap.docs) {
             tablesData[tableDoc.id] = { ...tableDoc.data(), id: tableDoc.id, tabs: [] };
        }

        for (const tabDoc of tabsSnap.docs) {
            const tabData = { id: tabDoc.id, ...tabDoc.data(), orders: [], allItems: [], totalBill: 0, latestOrderTime: null };
            const tableId = tabData.tableId;
            
            if (tablesData[tableId]) {
                 const ordersSnap = await businessRef.firestore.collection('orders')
                    .where('dineInTabId', '==', tabDoc.id)
                    .where('status', '!=', 'delivered')
                    .where('status', '!=', 'rejected')
                    .get();

                if (!ordersSnap.empty) {
                    const itemMap = new Map();
                    ordersSnap.docs.forEach(orderDoc => {
                        const order = { id: orderDoc.id, ...orderDoc.data() };
                        tabData.orders.push(order);
                        tabData.totalBill += order.totalAmount || 0;
                        
                        const orderDate = order.orderDate?.toDate ? order.orderDate.toDate() : new Date(order.orderDate);
                        if(!tabData.latestOrderTime || orderDate > tabData.latestOrderTime) {
                            tabData.latestOrderTime = orderDate;
                        }
                        
                        (order.items || []).forEach(item => {
                            const uniqueItemId = `${order.id}-${item.name}`;
                            const existing = itemMap.get(item.name);
                            if(existing) {
                                itemMap.set(item.name, {...existing, qty: existing.qty + (item.quantity || 1), orderItemIds: [...existing.orderItemIds, uniqueItemId]});
                            } else {
                                itemMap.set(item.name, {...item, qty: (item.quantity || 1), orderItemIds: [uniqueItemId]});
                            }
                        });
                    });
                    tabData.allItems = Array.from(itemMap.values());
                }
                tablesData[tableId].tabs.push(tabData);
            }
        }
        
        const tables = Object.values(tablesData);
        console.log("[API dine-in-tables] Step 6: Processed tables with their live data.");

        const serviceRequests = serviceRequestsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
            };
        });
        
        const finalResponse = { tables, activeTabs: [], serviceRequests }; // activeTabs is deprecated but kept for safety
        console.log("[API dine-in-tables] Step 7: Sending final JSON response to client:", JSON.stringify(finalResponse, null, 2));

        return NextResponse.json(finalResponse, { status: 200 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL GET ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

// --- START FIX: NEW POST FUNCTION ---
export async function POST(req) {
    console.log("[API dine-in-tables] POST request received to create tab/table.");
    const body = await req.json();
    const firestore = getFirestore();

    // Differentiate between creating a tab and creating a table
    if (body.action === 'create_tab') {
        console.log("[API dine-in-tables] Action: create_tab. Payload:", body);
        const { tableId, pax_count, tab_name, restaurantId } = body;
        
        if (!restaurantId) {
            return NextResponse.json({ message: 'Restaurant ID is required.'}, { status: 400 });
        }
        if (!tableId || !pax_count || !tab_name) {
            return NextResponse.json({ message: 'Table ID, pax count, and tab name are required.' }, { status: 400 });
        }

        // --- THE FIX: Find business by ID, not by owner token ---
        let businessRef = firestore.collection('restaurants').doc(restaurantId);
        let businessSnap = await businessRef.get();
        if (!businessSnap.exists) {
            businessRef = firestore.collection('shops').doc(restaurantId);
            businessSnap = await businessRef.get();
            if (!businessSnap.exists) {
                return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
            }
        }

        const tableRef = businessRef.collection('tables').doc(tableId);
        const newTabRef = businessRef.collection('dineInTabs').doc();

        try {
            await firestore.runTransaction(async (transaction) => {
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) {
                    throw new Error("Table not found.");
                }
                const tableData = tableDoc.data();
                const availableCapacity = tableData.max_capacity - (tableData.current_pax || 0);
                if (pax_count > availableCapacity) {
                    throw new Error(`Capacity exceeded. Only ${availableCapacity} seats available.`);
                }

                transaction.set(newTabRef, {
                    id: newTabRef.id,
                    tableId: tableId,
                    status: 'active',
                    tab_name: tab_name,
                    pax_count: Number(pax_count),
                    createdAt: FieldValue.serverTimestamp(),
                });

                transaction.update(tableRef, {
                    current_pax: FieldValue.increment(Number(pax_count)),
                    state: 'occupied'
                });
            });
            console.log(`[API dine-in-tables] Successfully created tab ${newTabRef.id} for table ${tableId}.`);
            return NextResponse.json({ message: 'Tab created successfully!', tabId: newTabRef.id }, { status: 201 });
        } catch(error) {
            console.error("[API dine-in-tables] CRITICAL Transaction Error (create_tab):", error);
            // The custom error message from the transaction will be passed here.
            return NextResponse.json({ message: error.message }, { status: 400 });
        }
    }

    // Existing logic for creating/updating a table (requires authenticated owner)
    const businessRef = await verifyOwnerAndGetBusinessRef(req);
    if (!businessRef) {
        return NextResponse.json({ message: 'Authentication required to manage tables.' }, { status: 403 });
    }
    console.log("[API dine-in-tables] Action: create_or_update_table. Payload:", body);
    const { tableId, max_capacity } = body;
    if (!tableId || !max_capacity || max_capacity < 1) {
        return NextResponse.json({ message: 'Table ID and a valid capacity are required.' }, { status: 400 });
    }
    const tableRef = businessRef.collection('tables').doc(tableId);
    await tableRef.set({
        id: tableId,
        max_capacity: Number(max_capacity),
        current_pax: 0,
        createdAt: FieldValue.serverTimestamp(),
        state: 'available'
    }, { merge: true });
    
    console.log(`[API dine-in-tables] Successfully saved table ${tableId}.`);
    return NextResponse.json({ message: 'Table saved successfully.' }, { status: 201 });
}
// --- END FIX ---


export async function PATCH(req) {
    console.log("[API dine-in-tables] PATCH request received for table action.");
     try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const { tableId, action, tabIdToClose, newTableId, newCapacity, paymentMethod } = await req.json();
        console.log("[API dine-in-tables] PATCH Payload:", { tableId, action, tabIdToClose, newTableId, newCapacity, paymentMethod });
        
        if (action) {
            if (!tableId) {
                return NextResponse.json({ message: 'Table ID is required for actions.' }, { status: 400 });
            }
            const validActions = ['mark_paid', 'mark_cleaned'];
            if (!validActions.includes(action)) {
                return NextResponse.json({ message: 'Invalid action provided.' }, { status: 400 });
            }
            
            const tableRef = businessRef.collection('tables').doc(tableId);
            const firestore = businessRef.firestore;

            if (action === 'mark_paid') {
                if (!tabIdToClose) {
                    return NextResponse.json({ message: 'Tab ID is required to mark a tab as paid.' }, { status: 400 });
                }
                
                await firestore.runTransaction(async (transaction) => {
                    console.log(`[API dine-in-tables] Starting transaction to close tab ${tabIdToClose}.`);
                    const tabRef = businessRef.collection('dineInTabs').doc(tabIdToClose);
                    const tabDoc = await transaction.get(tabRef);
                    if (!tabDoc.exists) throw new Error("Tab to be closed not found.");
                    
                    const tableDoc = await transaction.get(tableRef);
                    if (!tableDoc.exists) throw new Error("Table document not found.");

                    const ordersQuery = firestore.collection('orders').where('dineInTabId', '==', tabIdToClose);
                    const ordersSnap = await transaction.get(ordersQuery);
                    ordersSnap.forEach(orderDoc => {
                        transaction.update(orderDoc.ref, { 
                            status: 'delivered', 
                            paymentDetails: { ...orderDoc.data().paymentDetails, method: paymentMethod || 'cod' }
                        });
                    });

                    transaction.update(tabRef, { status: 'closed', closedAt: FieldValue.serverTimestamp(), paymentMethod: paymentMethod || 'cod' });
                    transaction.update(tableRef, { state: 'needs_cleaning' });
                    console.log(`[API dine-in-tables] Transaction successful. Tab closed, table needs cleaning.`);
                });
                return NextResponse.json({ message: `Table ${tableId} marked as needing cleaning.` }, { status: 200 });
            }
            
            if (action === 'mark_cleaned') {
                 await tableRef.update({ state: 'available', current_pax: 0 });
                 console.log(`[API dine-in-tables] Table ${tableId} marked as cleaned and available.`);
                 return NextResponse.json({ message: `Table ${tableId} cleaning acknowledged.` }, { status: 200 });
            }
        }

        if (newTableId !== undefined || newCapacity !== undefined) {
            if (!tableId) {
                return NextResponse.json({ message: 'Original Table ID is required for editing.' }, { status: 400 });
            }
            const oldTableRef = businessRef.collection('tables').doc(tableId);
            const tableSnap = await oldTableRef.get();
            if(!tableSnap.exists) {
                return NextResponse.json({ message: 'Table to edit not found.' }, { status: 404 });
            }
            
            const updateData = {};
            if (newCapacity !== undefined) {
                updateData.max_capacity = Number(newCapacity);
            }

            if (newTableId && newTableId !== tableId) {
                console.log(`[API dine-in-tables] Renaming table ${tableId} to ${newTableId}.`);
                const newTableRef = businessRef.collection('tables').doc(newTableId);
                const tableData = tableSnap.data();
                await newTableRef.set({ ...tableData, ...updateData, id: newTableId });
                await oldTableRef.delete();
                return NextResponse.json({ message: `Table renamed to ${newTableId} and updated.` }, { status: 200 });
            } else {
                 console.log(`[API dine-in-tables] Updating capacity for table ${tableId}.`);
                 await oldTableRef.update(updateData);
                 return NextResponse.json({ message: `Table ${tableId} updated.` }, { status: 200 });
            }
        }
        
        return NextResponse.json({ message: 'No valid action or edit data provided.' }, { status: 400 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL PATCH ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function DELETE(req) {
    console.log("[API dine-in-tables] DELETE request received.");
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const { tableId } = await req.json();
        console.log(`[API dine-in-tables] Payload: tableId=${tableId}`);

        if (!tableId) {
            return NextResponse.json({ message: 'Table ID is required.' }, { status: 400 });
        }

        const tableRef = businessRef.collection('tables').doc(tableId);
        await tableRef.delete();
        console.log(`[API dine-in-tables] Deleted table ${tableId}.`);

        return NextResponse.json({ message: 'Table deleted successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL DELETE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
