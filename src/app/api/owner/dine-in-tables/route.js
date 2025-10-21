

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, FieldValue } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // THE FIX: Read from URL search params instead of referer header
    const { searchParams } = new URL(req.url);
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
        
        const tablesSnap = await businessRef.collection('tables').orderBy('createdAt', 'asc').get();
        const tables = tablesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return NextResponse.json({ tables }, { status: 200 });

    } catch (error) {
        console.error("GET DINE-IN TABLES ERROR:", error);
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

        // Set max_capacity and initialize current_pax
        await tableRef.set({
            max_capacity: Number(max_capacity),
            current_pax: 0,
            createdAt: FieldValue.serverTimestamp(),
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
        const { tableId, action, tabIdToClose, newTableId, newCapacity } = await req.json();

        // Handle Table Edit logic
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

            // If name is changed, we need to move the document
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


        // Handle Table State logic
        if (!tableId || !action) {
            return NextResponse.json({ message: 'Table ID and action are required.' }, { status: 400 });
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
            
            return await firestore.runTransaction(async (transaction) => {
                const tabRef = businessRef.collection('dineInTabs').doc(tabIdToClose);
                const tabDoc = await transaction.get(tabRef);
                if (!tabDoc.exists) throw new Error("Tab to be closed not found.");
                
                const tableDoc = await transaction.get(tableRef);
                if (!tableDoc.exists) throw new Error("Table document not found.");

                const paxToReduce = tabDoc.data().pax_count || 0;
                
                transaction.update(tabRef, { status: 'closed' });
                transaction.update(tableRef, { 
                    current_pax: FieldValue.increment(-paxToReduce),
                    state: 'needs_cleaning' 
                });
            });
        }
        
        if (action === 'mark_cleaned') {
             await tableRef.update({ state: 'available' });
             return NextResponse.json({ message: `Table ${tableId} cleaning acknowledged.` }, { status: 200 });
        }


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
