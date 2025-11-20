
import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function getBusinessData(firestore, restaurantId) {
    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const docRef = firestore.collection(collectionName).doc(restaurantId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            console.log(`[API Public Menu] Found business ${restaurantId} in collection: ${collectionName}`);
            return {
                businessData: docSnap.data(),
                menuRef: docSnap.ref.collection('menu'),
                collectionName: collectionName,
            };
        }
    }
    console.warn(`[API Public Menu] Business not found with ID: ${restaurantId} in any collection.`);
    return null;
}

export async function GET(req, { params }) {
    const { restaurantId } = params;
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');
    
    if (!restaurantId) {
        return NextResponse.json({ message: 'Restaurant ID is required.' }, { status: 400 });
    }

    try {
        const firestore = await getFirestore();
        const businessInfo = await getBusinessData(firestore, restaurantId);

        if (!businessInfo) {
            return NextResponse.json({ message: 'This business does not exist or is not configured correctly.' }, { status: 404 });
        }
        
        const { businessData, menuRef, collectionName } = businessInfo;

        const menuSnap = await menuRef.orderBy('order', 'asc').get();

        let menuData = {};
        const allCategories = {
            ...(businessData.customCategories || []).reduce((acc, cat) => {
                acc[cat.id] = { title: cat.title };
                return acc;
            }, {}),
            "starters": { title: "Starters" }, "main-course": { title: "Main Course" },
            "beverages": { title: "Beverages" }, "desserts": { title: "Desserts" },
            "soup": { title: "Soup" }, "tandoori-item": { title: "Tandoori Items" },
            "momos": { title: "Momos" }, "burgers": { title: "Burgers" },
            "rolls": { title: "Rolls" }, "tandoori-khajana": { title: "Tandoori Khajana" },
            "rice": { title: "Rice" }, "noodles": { title: "Noodles" },
            "pasta": { title: "Pasta" }, "raita": { title: "Raita" },
            'snacks': { title: 'Snacks' }, 'chaat': { title: 'Chaat' }, 'sweets': { title: 'Sweets' },
        };
        
        Object.keys(allCategories).forEach(key => {
            menuData[key] = [];
        });

        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const categoryKey = item.categoryId || 'general';
            if (item.isAvailable) {
                if (!menuData[categoryKey]) menuData[categoryKey] = [];
                menuData[categoryKey].push({ id: doc.id, ...item });
            }
        });
        
        // Filter out empty categories
        Object.keys(menuData).forEach(key => {
            if (menuData[key].length === 0) {
                delete menuData[key];
            }
        });
        
        const couponsRef = firestore.collection(collectionName).doc(restaurantId).collection('coupons');
        const now = new Date();
        const couponsSnap = await couponsRef.where('status', '==', 'Active').where('expiryDate', '>=', now).get();
        const availableCoupons = couponsSnap.docs.map(doc => doc.data());
        
        let customerCoupons = [];
        if (phone) {
            const userSnap = await firestore.collection('users').where('phone', '==', phone).limit(1).get();
            if (!userSnap.empty) {
                const userId = userSnap.docs[0].id;
                const customerCouponsSnap = await couponsRef.where('customerId', '==', userId).where('status', '==', 'Active').where('expiryDate', '>=', now).get();
                customerCoupons = customerCouponsSnap.docs.map(doc => doc.data());
            }
        }
        
        const finalCoupons = [...availableCoupons, ...customerCoupons];

        const responsePayload = {
            restaurantName: businessData.name || 'Unnamed Business',
            logoUrl: businessData.logoUrl || null,
            bannerUrls: businessData.bannerUrls || null,
            deliveryCharge: businessData.deliveryCharge || 0,
            deliveryFreeThreshold: businessData.deliveryFreeThreshold || 0,
            businessType: businessData.businessType || collectionName.slice(0, -1),
            menu: menuData,
            coupons: finalCoupons,
            approvalStatus: businessData.approvalStatus || 'pending',
            isOpen: businessData.isOpen === undefined ? true : businessData.isOpen,
            deliveryEnabled: businessData.deliveryEnabled === undefined ? true : businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled === undefined ? true : businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled === undefined ? true : businessData.dineInEnabled,
            businessAddress: businessData.address || null,
            dineInModel: businessData.dineInModel || 'post-paid',
        };

        return NextResponse.json(responsePayload, { status: 200 });

    } catch (error) {
        console.error("[API Public Menu] CRITICAL ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
