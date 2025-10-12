
import { NextResponse } from 'next/server';
import { firestore as adminFirestore } from 'firebase-admin';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// Helper to verify owner and get their first restaurant ID
async function verifyOwnerAndGetRestaurant(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // --- ADMIN IMPERSONATION LOGIC ---
    const url = new URL(req.url);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', impersonatedOwnerId).limit(1).get();
        if (restaurantsQuery.empty) {
            throw { message: 'Impersonated owner does not have an associated restaurant.', status: 404 };
        }
        const restaurantId = restaurantsQuery.docs[0].id;
        return { uid: impersonatedOwnerId, restaurantId, isAdmin: true };
    }
    // --- END ADMIN IMPERSONATION LOGIC ---
    
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    const restaurantId = restaurantsQuery.docs[0].id;
    
    return { uid, restaurantId };
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

        const couponsRef = firestore.collection('restaurants').doc(restaurantId).collection('coupons');
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
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { coupon } = await req.json();

        // Updated Validation
        const isFreeDelivery = coupon.type === 'free_delivery';
        if (!coupon || !coupon.code || coupon.minOrder === undefined || (!isFreeDelivery && coupon.value === undefined)) {
            return NextResponse.json({ message: 'Missing required coupon data.' }, { status: 400 });
        }

        const couponsCollectionRef = firestore.collection('restaurants').doc(restaurantId).collection('coupons');
        const newCouponRef = couponsCollectionRef.doc();
        
        const newCouponData = {
            ...coupon,
            id: newCouponRef.id,
            timesUsed: 0,
            value: isFreeDelivery ? 0 : Number(coupon.value), // Ensure value is 0 for free delivery
            createdAt: adminFirestore.FieldValue.serverTimestamp(),
            startDate: adminFirestore.Timestamp.fromDate(new Date(coupon.startDate)),
            expiryDate: adminFirestore.Timestamp.fromDate(new Date(coupon.expiryDate)),
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
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { coupon } = await req.json();

        if (!coupon || !coupon.id) {
            return NextResponse.json({ message: 'Coupon ID is required for updating.' }, { status: 400 });
        }

        const couponRef = firestore.collection('restaurants').doc(restaurantId).collection('coupons').doc(coupon.id);
        
        const { id, timesUsed, createdAt, ...updateData } = coupon;

        if (updateData.type === 'free_delivery') {
            updateData.value = 0;
        } else {
             updateData.value = Number(updateData.value);
        }
        
        if (updateData.startDate) {
            updateData.startDate = adminFirestore.Timestamp.fromDate(new Date(updateData.startDate));
        }
        if (updateData.expiryDate) {
            updateData.expiryDate = adminFirestore.Timestamp.fromDate(new Date(updateData.expiryDate));
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
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);
        const { couponId } = await req.json();

        if (!couponId) {
            return NextResponse.json({ message: 'Coupon ID is required.' }, { status: 400 });
        }

        const couponRef = firestore.collection('restaurants').doc(restaurantId).collection('coupons').doc(couponId);
        await couponRef.delete();

        return NextResponse.json({ message: 'Coupon deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("DELETE COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
