

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { isAfter, subDays } from 'date-fns';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req); // Use central helper
    
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
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        return restaurantsQuery.docs[0].ref;
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        return shopsQuery.docs[0].ref;
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusiness(req);
        
        // Fetch all necessary data in parallel
        const [tablesSnap, tabsSnap, serviceRequestsSnap] = await Promise.all([
            businessRef.collection('tables').orderBy('createdAt', 'asc').get(),
            businessRef.collection('dineInTabs').where('status', '==', 'active').get(),
            businessRef.collection('serviceRequests').where('status', '==', 'pending').orderBy('createdAt', 'desc').get(),
        ]);
        
        const tables = tablesSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), tabs: [] }));
        
        const tabsData = {};
        for (const tabDoc of tabsSnap.docs) {
            const tabData = { id: tabDoc.id, ...tabDoc.data(), orders: [] };
            
            // Fetch orders for each active tab
            const ordersSnap = await businessRef.firestore.collection('orders')
                .where('dineInTabId', '==', tabDoc.id)
                .where('status', '!=', 'delivered')
                .where('status', '!=', 'rejected')
                .get();

            if (!ordersSnap.empty) {
                tabData.orders = ordersSnap.docs.map(orderDoc => ({ id: orderDoc.id, ...orderDoc.data() }));
            }
            tabsData[tabDoc.id] = tabData;
        }

        // Assign tabs to their respective tables
        tables.forEach(table => {
            Object.values(tabsData).forEach(tab => {
                if (tab.tableId === table.id) {
                    table.tabs.push(tab);
                }
            });
        });

        const serviceRequests = serviceRequestsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
            };
        });

        // Fetch closed tabs for history
        const thirtyDaysAgo = subDays(new Date(), 30);
        const closedTabsSnap = await businessRef.collection('dineInTabs')
            .where('status', '==', 'closed')
            .orderBy('closedAt', 'desc')
            .get();

        const closedTabs = [];
        for (const tabDoc of closedTabsSnap.docs) {
            const tabData = tabDoc.data();
            if (tabData.closedAt && isAfter(tabData.closedAt.toDate(), thirtyDaysAgo)) {
                 const ordersSnap = await businessRef.firestore.collection('orders')
                    .where('dineInTabId', '==', tabDoc.id)
                    .get();
                
                 const totalBill = ordersSnap.docs.reduce((sum, doc) => sum + (doc.data().totalAmount || 0), 0);

                closedTabs.push({ 
                    id: tabDoc.id,
                    ...tabData,
                    closedAt: tabData.closedAt.toDate().toISOString(),
                    totalBill: totalBill,
                });
            }
        }


        return NextResponse.json({ tables, serviceRequests, closedTabs }, { status: 200 });

    } catch (error) {
        console.error("GET DINE-IN STATE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function POST(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusiness(req);
        const { tableId, max_capacity } = await req.json();

        if (!tableId || !max_capacity || max_capacity < 1) {
            return NextResponse.json({ message: 'Table ID and a valid capacity are required.' }, { status: 400 });
        }
        
        const tableRef = businessRef.collection('tables').doc(tableId);

        await tableRef.set({
            max_capacity: Number(max_capacity),
            current_pax: 0,
            createdAt: FieldValue.serverTimestamp(),
            state: 'available'
        }, { merge: true });

        return NextResponse.json({ message: 'Table saved successfully.' }, { status: 201 });

    } catch (error) {
        console.error("POST DINE-IN TABLE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function PATCH(req) {
     try {
        const businessRef = await verifyOwnerAndGetBusiness(req);
        const { tableId, action, tabIdToClose, newTableId, newCapacity, paymentMethod } = await req.json();
        
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
                });
                return NextResponse.json({ message: `Table ${tableId} marked as needing cleaning.` }, { status: 200 });
            }
            
            if (action === 'mark_cleaned') {
                 await tableRef.update({ state: 'available', current_pax: 0 });
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
                const newTableRef = businessRef.collection('tables').doc(newTableId);
                const tableData = tableSnap.data();
                await newTableRef.set({ ...tableData, ...updateData });
                await oldTableRef.delete();
                return NextResponse.json({ message: `Table renamed to ${newTableId} and updated.` }, { status: 200 });
            } else {
                 await oldTableRef.update(updateData);
                 return NextResponse.json({ message: `Table ${tableId} updated.` }, { status: 200 });
            }
        }
        
        return NextResponse.json({ message: 'No valid action or edit data provided.' }, { status: 400 });

    } catch (error) {
        console.error("PATCH DINE-IN TABLE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function DELETE(req) {
    try {
        const businessRef = await verifyOwnerAndGetBusiness(req);
        const { tableId } = await req.json();

        if (!tableId) {
            return NextResponse.json({ message: 'Table ID is required.' }, { status: 400 });
        }

        const tableRef = businessRef.collection('tables').doc(tableId);
        await tableRef.delete();

        return NextResponse.json({ message: 'Table deleted successfully.' }, { status: 200 });

    } catch (error) {
        console.error("DELETE DINE-IN TABLE ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}



