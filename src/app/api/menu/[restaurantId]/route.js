
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

// This function can be used in any API route that needs to fetch menu data publicly.
export async function GET(request, { params }) {
    try {
        const firestore = getFirestore();
        const { restaurantId } = params;

        if (!restaurantId) {
            return NextResponse.json({ message: 'Restaurant ID is missing.' }, { status: 400 });
        }
        
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        
        // Use Promise.all to fetch everything concurrently
        const [restaurantDoc, menuSnap, couponsSnap] = await Promise.all([
            restaurantRef.get(),
            restaurantRef.collection('menu').where('isAvailable', '==', true).orderBy('order', 'asc').get(),
            restaurantRef.collection('coupons').where('status', '==', 'Active').get()
        ]);


        if (!restaurantDoc.exists) {
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }
        const restaurantName = restaurantDoc.data().name;

        // Process Menu
        const menuData = {};
        const categoryKeys = ["starters", "main-course", "desserts", "beverages", "momos", "burgers", "rolls", "soup", "tandoori-item", "tandoori-khajana", "rice", "noodles", "pasta", "raita"];
        categoryKeys.forEach(key => { menuData[key] = []; });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            if (item.categoryId && menuData.hasOwnProperty(item.categoryId)) {
                menuData[item.categoryId].push({ id: doc.id, ...item });
            } else if (item.categoryId) {
                if (!menuData[item.categoryId]) menuData[item.categoryId] = [];
                menuData[item.categoryId].push({ id: doc.id, ...item });
            }
        });
        
        // Process Coupons
        const coupons = couponsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                // Ensure dates are sent in a client-friendly format (ISO string)
                startDate: data.startDate?.toDate ? data.startDate.toDate().toISOString() : data.startDate,
                expiryDate: data.expiryDate?.toDate ? data.expiryDate.toDate().toISOString() : data.expiryDate,
            };
        });


        // Return all public data together
        return NextResponse.json({ 
            restaurantName: restaurantName,
            menu: menuData,
            coupons: coupons
        }, { status: 200 });

    } catch (error) {
        console.error("GET MENU/COUPONS API ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
