
import { NextResponse } from 'next/server';
import { getAuth, FieldValue, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';


// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper

    // Admin impersonation logic
    const url = new URL(req.url, `http://${req.headers.host}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access Denied: User profile not found.', status: 403 };
    }

    const userData = userDoc.data();
    const userRole = userData.role;

    let targetOwnerId = uid;
    if (userRole === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is managing data for owner ${impersonatedOwnerId}.`);
        targetOwnerId = impersonatedOwnerId;
    } else if (!['owner', 'restaurant-owner', 'shop-owner', 'street-vendor'].includes(userRole)) {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }

    const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
    for (const collectionName of collectionsToTry) {
        const query = await firestore.collection(collectionName).where('ownerId', '==', targetOwnerId).limit(1).get();
        if (!query.empty) {
            const doc = query.docs[0];
            return { uid: targetOwnerId, businessId: doc.id, collectionName: collectionName, isAdmin: userRole === 'admin' };
        }
    }

    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        console.log('[COUPON API GET] Fetching coupons for:', { businessId, collectionName });

        const couponsRef = firestore.collection(collectionName).doc(businessId).collection('coupons');
        const couponsSnap = await couponsRef.orderBy('expiryDate', 'desc').get();

        console.log('[COUPON API GET] Found', couponsSnap.size, 'coupons');

        let coupons = couponsSnap.docs.map((doc, index) => {
            const data = { id: doc.id, ...doc.data() };
            console.log(`[COUPON API GET] Coupon ${index}:`, JSON.stringify(data, null, 2));
            console.log(`[COUPON API GET] Coupon ${index} startDate:`, data.startDate);
            console.log(`[COUPON API GET] Coupon ${index} expiryDate:`, data.expiryDate);
            return data;
        });

        console.log('[COUPON API GET] Returning coupons to frontend');
        return NextResponse.json({ coupons }, { status: 200 });

    } catch (error) {
        console.error("GET COUPONS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { coupon } = await req.json();

        console.log('[COUPON API POST] Received coupon data:', JSON.stringify(coupon, null, 2));
        console.log('[COUPON API POST] startDate received:', coupon.startDate);
        console.log('[COUPON API POST] expiryDate received:', coupon.expiryDate);

        // Updated Validation
        const isFreeDelivery = coupon.type === 'free_delivery';
        if (!coupon || !coupon.code || coupon.minOrder === undefined || (!isFreeDelivery && coupon.value === undefined)) {
            return NextResponse.json({ message: 'Missing required coupon data.' }, { status: 400 });
        }

        const couponsCollectionRef = firestore.collection(collectionName).doc(businessId).collection('coupons');
        const newCouponRef = couponsCollectionRef.doc();

        const newCouponData = {
            ...coupon,
            id: newCouponRef.id,
            timesUsed: 0,
            value: isFreeDelivery ? 0 : Number(coupon.value),
            createdAt: FieldValue.serverTimestamp(),
            startDate: new Date(coupon.startDate),
            expiryDate: new Date(coupon.expiryDate),
        };

        console.log('[COUPON API POST] Saving to Firestore:', JSON.stringify(newCouponData, null, 2));
        console.log('[COUPON API POST] startDate converted to Date:', newCouponData.startDate);
        console.log('[COUPON API POST] expiryDate converted to Date:', newCouponData.expiryDate);
        console.log('[COUPON API POST] Path:', `${collectionName}/${businessId}/coupons/${newCouponRef.id}`);

        await newCouponRef.set(newCouponData);

        console.log('[COUPON API POST] Successfully saved coupon with ID:', newCouponRef.id);
        return NextResponse.json({ message: 'Coupon created successfully!', id: newCouponRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { coupon } = await req.json();

        console.log('[COUPON API PATCH] Received coupon update:', JSON.stringify(coupon, null, 2));

        if (!coupon || !coupon.id) {
            return NextResponse.json({ message: 'Coupon ID is required for updating.' }, { status: 400 });
        }

        const couponRef = firestore.collection(collectionName).doc(businessId).collection('coupons').doc(coupon.id);

        const { id, timesUsed, createdAt, ...updateData } = coupon;

        console.log('[COUPON API PATCH] Update data before processing:', JSON.stringify(updateData, null, 2));

        if (updateData.type === 'free_delivery') {
            updateData.value = 0;
        } else {
            updateData.value = Number(updateData.value);
        }

        if (updateData.startDate) {
            updateData.startDate = new Date(updateData.startDate);
            console.log('[COUPON API PATCH] startDate converted:', updateData.startDate);
        }
        if (updateData.expiryDate) {
            updateData.expiryDate = new Date(updateData.expiryDate);
            console.log('[COUPON API PATCH] expiryDate converted:', updateData.expiryDate);
        }

        console.log('[COUPON API PATCH] Final update data:', JSON.stringify(updateData, null, 2));
        console.log('[COUPON API PATCH] Path:', `${collectionName}/${businessId}/coupons/${coupon.id}`);

        await couponRef.update(updateData);

        console.log('[COUPON API PATCH] Successfully updated coupon');
        return NextResponse.json({ message: 'Coupon updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function DELETE(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { couponId } = await req.json();

        if (!couponId) {
            return NextResponse.json({ message: 'Coupon ID is required.' }, { status: 400 });
        }

        const couponRef = firestore.collection(collectionName).doc(businessId).collection('coupons').doc(couponId);
        await couponRef.delete();

        return NextResponse.json({ message: 'Coupon deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("DELETE COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


