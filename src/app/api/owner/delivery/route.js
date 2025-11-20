

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';

// Helper to verify owner and get their first business ID
async function verifyOwnerAndGetBusiness(req, auth, firestore) {
    const uid = await verifyAndGetUid(req); // Use central helper
    
    // --- ADMIN IMPERSONATION & PERMISSION LOGIC ---
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
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
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

        const boysRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys');
        const ordersRef = firestore.collection('orders').where('restaurantId', '==', businessId);

        const [boysSnap, readyOrdersSnap] = await Promise.all([
            boysRef.get(),
            ordersRef.where('status', '==', 'preparing').get()
        ]);
        
        let boys = [];
        const riderPromises = boysSnap.docs.map(async (doc) => {
            const subCollectionData = { id: doc.id, ...doc.data() };
            
            const driverDocRef = firestore.collection('drivers').doc(subCollectionData.id);
            const driverDoc = await driverDocRef.get();
            let finalBoyData = { ...subCollectionData };

            if (driverDoc.exists) {
                const mainDriverData = driverDoc.data();
                // Merge main data, but prioritize subcollection data if it exists (e.g., historical stats)
                finalBoyData = { ...mainDriverData, ...subCollectionData };
                
                // Map Firestore statuses ('online', 'offline', 'on-delivery') to UI statuses ('Available', 'Inactive', 'On Delivery')
                switch (mainDriverData.status) {
                    case 'online':
                        finalBoyData.status = 'Available';
                        break;
                    case 'on-delivery':
                        finalBoyData.status = 'On Delivery';
                        break;
                    case 'offline':
                    default:
                        finalBoyData.status = 'Inactive';
                        break;
                }
            }
            return finalBoyData;
        });

        boys = await Promise.all(riderPromises);

        const readyOrders = readyOrdersSnap.docs.map(doc => ({
            id: doc.id,
            customer: doc.data().customerName,
            items: (doc.data().items || []).length
        }));
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const deliveredOrdersSnap = await ordersRef
            .where('status', '==', 'delivered')
            .where('orderDate', '>=', today)
            .get();

        const deliveriesByBoy = {};
        deliveredOrdersSnap.docs.forEach(doc => {
            const orderData = doc.data();
            if (orderData.deliveryBoyId) {
                deliveriesByBoy[orderData.deliveryBoyId] = (deliveriesByBoy[orderData.deliveryBoyId] || 0) + 1;
            }
        });

        boys = boys.map(boy => ({
            ...boy,
            deliveriesToday: deliveriesByBoy[boy.id] || 0
        }));

        const performance = {
            totalDeliveries: boys.reduce((sum, boy) => sum + (boy.deliveriesToday || 0), 0),
            avgDeliveryTime: boys.length > 0 ? Math.round(boys.reduce((sum, boy) => sum + (boy.avgDeliveryTime || 0), 0) / boys.length) : 0,
            topPerformer: boys.length > 0 ? boys.reduce((top, boy) => ((boy.deliveriesToday || 0) > (top.deliveriesToday || 0)) ? boy : top, boys[0]) : {},
        };
        
        const weeklyPerformance = Array.from({length: 7}, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (6-i));
            return {
                day: date.toLocaleDateString('en-IN', { weekday: 'short'}),
                deliveries: 0 
            };
        });

        return NextResponse.json({ boys, performance, readyOrders, weeklyPerformance }, { status: 200 });

    } catch (error) {
        console.error("GET DELIVERY DATA ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { boy } = await req.json();

        if (!boy || !boy.name || !boy.phone) {
            return NextResponse.json({ message: 'Missing required delivery boy data.' }, { status: 400 });
        }

        const newBoyRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys').doc();
        
        const newBoyData = {
            ...boy,
            id: newBoyRef.id,
            status: 'Inactive',
            location: null,
            deliveriesToday: 0,
            totalDeliveries: 0,
            avgDeliveryTime: 0,
            avgRating: 0,
            createdAt: FieldValue.serverTimestamp(),
        };

        await newBoyRef.set(newBoyData);

        return NextResponse.json({ message: 'Delivery Boy added successfully!', id: newBoyRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST DELIVERY BOY ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerAndGetBusiness(req, auth, firestore);
        const { boy } = await req.json();

        if (!boy || !boy.id) {
            return NextResponse.json({ message: 'Boy ID is required for updating.' }, { status: 400 });
        }

        const boyRef = firestore.collection(collectionName).doc(businessId).collection('deliveryBoys').doc(boy.id);
        const { id, ...updateData } = boy;

        // Note: The main driver's status is handled separately by the rider's device.
        // This PATCH should only affect the status WITHIN the restaurant's context if needed.
        // For simplicity, we are removing direct manipulation of the main 'drivers' collection status here.
        
        await boyRef.update(updateData);

        return NextResponse.json({ message: 'Delivery Boy updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH DELIVERY BOY ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
