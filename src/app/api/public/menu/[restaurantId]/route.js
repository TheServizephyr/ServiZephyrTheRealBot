

import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

async function fetchBusinessData(firestore, restaurantId) {
    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const docRef = firestore.collection(collectionName).doc(restaurantId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return {
                businessData: docSnap.data(),
                businessRef: docRef,
                collectionName: collectionName
            };
        }
    }
    return null; // Return null if not found in any collection
}

export async function GET(req, { params }) {
    const { restaurantId } = params;
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');

    try {
        const firestore = await getFirestore();

        const businessInfo = await fetchBusinessData(firestore, restaurantId);

        if (!businessInfo) {
            return NextResponse.json({ message: "Restaurant not found." }, { status: 404 });
        }
        
        const { businessData, businessRef, collectionName } = businessInfo;

        if (businessData.approvalStatus !== 'approved' && businessData.approvalStatus !== 'active') {
             return NextResponse.json({ message: 'This establishment is not currently approved to take orders.' }, { status: 403 });
        }
        
        const menuSnap = await businessRef.collection('menu').where('isAvailable', '==', true).get();
        const couponsSnap = await businessRef.collection('coupons').where('status', '==', 'Active').get();
        
        const menu = {};
        menuSnap.docs.forEach(doc => {
            const item = doc.data();
            const category = item.categoryId || 'general';
            if (!menu[category]) {
                menu[category] = [];
            }
            menu[category].push({ id: doc.id, ...item });
        });
        
        Object.keys(menu).forEach(key => {
            menu[key].sort((a, b) => (a.order || 999) - (b.order || 999));
        });

        const now = new Date();
        const allCoupons = couponsSnap.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(coupon => {
                const startDate = coupon.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon.startDate);
                const expiryDate = coupon.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon.expiryDate);
                return startDate <= now && expiryDate >= now;
            });
            
        let customerCoupons = [];
        let loyaltyPoints = 0;
        
        if (phone) {
            const normalizedPhone = phone.length > 10 ? phone.slice(-10) : phone;
            const customerRef = businessRef.collection('customers').doc(normalizedPhone);
            const customerSnap = await customerRef.get();
            if (customerSnap.exists) {
                loyaltyPoints = customerSnap.data().loyaltyPoints || 0;
                
                // Fetch customer-specific coupons if they exist
                 const customerCouponsSnap = await businessRef.collection('coupons').where('customerId', '==', normalizedPhone).get();
                 customerCouponsSnap.forEach(doc => {
                    const coupon = { id: doc.id, ...doc.data() };
                     const startDate = coupon.startDate?.toDate ? coupon.startDate.toDate() : new Date(coupon.startDate);
                    const expiryDate = coupon.expiryDate?.toDate ? coupon.expiryDate.toDate() : new Date(coupon.expiryDate);
                    if(startDate <= now && expiryDate >= now && coupon.status === 'Active') {
                       customerCoupons.push(coupon);
                    }
                 });
            }
        }
        
        const publicCoupons = allCoupons.filter(c => !c.customerId);

        return NextResponse.json({
            restaurantName: businessData.name,
            logoUrl: businessData.logoUrl,
            bannerUrls: businessData.bannerUrls,
            menu,
            coupons: [...publicCoupons, ...customerCoupons],
            loyaltyPoints,
            deliveryCharge: businessData.deliveryCharge || 0,
            deliveryFreeThreshold: businessData.deliveryFreeThreshold || null,
            businessAddress: businessData.address || null,
            businessType: businessData.businessType || collectionName.slice(0, -1),
            approvalStatus: businessData.approvalStatus,
            deliveryEnabled: businessData.deliveryEnabled,
            pickupEnabled: businessData.pickupEnabled,
            dineInEnabled: businessData.dineInEnabled,
            dineInModel: businessData.dineInModel,
        }, { status: 200 });

    } catch (error) {
        console.error(`[API PUBLIC MENU] Error for restaurant ${restaurantId}:`, error);
        return NextResponse.json({ message: `An unexpected error occurred: ${error.message}` }, { status: 500 });
    }
}
