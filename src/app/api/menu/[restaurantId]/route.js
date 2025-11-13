

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

// This function can be used in any API route that needs to fetch menu data publicly.
export async function GET(request, { params }) {
    console.log("[DEBUG] Menu API: Request received.");
    try {
        const firestore = await getFirestore();
        const { restaurantId } = params;
        const { searchParams } = new URL(request.url);
        const phone = searchParams.get('phone');
        
        console.log(`[DEBUG] Menu API: restaurantId from params: ${restaurantId}`);

        if (!restaurantId || restaurantId === 'undefined') {
            console.error("[DEBUG] Menu API: Invalid restaurantId received:", restaurantId);
            return NextResponse.json({ message: 'Restaurant ID is invalid or missing.' }, { status: 400 });
        }
        
        // --- THE FIX: Check all relevant collections ---
        let businessDoc;
        let businessType = 'restaurant';
        let collectionName = 'restaurants';
        
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

        for (const name of collectionsToTry) {
            console.log(`[DEBUG] Menu API: Trying to fetch from '${name}' collection with ID: ${restaurantId}`);
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessDoc = docSnap;
                collectionName = name;
                businessType = name.slice(0, -1); // 'restaurants' -> 'restaurant'
                break; // Found it, stop searching
            }
        }

        // If it doesn't exist in any collection, return 404.
        if (!businessDoc || !businessDoc.exists) {
            console.error(`[DEBUG] Menu API: Business with ID ${restaurantId} not found in any collection.`);
            return NextResponse.json({ message: `Business with ID ${restaurantId} not found.` }, { status: 404 });
        }
        
        console.log(`[DEBUG] Menu API: Found business '${businessDoc.data().name}' in collection '${collectionName}'.`);

        const restaurantRef = businessDoc.ref;
        const restaurantData = businessDoc.data();
        
        // --- CUSTOMER DATA FETCHING LOGS (No change here) ---
        let loyaltyPoints = 0;
        let customerData = null;
        if (phone) {
            const usersRef = firestore.collection('users');
            const userQuery = await usersRef.where('phone', '==', phone).limit(1).get();

            if (!userQuery.empty) {
                const userDoc = userQuery.docs[0];
                const userId = userDoc.id;
                customerData = userDoc.data();
                
                const customerInBusinessRef = restaurantRef.collection('customers').doc(userId);
                const customerInBusinessSnap = await customerInBusinessRef.get();
                if(customerInBusinessSnap.exists) {
                    loyaltyPoints = customerInBusinessSnap.data().loyaltyPoints || 0;
                }
            } else {
                 const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(phone);
                 const unclaimedSnap = await unclaimedProfileRef.get();
                 if (unclaimedSnap.exists) {
                     customerData = unclaimedSnap.data();
                 }
            }
        }
        
        // Check restaurant status
        if (restaurantData.approvalStatus === 'rejected' || restaurantData.approvalStatus === 'suspended' || restaurantData.isOpen === false) {
             console.warn(`[DEBUG] Menu API: Business '${restaurantData.name}' is not accepting orders. Status: ${restaurantData.approvalStatus}, isOpen: ${restaurantData.isOpen}`);
            return NextResponse.json({ 
                message: 'This business is currently not accepting orders.',
                restaurantName: restaurantData.name,
                status: restaurantData.approvalStatus,
                isOpen: restaurantData.isOpen,
            }, { status: 403 });
        }
        
        const couponsRef = restaurantRef.collection('coupons');
        const generalCouponsQuery = couponsRef.where('status', '==', 'Active').where('customerId', '==', null);

        const promises = [
            restaurantRef.collection('menu').where('isAvailable', '==', true).orderBy('order', 'asc').get(),
            generalCouponsQuery.get()
        ];
        
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
             if (!snap) return [];
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
        
        const businessAddress = restaurantData.address ? {
            ...restaurantData.address,
            full: `${restaurantData.address.street}, ${restaurantData.address.city}, ${restaurantData.address.state} ${restaurantData.address.postalCode}`.trim()
        } : null;

        let deliveryCharge = 0;
        const feeType = restaurantData.deliveryFeeType || 'fixed';
        if (feeType === 'fixed') {
            deliveryCharge = restaurantData.deliveryFixedFee !== undefined ? restaurantData.deliveryFixedFee : 30;
        } else if (feeType === 'per-km') {
            deliveryCharge = restaurantData.deliveryPerKmFee || 10;
        } else if (feeType === 'free-over') {
             deliveryCharge = restaurantData.deliveryFixedFee !== undefined ? restaurantData.deliveryFixedFee : 30;
        }

        return NextResponse.json({ 
            restaurantName: restaurantData.name,
            deliveryCharge: deliveryCharge,
            deliveryFreeThreshold: restaurantData.deliveryFreeThreshold,
            logoUrl: restaurantData.logoUrl,
            bannerUrls: restaurantData.bannerUrls,
            menu: menuData,
            coupons: allCoupons,
            loyaltyPoints: loyaltyPoints,
            businessType: restaurantData.businessType || 'restaurant',
            approvalStatus: restaurantData.approvalStatus,
            isOpen: restaurantData.isOpen,
            deliveryEnabled: restaurantData.deliveryEnabled === undefined ? true : restaurantData.deliveryEnabled,
            pickupEnabled: restaurantData.pickupEnabled === undefined ? false : restaurantData.pickupEnabled,
            dineInEnabled: restaurantData.dineInEnabled !== undefined ? restaurantData.dineInEnabled : true,
            deliveryOnlinePaymentEnabled: restaurantData.deliveryOnlinePaymentEnabled === undefined ? true : restaurantData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: restaurantData.deliveryCodEnabled === undefined ? true : restaurantData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: restaurantData.pickupOnlinePaymentEnabled === undefined ? true : restaurantData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: restaurantData.pickupPodEnabled === undefined ? true : restaurantData.pickupPodEnabled,
            dineInOnlinePaymentEnabled: restaurantData.dineInOnlinePaymentEnabled === undefined ? true : restaurantData.dineInOnlinePaymentEnabled,
            dineInPayAtCounterEnabled: restaurantData.dineInPayAtCounterEnabled === undefined ? true : restaurantData.dineInPayAtCounterEnabled,
            businessAddress: businessAddress,
        }, { status: 200 });

    } catch (error) {
        console.error("[DEBUG] GET MENU/COUPONS API CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
