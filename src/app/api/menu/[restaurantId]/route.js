

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

// This function can be used in any API route that needs to fetch menu data publicly.
export async function GET(request, { params }) {
    console.log("[DEBUG] Menu API: Request received.");
    try {
        const firestore = getFirestore();
        const { restaurantId } = params;
        const { searchParams } = new URL(request.url);
        const phone = searchParams.get('phone');
        
        console.log(`[DEBUG] Menu API: restaurantId from params: ${restaurantId}`);

        if (!restaurantId || restaurantId === 'undefined') {
            console.error("[DEBUG] Menu API: Invalid restaurantId received:", restaurantId);
            return NextResponse.json({ message: 'Restaurant ID is invalid or missing.' }, { status: 400 });
        }
        
        // ** THE FIX: Check both collections
        let restaurantDoc;
        let businessType = 'restaurant';
        
        console.log(`[DEBUG] Menu API: Trying to fetch from 'restaurants' collection with ID: ${restaurantId}`);
        restaurantDoc = await firestore.collection('restaurants').doc(restaurantId).get();
        if (!restaurantDoc.exists) {
            console.log(`[DEBUG] Menu API: Not found in 'restaurants'. Trying 'shops' collection.`);
            restaurantDoc = await firestore.collection('shops').doc(restaurantId).get();
            businessType = 'shop';
        }

        // If it doesn't exist in either, return 404.
        if (!restaurantDoc.exists) {
            console.error(`[DEBUG] Menu API: Business with ID ${restaurantId} not found in either collection.`);
            return NextResponse.json({ message: `Business with ID ${restaurantId} not found.` }, { status: 404 });
        }
        
        console.log(`[DEBUG] Menu API: Found business '${restaurantDoc.data().name}' in collection '${businessType}s'.`);

        const restaurantRef = restaurantDoc.ref;
        const restaurantData = restaurantDoc.data();
        
        // --- CUSTOMER DATA FETCHING LOGS ---
        let loyaltyPoints = 0;
        let customerData = null;
        if (phone) {
            console.log(`[DEBUG] Menu API: Phone number provided: ${phone}. Fetching customer data.`);
            const usersRef = firestore.collection('users');
            console.log(`[DEBUG] Menu API: Searching for user with phone '${phone}' in 'users' collection.`);
            const userQuery = await usersRef.where('phone', '==', phone).limit(1).get();

            if (!userQuery.empty) {
                const userDoc = userQuery.docs[0];
                const userId = userDoc.id;
                customerData = userDoc.data();
                console.log(`[DEBUG] Menu API: User found in 'users' collection. UID: ${userId}`);

                const customerInBusinessRef = restaurantRef.collection('customers').doc(userId);
                const customerInBusinessSnap = await customerInBusinessRef.get();
                if(customerInBusinessSnap.exists) {
                    loyaltyPoints = customerInBusinessSnap.data().loyaltyPoints || 0;
                    console.log(`[DEBUG] Menu API: Customer loyalty points found: ${loyaltyPoints}`);
                } else {
                    console.log(`[DEBUG] Menu API: Customer has a main profile but has not ordered from this business yet. Loyalty points are 0.`);
                }
            } else {
                 console.log(`[DEBUG] Menu API: No user found in 'users' collection. Checking 'unclaimed_profiles'.`);
                 const unclaimedProfileRef = firestore.collection('unclaimed_profiles').doc(phone);
                 const unclaimedSnap = await unclaimedProfileRef.get();
                 if (unclaimedSnap.exists) {
                     customerData = unclaimedSnap.data();
                     console.log(`[DEBUG] Menu API: User found in 'unclaimed_profiles'. Data:`, customerData);
                 } else {
                     console.log(`[DEBUG] Menu API: No profile found for this phone number anywhere.`);
                 }
            }
        } else {
            console.log("[DEBUG] Menu API: No phone number provided. Skipping customer data fetch.");
        }
        // --- END CUSTOMER DATA FETCHING LOGS ---

        // ** NEW **: Check restaurant status
        if (restaurantData.approvalStatus !== 'approved' || !restaurantData.isOpen) {
             console.warn(`[DEBUG] Menu API: Business '${restaurantData.name}' is not accepting orders. Status: ${restaurantData.approvalStatus}, isOpen: ${restaurantData.isOpen}`);
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

        console.log(`[DEBUG] Menu API: Successfully processed menu with ${Object.keys(menuData).length} categories and ${allCoupons.length} coupons.`);
        
        const businessAddress = restaurantData.address ? {
            ...restaurantData.address,
            full: `${restaurantData.address.street}, ${restaurantData.address.city}, ${restaurantData.address.state} ${restaurantData.address.postalCode}`.trim()
        } : null;


        // Return all public data together
        return NextResponse.json({ 
            restaurantName: restaurantData.name,
            deliveryCharge: restaurantData.deliveryCharge,
            logoUrl: restaurantData.logoUrl,
            bannerUrls: restaurantData.bannerUrls,
            menu: menuData,
            coupons: allCoupons,
            loyaltyPoints: loyaltyPoints, // Send loyalty points
            businessType: restaurantData.businessType || 'restaurant',
            // ** NEW **: Pass all order and payment settings to the client
            approvalStatus: restaurantData.approvalStatus,
            isOpen: restaurantData.isOpen,
            deliveryEnabled: restaurantData.deliveryEnabled === undefined ? true : restaurantData.deliveryEnabled,
            pickupEnabled: restaurantData.pickupEnabled === undefined ? false : restaurantData.pickupEnabled,
            dineInEnabled: restaurantData.dineInEnabled !== undefined ? restaurantData.dineInEnabled : true, // THE FIX
            deliveryOnlinePaymentEnabled: restaurantData.deliveryOnlinePaymentEnabled === undefined ? true : restaurantData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: restaurantData.deliveryCodEnabled === undefined ? true : restaurantData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: restaurantData.pickupOnlinePaymentEnabled === undefined ? true : restaurantData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: restaurantData.pickupPodEnabled === undefined ? true : restaurantData.pickupPodEnabled,
            businessAddress: businessAddress, // THE FIX: Send the formatted business address
        }, { status: 200 });

    } catch (error) {
        console.error("[DEBUG] GET MENU/COUPONS API CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
