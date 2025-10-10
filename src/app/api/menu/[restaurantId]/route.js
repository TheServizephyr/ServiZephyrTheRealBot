

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

// This function can be used in any API route that needs to fetch menu data publicly.
export async function GET(request, { params }) {
    try {
        const firestore = getFirestore();
        const { restaurantId } = params;
        const { searchParams } = new URL(request.url);
        const phone = searchParams.get('phone');

        if (!restaurantId) {
            return NextResponse.json({ message: 'Restaurant ID is missing.' }, { status: 400 });
        }
        
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        let restaurantDoc = await restaurantRef.get();

        // If restaurant doesn't exist, return a 404.
        if (!restaurantDoc.exists) {
            return NextResponse.json({ message: `Restaurant with ID ${restaurantId} not found.` }, { status: 404 });
        }
        
        const couponsRef = restaurantRef.collection('coupons');
        
        // Base query for general, active coupons
        const generalCouponsQuery = couponsRef.where('status', '==', 'Active').where('customerId', '==', null);

        // Fetch everything concurrently
        const promises = [
            restaurantRef.collection('menu').where('isAvailable', '==', true).orderBy('order', 'asc').get(),
            generalCouponsQuery.get()
        ];
        
        // If a customer phone number is provided, also fetch their specific coupons
        if (phone) {
            const customerCouponsQuery = couponsRef.where('status', '==', 'Active').where('customerId', '==', phone);
            promises.push(customerCouponsQuery.get());
        }

        const [menuSnap, generalCouponsSnap, customerCouponsSnap] = await Promise.all(promises);

        const restaurantData = restaurantDoc.data();
        const restaurantName = restaurantData.name;
        const deliveryCharge = restaurantData.deliveryCharge || 0; // Default to 0 if not set
        const logoUrl = restaurantData.logoUrl || '';
        const bannerUrls = restaurantData.bannerUrls || [];

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
        let allCoupons = [];

        const processCouponSnap = (snap) => {
             if (!snap) return []; // Guard against undefined snap
             return snap.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    startDate: data.startDate?.toDate ? data.startDate.toDate().toISOString() : data.startDate,
                    expiryDate: data.expiryDate?.toDate ? data.expiryDate.toDate().toISOString() : data.expiryDate,
                };
            });
        }
        
        allCoupons = allCoupons.concat(processCouponSnap(generalCouponsSnap));
        if (customerCouponsSnap) {
             allCoupons = allCoupons.concat(processCouponSnap(customerCouponsSnap));
        }

        // Return all public data together
        return NextResponse.json({ 
            restaurantName: restaurantName,
            deliveryCharge: deliveryCharge,
            logoUrl: logoUrl,
            bannerUrls: bannerUrls,
            menu: menuData,
            coupons: allCoupons
        }, { status: 200 });

    } catch (error) {
        console.error("GET MENU/COUPONS API ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
