

import { NextResponse } from 'next/server';

import { getAuth, FieldValue } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';


// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // Admin impersonation logic
    const url = new URL(req.headers.get('referer'));
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
    } else if (userRole !== 'owner' && userRole !== 'restaurant-owner' && userRole !== 'shop-owner') {
        throw { message: 'Access Denied: You do not have sufficient privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!restaurantsQuery.empty) {
        const doc = restaurantsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, collectionName: 'restaurants', isAdmin: userRole === 'admin' };
    }

    const shopsQuery = await firestore.collection('shops').where('ownerId', '==', targetOwnerId).limit(1).get();
    if (!shopsQuery.empty) {
        const doc = shopsQuery.docs[0];
        return { uid: targetOwnerId, businessId: doc.id, collectionName: 'shops', isAdmin: userRole === 'admin' };
    }
    
    throw { message: 'No business associated with this owner.', status: 404 };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);

        const couponsRef = firestore.collection(collectionName).doc(businessId).collection('coupons');
        const couponsSnap = await couponsRef.orderBy('expiryDate', 'desc').get();
        
        let coupons = couponsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return NextResponse.json({ coupons }, { status: 200 });

    } catch (error) {
        console.error("GET COUPONS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { coupon } = await req.json();

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
            value: isFreeDelivery ? 0 : Number(coupon.value), // Ensure value is 0 for free delivery
            createdAt: FieldValue.serverTimestamp(),
            startDate: firestore.Timestamp.fromDate(new Date(coupon.startDate)),
            expiryDate: firestore.Timestamp.fromDate(new Date(coupon.expiryDate)),
        };

        await newCouponRef.set(newCouponData);

        return NextResponse.json({ message: 'Coupon created successfully!', id: newCouponRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { coupon } = await req.json();

        if (!coupon || !coupon.id) {
            return NextResponse.json({ message: 'Coupon ID is required for updating.' }, { status: 400 });
        }

        const couponRef = firestore.collection(collectionName).doc(businessId).collection('coupons').doc(coupon.id);
        
        const { id, timesUsed, createdAt, ...updateData } = coupon;

        if (updateData.type === 'free_delivery') {
            updateData.value = 0;
        } else {
             updateData.value = Number(updateData.value);
        }
        
        if (updateData.startDate) {
            updateData.startDate = firestore.Timestamp.fromDate(new Date(updateData.startDate));
        }
        if (updateData.expiryDate) {
            updateData.expiryDate = firestore.Timestamp.fromDate(new Date(updateData.expiryDate));
        }

        await couponRef.update(updateData);

        return NextResponse.json({ message: 'Coupon updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function DELETE(req) {
    try {
        const auth = getAuth();
        const firestore = getFirestore();
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
