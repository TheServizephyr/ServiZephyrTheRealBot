'use server';

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusinessRef(req) {
    const firestore = await getFirestore();
    console.log("[API dine-in-tables] Step 1: Verifying owner token.");
    const uid = await verifyAndGetUid(req); // Use central helper
    console.log(`[API dine-in-tables] Step 2: Owner UID Verified: ${uid}`);
    
    const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
        console.log(`[API dine-in-tables] Admin impersonation for owner ID: ${targetOwnerId}`);
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }
    
    console.log(`[API dine-in-tables] Step 3: Searching for business for owner: ${targetOwnerId}`);
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        console.log("[API dine-in-tables] Found business in 'restaurants' collection.");
        return restaurantsQuery.docs[0].ref;
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
         console.log("[API dine-in-tables] Found business in 'shops' collection.");
        return shopsQuery.docs[0].ref;
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    console.log("[API dine-in-tables] GET request received.");
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        console.log(`[API dine-in-tables] Step 4: Business Ref obtained: ${businessRef.path}`);
        
        // Fetch all necessary data in parallel
        const [tablesSnap, tabsSnap, serviceRequestsSnap] = await Promise.all([
            businessRef.collection('tables').orderBy('createdAt', 'asc').get(),
            businessRef.collection('dineInTabs').where('status', '==', 'active').get(),
            businessRef.collection('serviceRequests').where('status', '==', 'pending').orderBy('createdAt', 'desc').get(),
        ]);
        console.log(`[API dine-in-tables] Step 5: Fetched initial data. Tables: ${tablesSnap.size}, Active Tabs: ${tabsSnap.size}, Service Requests: ${serviceRequestsSnap.size}`);
        
        const tables = [];
        for (const tableDoc of tablesSnap.docs) {
            const tableData = { id: tableDoc.id, ...tableDoc.data(), tabs: [] };
            
            // Assign active tabs to this table
            for (const tabDoc of tabsSnap.docs) {
                if (tabDoc.data().tableId === tableDoc.id) {
                    const tabData = { id: tabDoc.id, ...tabDoc.data(), orders: [], allItems: [], totalBill: 0, latestOrderTime: null };
                    
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
                    tableData.tabs.push(tabData);
                }
            }
            
            const currentPax = tableData.tabs.reduce((sum, tab) => sum + (tab.pax_count || 0), 0);
            tableData.current_pax = currentPax;

            if (tableData.tabs.length > 0) {
                 tableData.state = 'occupied';
            } else if (tableData.state !== 'needs_cleaning') {
                tableData.state = 'available';
            }

            tables.push(tableData);
        }
        console.log(`[API dine-in-tables] Step 6: Processed ${tables.length} tables with their live data.`);

        const serviceRequests = serviceRequestsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
            };
        });
        
        const finalResponse = { tables, serviceRequests };
        console.log("[API dine-in-tables] Step 7: Sending final JSON response to client:", JSON.stringify(finalResponse, null, 2));

        return NextResponse.json(finalResponse, { status: 200 });

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL GET ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function POST(req) {
    console.log("[API dine-in-tables] POST request received to create/update table.");
    try {
        const businessRef = await verifyOwnerAndGetBusinessRef(req);
        const { tableId, max_capacity } = await req.json();
        console.log(`[API dine-in-tables] POST Payload: tableId=${tableId}, max_capacity=${max_capacity}`);

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

    } catch (error) {
        console.error("[API dine-in-tables] CRITICAL POST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


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
