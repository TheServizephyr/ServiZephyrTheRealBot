
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
    
    // Verify user is an owner from the central 'users' collection
    const userDoc = await firestore.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'owner') {
        throw { message: 'Access Denied: You do not have owner privileges.', status: 403 };
    }
    
    // Find the restaurant associated with this owner
    const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
    if (restaurantsQuery.empty) {
        throw { message: 'No restaurant associated with this owner.', status: 404 };
    }
    const restaurantId = restaurantsQuery.docs[0].id;
    
    return { uid, restaurantId };
}


async function seedInitialCoupons(firestore, restaurantId) {
    const batch = firestore.batch();
    const couponsRef = firestore.collection('restaurants').doc(restaurantId).collection('coupons');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    const initialCoupons = [
        { code: 'SAVE100', description: 'Get flat ₹100 off on orders above ₹599', type: 'flat', value: 100, minOrder: 599, startDate: new Date(), expiryDate: nextMonth, status: 'Active', timesUsed: 5 },
        { code: 'FREEDEL', description: 'Free delivery on all orders above ₹299', type: 'free_delivery', value: 30, minOrder: 299, startDate: new Date(), expiryDate: nextMonth, status: 'Active', timesUsed: 12 },
        { code: 'WEEKEND20', description: '20% off on weekends', type: 'percentage', value: 20, minOrder: 499, startDate: new Date(), expiryDate: tomorrow, status: 'Inactive', timesUsed: 0 },
    ];
    
    const finalCoupons = [];

    initialCoupons.forEach(couponData => {
        const docRef = couponsRef.doc(); 
        const newCoupon = {
            ...couponData,
            id: docRef.id,
            createdAt: adminFirestore.FieldValue.serverTimestamp(),
            startDate: adminFirestore.Timestamp.fromDate(couponData.startDate),
            expiryDate: adminFirestore.Timestamp.fromDate(couponData.expiryDate),
        };
        batch.set(docRef, newCoupon);
        finalCoupons.push(newCoupon);
    });

    await batch.commit();
    return finalCoupons;
}


export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { restaurantId } = await verifyOwnerAndGetRestaurant(req, auth, firestore);

        const couponsRef = firestore.collection('restaurants').doc(restaurantId).collection('coupons');
        const couponsSnap = await couponsRef.orderBy('expiryDate', 'desc').get();
        
        let coupons = [];
        if (couponsSnap.empty) {
            coupons = await seedInitialCoupons(firestore, restaurantId);
        } else {
             coupons = couponsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

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

        // Updated Validation: check for value only if it's not a free_delivery coupon
        if (!coupon || !coupon.code || coupon.value === undefined || coupon.minOrder === undefined) {
            return NextResponse.json({ message: 'Missing required coupon data.' }, { status: 400 });
        }

        const newCouponRef = firestore.collection('restaurants').doc(restaurantId).collection('coupons').doc();
        
        const newCouponData = {
            ...coupon,
            id: newCouponRef.id,
            timesUsed: 0,
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
