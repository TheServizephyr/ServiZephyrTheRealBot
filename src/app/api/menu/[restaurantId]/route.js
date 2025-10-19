

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
        
        // ** THE FIX: Check both collections
        let restaurantDoc;
        let businessType = 'restaurant';
        
        restaurantDoc = await firestore.collection('restaurants').doc(restaurantId).get();
        if (!restaurantDoc.exists) {
            restaurantDoc = await firestore.collection('shops').doc(restaurantId).get();
            businessType = 'shop';
        }

        // If it doesn't exist in either, return 404.
        if (!restaurantDoc.exists) {
            return NextResponse.json({ message: `Business with ID ${restaurantId} not found.` }, { status: 404 });
        }
        
        const restaurantRef = restaurantDoc.ref;
        const restaurantData = restaurantDoc.data();

        // ** NEW **: Check restaurant status
        if (restaurantData.approvalStatus !== 'approved' || !restaurantData.isOpen) {
            return NextResponse.json({ 
                message: 'This business is currently not accepting orders.',
                restaurantName: restaurantData.name,
                status: restaurantData.approvalStatus,
                isOpen: restaurantData.isOpen,
            }, { status: 403 }); // Using 403 Forbidden is appropriate here
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

        // Process Menu
        const menuData = {};
        const defaultRestaurantCategories = ["momos", "burgers", "rolls", "soup", "tandoori-item", "starters", "main-course", "tandoori-khajana", "rice", "noodles", "pasta", "raita", "desserts", "beverages"];
        const defaultShopCategories = ["electronics", "groceries", "clothing", "books", "home-appliances", "toys-games", "beauty-personal-care", "sports-outdoors"];
        const customCategories = restaurantData.customCategories || [];
        
        const defaultCategoryKeys = businessType === 'restaurant' ? defaultRestaurantCategories : defaultShopCategories;
        const allCategoryKeys = [...new Set([...defaultCategoryKeys, ...customCategories.map(c => c.id)])];

        allCategoryKeys.forEach(key => {
            menuData[key] = [];
        });

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
            restaurantName: restaurantData.name,
            deliveryCharge: restaurantData.deliveryCharge,
            logoUrl: restaurantData.logoUrl,
            bannerUrls: restaurantData.bannerUrls,
            menu: menuData,
            coupons: allCoupons,
            businessType: restaurantData.businessType || 'restaurant',
            // ** NEW **: Pass all order and payment settings to the client
            approvalStatus: restaurantData.approvalStatus,
            isOpen: restaurantData.isOpen,
            deliveryEnabled: restaurantData.deliveryEnabled === undefined ? true : restaurantData.deliveryEnabled,
            pickupEnabled: restaurantData.pickupEnabled === undefined ? false : restaurantData.pickupEnabled,
            deliveryOnlinePaymentEnabled: restaurantData.deliveryOnlinePaymentEnabled === undefined ? true : restaurantData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: restaurantData.deliveryCodEnabled === undefined ? true : restaurantData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: restaurantData.pickupOnlinePaymentEnabled === undefined ? true : restaurantData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: restaurantData.pickupPodEnabled === undefined ? true : restaurantData.pickupPodEnabled,
        }, { status: 200 });

    } catch (error) {
        console.error("GET MENU/COUPONS API ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
