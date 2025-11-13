
import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

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
        // ** THE FIX: Calculate pax count from ALL active tabs, not just one. **
        const current_pax = activeTabs.reduce((sum, tab) => sum + (tab.pax_count || 0), 0);

        return NextResponse.json({ 
            tableId: tableId, // Return the ID
            max_capacity: tableData.max_capacity,
            current_pax,
            activeTabs,
            // ** THE FIX: Determine state based on the calculated pax count. **
            state: current_pax >= tableData.max_capacity ? 'full' : (current_pax > 0 ? 'occupied' : 'available')
        }, { status: 200 });

    } catch (error) {
        console.error("GET TABLE STATUS ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
