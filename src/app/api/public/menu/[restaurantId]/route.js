
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req, { params }) {
    const { restaurantId } = params;
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    const firestore = await getFirestore();

    if (!restaurantId) {
        return NextResponse.json({ message: 'Restaurant ID is required.' }, { status: 400 });
    }

    try {
        let businessData = null;
        let businessRef = null;
        let collectionName = '';

        const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
        for (const name of collectionsToTry) {
            const docRef = firestore.collection(name).doc(restaurantId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                businessData = docSnap.data();
                businessRef = docRef;
                collectionName = name;
                break;
            }
        }

        if (!businessData) {
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }

        const menuSnap = await businessRef.collection('menu').orderBy('order', 'asc').get();
        let menuData = {};
        const customCategories = businessData.customCategories || [];
        
        const restaurantCategoryConfig = {
          "starters": { title: "Starters" }, "main-course": { title: "Main Course" }, "beverages": { title: "Beverages" },
          "desserts": { title: "Desserts" }, "soup": { title: "Soup" }, "tandoori-item": { title: "Tandoori Items" },
          "momos": { title: "Momos" }, "burgers": { title: "Burgers" }, "rolls": { title: "Rolls" },
          "tandoori-khajana": { title: "Tandoori Khajana" }, "rice": { title: "Rice" }, "noodles": { title: "Noodles" },
          "pasta": { title: "Pasta" }, "raita": { title: "Raita" },
          'snacks': { title: 'Snacks' }, 'chaat': { title: 'Chaat' }, 'sweets': { title: 'Sweets' },
        };
        const shopCategoryConfig = {
          "electronics": { title: "Electronics" }, "groceries": { title: "Groceries" }, "clothing": { title: "Clothing" },
          "books": { title: "Books" }, "home-appliances": { title: "Home Appliances" }, "toys-games": { title: "Toys & Games" },
          "beauty-personal-care": { title: "Beauty & Personal Care" }, "sports-outdoors": { title: "Sports & Outdoors" },
        };

        const businessType = businessData.businessType || collectionName.slice(0, -1);
        const baseCategories = (businessType === 'restaurant' || businessType === 'street-vendor') ? restaurantCategoryConfig : shopCategoryConfig;
        
        const allCategories = { ...baseCategories };
        customCategories.forEach(cat => {
            if (!allCategories[cat.id]) {
                allCategories[cat.id] = { title: cat.title };
            }
        });
        
        Object.keys(allCategories).forEach(key => {
            menuData[key] = [];
        });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (menuData[categoryKey]) {
                menuData[categoryKey].push({ id: doc.id, ...item });
            } else {
                 if (!menuData['general']) menuData['general'] = [];
                 menuData['general'].push({ id: doc.id, ...item });
            }
        });

        let loyaltyPoints = 0;
        let userId = null;
        if (phone) {
            const usersRef = firestore.collection('users');
            const userQuery = await usersRef.where('phone', '==', phone).limit(1).get();
            if (!userQuery.empty) {
                userId = userQuery.docs[0].id;
                const customerRef = businessRef.collection('customers').doc(userId);
                const customerSnap = await customerRef.get();
                if (customerSnap.exists) {
                    loyaltyPoints = customerSnap.data().loyaltyPoints || 0;
                }
            }
        }
        
        const couponsSnap = await businessRef.collection('coupons').where('status', '==', 'Active').get();
        const now = new Date();
        const coupons = couponsSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(coupon => {
                const startDate = coupon.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon.startDate);
                const expiryDate = coupon.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon.expiryDate);
                return startDate <= now && expiryDate >= now;
            })
            .filter(c => !c.customerId || c.customerId === userId); // Public or for this user

        return NextResponse.json({
            restaurantName: businessData.name,
            approvalStatus: businessData.approvalStatus || 'approved',
            logoUrl: businessData.logoUrl,
            bannerUrls: businessData.bannerUrls,
            deliveryCharge: businessData.deliveryCharge,
            deliveryFreeThreshold: businessData.deliveryFreeThreshold,
            menu: menuData,
            coupons: coupons,
            loyaltyPoints: loyaltyPoints,
            deliveryEnabled: businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled,
            businessAddress: businessData.address,
            businessType: businessType,
            dineInModel: businessData.dineInModel,
        }, { status: 200 });

    } catch (error) {
        console.error(`[API ERROR] /api/public/menu/${restaurantId}:`, error);
        return NextResponse.json({ message: 'Internal Server Error: ' + error.message }, { status: 500 });
    }
}
