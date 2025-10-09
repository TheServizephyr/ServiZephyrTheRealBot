

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { firestore as adminFirestore } from 'firebase-admin';

// --- DEMO DATA SEEDING FUNCTION ---
async function seedInitialPublicData(firestore, restaurantId) {
    const batch = firestore.batch();
    const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
    const menuRef = restaurantRef.collection('menu');
    const couponsRef = restaurantRef.collection('coupons');

    // Seed Restaurant Info (if it doesn't exist)
    batch.set(restaurantRef, {
        name: 'ServiZephyr Demo Restaurant',
        address: '123 Cyber Street, Tech City',
        deliveryCharge: 30,
        ownerId: 'demo-owner',
        logoUrl: '', // Add new field
        bannerUrls: [], // Add new field
    }, { merge: true });

    // Seed Menu Items
    const initialItems = [
        { name: 'Paneer Tikka', description: 'Tandoor-cooked cottage cheese', halfPrice: 180, fullPrice: 280, isVeg: true, isAvailable: true, categoryId: 'starters', order: 1, imageUrl: `https://picsum.photos/seed/paneertikka/100/100` },
        { name: 'Chilli Chicken', description: 'Spicy diced chicken', halfPrice: 200, fullPrice: 320, isVeg: false, isAvailable: true, categoryId: 'starters', order: 2, imageUrl: `https://picsum.photos/seed/chillichicken/100/100` },
        { name: 'Dal Makhani', description: 'Creamy black lentils', halfPrice: null, fullPrice: 250, isVeg: true, isAvailable: true, categoryId: 'main-course', order: 1, imageUrl: `https://picsum.photos/seed/dalmakhani/100/100` },
        { name: 'Veg Steamed Momos', description: '8 Pcs, served with chutney', halfPrice: null, fullPrice: 120, isVeg: true, isAvailable: true, categoryId: 'momos', order: 1, imageUrl: `https://picsum.photos/seed/vegmomos/100/100` },
    ];
    initialItems.forEach(itemData => {
        const docRef = menuRef.doc();
        batch.set(docRef, { ...itemData, id: docRef.id });
    });
    
    // Seed Coupons
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const initialCoupons = [
        { code: 'SAVE100', description: 'Get flat ₹100 off on orders above ₹599', type: 'flat', value: 100, minOrder: 599, startDate: new Date(), expiryDate: nextMonth, status: 'Active', customerId: null },
        { code: 'FREEDEL', description: 'Free delivery on all orders above ₹299', type: 'free_delivery', value: 0, minOrder: 299, startDate: new Date(), expiryDate: nextMonth, status: 'Active', customerId: null },
    ];
     initialCoupons.forEach(couponData => {
        const docRef = couponsRef.doc();
        batch.set(docRef, { 
            ...couponData, 
            id: docRef.id,
            startDate: adminFirestore.Timestamp.fromDate(couponData.startDate),
            expiryDate: adminFirestore.Timestamp.fromDate(couponData.expiryDate),
        });
    });

    await batch.commit();
}


// This function can be used in any API route that needs to fetch menu data publicly.
export async function GET(request, { params }) {
    try {
        const firestore = getFirestore();
        const { restaurantId } = params;
        const { searchParams } = new URL(request.url);
        const phone = searchParams.get('phone'); // Changed from customerId to phone

        if (!restaurantId) {
            return NextResponse.json({ message: 'Restaurant ID is missing.' }, { status: 400 });
        }
        
        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        let restaurantDoc = await restaurantRef.get();

        // --- SEEDING LOGIC ---
        // If restaurant doesn't exist, create it with demo data.
        if (!restaurantDoc.exists) {
            console.log(`[Public Menu API] Restaurant ${restaurantId} not found. Seeding demo data...`);
            await seedInitialPublicData(firestore, restaurantId);
            // Re-fetch the document after seeding
            restaurantDoc = await restaurantRef.get();
        }
        
        const couponsRef = restaurantRef.collection('coupons');
        
        // Base query for general, active coupons
        const generalCouponsQuery = couponsRef.where('status', '==', 'Active').where('customerId', '==', null);

        let customerId = null;
        if (phone) {
            const usersRef = firestore.collection('users');
            // IMPORTANT FIX: Search for the user by their phone number to get their UID
            const userQuery = await usersRef.where('phone', '==', phone).limit(1).get();
            if (!userQuery.empty) {
                customerId = userQuery.docs[0].id; // This is the user's UID
            }
        }


        // Fetch everything concurrently
        const promises = [
            restaurantRef.collection('menu').where('isAvailable', '==', true).orderBy('order', 'asc').get(),
            generalCouponsQuery.get()
        ];
        
        // If a customer ID (UID) is found, also fetch their specific coupons
        if (customerId) {
            const customerCouponsQuery = couponsRef.where('status', '==', 'Active').where('customerId', '==', customerId);
            promises.push(customerCouponsQuery.get());
        }

        const [menuSnap, generalCouponsSnap, customerCouponsSnap] = await Promise.all(promises);

        const restaurantData = restaurantDoc.data();
        const restaurantName = restaurantData.name;
        const deliveryCharge = restaurantData.deliveryCharge || 30;
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
