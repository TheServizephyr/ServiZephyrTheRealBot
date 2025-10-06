
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
        
        // 1. Fetch Restaurant Name
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        const restaurantDoc = await restaurantRef.get();

        if (!restaurantDoc.exists) {
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }
        const restaurantName = restaurantDoc.data().name;


        // 2. Fetch Menu Items for that restaurant
        const menuRef = restaurantRef.collection('menu');
        const menuSnap = await menuRef.where('isAvailable', '==', true).orderBy('order', 'asc').get();

        const menuData = {};
        const categoryKeys = ["starters", "main-course", "desserts", "beverages"]; // Define your categories
        categoryKeys.forEach(key => { menuData[key] = []; });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            // Ensure the category exists on the item and in our map
            if (item.categoryId && menuData.hasOwnProperty(item.categoryId)) {
                menuData[item.categoryId].push({ id: doc.id, ...item });
            } else if (item.categoryId) {
                 // If a category from DB is not in our initial list, create it
                if (!menuData[item.categoryId]) {
                    menuData[item.categoryId] = [];
                }
                menuData[item.categoryId].push({ id: doc.id, ...item });
            }
        });


        // Return both restaurant name and menu
        return NextResponse.json({ 
            restaurantName: restaurantName,
            menu: menuData 
        }, { status: 200 });

    } catch (error) {
        console.error("GET MENU API ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
