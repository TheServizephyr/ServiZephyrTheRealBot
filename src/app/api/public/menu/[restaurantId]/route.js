

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function fetchCollection(firestore, collectionName, restaurantId) {
    const docRef = firestore.collection(collectionName).doc(restaurantId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
        return null;
    }

    const data = docSnap.data();
    return {
        id: docSnap.id,
        name: data.name || 'Unnamed Business',
        logoUrl: data.logoUrl || null,
        bannerUrls: data.bannerUrls || [],
        approvalStatus: data.approvalStatus || 'pending',
        deliveryCharge: data.deliveryCharge || 0,
        deliveryFreeThreshold: data.deliveryFreeThreshold || 9999,
        deliveryEnabled: data.deliveryEnabled,
        pickupEnabled: data.pickupEnabled,
        dineInEnabled: data.dineInEnabled,
        dineInModel: data.dineInModel || 'post-paid',
        businessAddress: data.address || null,
        businessType: data.businessType || collectionName.slice(0, -1),
        // --- START FIX: Pass payment settings to order page ---
        dineInOnlinePaymentEnabled: data.dineInOnlinePaymentEnabled !== false, // Default to true
        dineInPayAtCounterEnabled: data.dineInPayAtCounterEnabled !== false, // Default to true
        // --- END FIX ---
    };
}


export async function GET(req, { params }) {
    const { restaurantId } = params;
    const { searchParams } = new URL(req.url);
    const customerPhone = searchParams.get('phone');

    try {
        const firestore = await getFirestore();
        
        let restaurantData = null;
        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

        for (const collectionName of collectionsToTry) {
            const data = await fetchCollection(firestore, collectionName, restaurantId);
            if (data) {
                restaurantData = data;
                break;
            }
        }
        
        if (!restaurantData) {
            return NextResponse.json({ message: "Restaurant not found." }, { status: 404 });
        }

        const menuRef = firestore.collection(restaurantData.businessType === 'shop' ? 'shops' : 'restaurants').doc(restaurantId).collection('menu');
        const menuSnap = await menuRef.where('isAvailable', '==', true).get();

        const menuData = {};
        const customCategories = (await firestore.collection(restaurantData.businessType === 'shop' ? 'shops' : 'restaurants').doc(restaurantId).get()).data()?.customCategories || [];

        const categoryConfig = {
            restaurant: {
              "starters": { title: "Starters" }, "main-course": { title: "Main Course" }, "beverages": { title: "Beverages" },
              "desserts": { title: "Desserts" }, "soup": { title: "Soup" }, "tandoori-item": { title: "Tandoori Items" },
            },
            shop: {
              "electronics": { title: "Electronics" }, "groceries": { title: "Groceries" }, "clothing": { title: "Clothing" },
            }
        };

        const businessTypeForCategories = restaurantData.businessType === 'street-vendor' ? 'restaurant' : restaurantData.businessType;
        const allCategories = { ...(categoryConfig[businessTypeForCategories] || {}) };
        
        customCategories.forEach(cat => {
            if (!allCategories[cat.id]) {
              allCategories[cat.id] = { title: cat.title };
            }
        });
        Object.keys(allCategories).forEach(key => { menuData[key] = []; });
        
        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (!menuData[categoryKey]) menuData[categoryKey] = [];
            menuData[categoryKey].push({ id: doc.id, ...item });
        });

        // Add special coupons for this customer
        let specialCoupons = [];
        let loyaltyPoints = 0;
        if(customerPhone) {
            const normalizedPhone = customerPhone.length > 10 ? customerPhone.slice(-10) : customerPhone;
            const usersRef = firestore.collection('users');
            const userQuery = await usersRef.where('phone', '==', normalizedPhone).limit(1).get();

            if (!userQuery.empty) {
                const userId = userQuery.docs[0].id;
                const customerCouponsRef = firestore.collection(restaurantData.businessType === 'shop' ? 'shops' : 'restaurants').doc(restaurantId).collection('coupons');
                const customerCouponsSnap = await customerCouponsRef.where('customerId', '==', userId).get();
                customerCouponsSnap.forEach(doc => specialCoupons.push({ id: doc.id, ...doc.data() }));

                const customerDataRef = firestore.collection(restaurantData.businessType === 'shop' ? 'shops' : 'restaurants').doc(restaurantId).collection('customers').doc(userId);
                const customerDataSnap = await customerDataRef.get();
                if(customerDataSnap.exists){
                    loyaltyPoints = customerDataSnap.data().loyaltyPoints || 0;
                }
            }
        }
        
        const generalCouponsRef = firestore.collection(restaurantData.businessType === 'shop' ? 'shops' : 'restaurants').doc(restaurantId).collection('coupons');
        const generalCouponsSnap = await generalCouponsRef.where('customerId', '==', null).get();
        const generalCoupons = generalCouponsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        const allCoupons = [...generalCoupons, ...specialCoupons];

        return NextResponse.json({
            restaurantName: restaurantData.name,
            logoUrl: restaurantData.logoUrl,
            bannerUrls: restaurantData.bannerUrls,
            approvalStatus: restaurantData.approvalStatus,
            deliveryCharge: restaurantData.deliveryCharge,
            deliveryFreeThreshold: restaurantData.deliveryFreeThreshold,
            deliveryEnabled: restaurantData.deliveryEnabled,
            pickupEnabled: restaurantData.pickupEnabled,
            dineInEnabled: restaurantData.dineInEnabled,
            dineInModel: restaurantData.dineInModel,
            businessAddress: restaurantData.businessAddress,
            businessType: restaurantData.businessType,
            // --- START FIX: Pass payment settings to order page ---
            dineInOnlinePaymentEnabled: restaurantData.dineInOnlinePaymentEnabled,
            dineInPayAtCounterEnabled: restaurantData.dineInPayAtCounterEnabled,
            // --- END FIX ---
            menu: menuData,
            coupons: allCoupons,
            loyaltyPoints: loyaltyPoints,
        }, { status: 200 });

    } catch (error) {
        console.error(`[API ERROR] /api/public/menu/${restaurantId}:`, error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
