
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

// This is a simplified helper, a real app would have more robust auth
async function getBusinessRef(firestore, restaurantId) {
    let businessRef = firestore.collection('restaurants').doc(restaurantId);
    let businessSnap = await businessRef.get();
    
    if (businessSnap.exists) {
        return { ref: businessRef, collectionName: 'restaurants' };
    }

    businessRef = firestore.collection('shops').doc(restaurantId);
    businessSnap = await businessRef.get();

    if (businessSnap.exists) {
         return { ref: businessRef, collectionName: 'shops' };
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

        const firestore = getFirestore();
        const businessInfo = await getBusinessRef(firestore, restaurantId);

        if (!businessInfo) {
             return NextResponse.json({ message: 'Business not found.' }, { status: 404 });
        }
        
        const tableRef = businessInfo.ref.collection('tables').doc(tableId);
        const tableSnap = await tableRef.get();

        if (!tableSnap.exists) {
            // If table doc doesn't exist, it's considered available
            return NextResponse.json({ state: 'available' }, { status: 200 });
        }

        const tableData = tableSnap.data();
        
        return NextResponse.json({ state: tableData.state || 'available' }, { status: 200 });

    } catch (error) {
        console.error("GET TABLE STATUS ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }
}
