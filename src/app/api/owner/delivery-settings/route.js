
import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid, getDatabase } from '@/lib/firebase-admin';
import { verifyEmployeeAccess } from '@/lib/verify-employee-access';

export const dynamic = 'force-dynamic';

async function verifyUserAndGetData(req) {
    const firestore = await getFirestore();
    const uid = await verifyAndGetUid(req);

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');

    const adminUserDoc = await firestore.collection('users').doc(uid).get();
    if (!adminUserDoc.exists) throw { message: 'User profile not found.', status: 404 };
    const adminUserData = adminUserDoc.data();

    let finalUserId = uid;

    if (adminUserData.role === 'admin' && impersonatedOwnerId) {
        finalUserId = impersonatedOwnerId;
    } else if (employeeOfOwnerId) {
        const accessResult = await verifyEmployeeAccess(uid, employeeOfOwnerId, adminUserData);
        if (!accessResult.authorized) throw { message: 'Access Denied.', status: 403 };
        finalUserId = employeeOfOwnerId;
    }

    const userRef = firestore.collection('users').doc(finalUserId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw { message: "User profile not found.", status: 404 };

    const userData = userDoc.data();
    let businessRef = null;
    let businessId = null;

    // Resolve Business
    let collectionsToTry = [];
    const userBusinessType = userData.businessType;
    if (userBusinessType === 'restaurant') collectionsToTry = ['restaurants'];
    else if (userBusinessType === 'shop') collectionsToTry = ['shops'];
    else if (userBusinessType === 'street-vendor') collectionsToTry = ['street_vendors'];
    else collectionsToTry = ['restaurants', 'shops', 'street_vendors'];

    for (const collectionName of collectionsToTry) {
        const businessesQuery = await firestore.collection(collectionName).where('ownerId', '==', finalUserId).limit(1).get();
        if (!businessesQuery.empty) {
            const businessDoc = businessesQuery.docs[0];
            businessRef = businessDoc.ref;
            businessId = businessDoc.id;
            break;
        }
    }

    if (!businessRef) throw { message: "Business not found", status: 404 };

    return { businessRef, businessId };
}

export async function GET(req) {
    try {
        const { businessRef } = await verifyUserAndGetData(req);

        // Fetch from sub-collection
        const configDoc = await businessRef.collection('delivery_settings').doc('config').get();

        let settings = {};
        if (configDoc.exists) {
            settings = configDoc.data();
        } else {
            // Fallback: Read from parent doc if migration hasn't run yet?
            // Or return defaults. Let's return defaults + parent doc fallback if essential.
            // For now, assume migration populated it or return defaults.
            const parentDoc = await businessRef.get();
            const parentData = parentDoc.data();

            settings = {
                deliveryEnabled: parentData.deliveryEnabled ?? true,
                deliveryRadius: parentData.deliveryRadius ?? 5,
                deliveryFeeType: parentData.deliveryFeeType ?? 'fixed',
                deliveryFixedFee: parentData.deliveryFixedFee ?? 30,
                deliveryPerKmFee: parentData.deliveryPerKmFee ?? 5,
                deliveryFreeThreshold: parentData.deliveryFreeThreshold ?? 500,
                deliveryOnlinePaymentEnabled: parentData.deliveryOnlinePaymentEnabled ?? true,
                deliveryCodEnabled: parentData.deliveryCodEnabled ?? true,
                // NEW: Road factor & free zone
                roadDistanceFactor: parentData.roadDistanceFactor ?? 1.0,
                freeDeliveryRadius: parentData.freeDeliveryRadius ?? 0,
                freeDeliveryMinOrder: parentData.freeDeliveryMinOrder ?? 0,
                // NEW: Tiered charges
                deliveryTiers: parentData.deliveryTiers ?? [],
            };
        }

        return NextResponse.json(settings);

    } catch (error) {
        console.error("GET DELIVERY SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const { businessRef, businessId } = await verifyUserAndGetData(req);
        const updates = await req.json();

        // Whitelist allowed fields to prevent pollution
        const allowedFields = [
            'deliveryEnabled', 'deliveryRadius', 'deliveryFeeType',
            'deliveryFixedFee', 'deliveryPerKmFee', 'deliveryFreeThreshold',
            'deliveryOnlinePaymentEnabled', 'deliveryCodEnabled',
            // NEW: Road factor & free zone
            'roadDistanceFactor', 'freeDeliveryRadius', 'freeDeliveryMinOrder',
            // NEW: Tiered charges
            'deliveryTiers'
        ];

        const cleanUpdates = {};
        allowedFields.forEach(field => {
            if (updates[field] !== undefined) cleanUpdates[field] = updates[field];
        });

        cleanUpdates.updatedAt = new Date();

        await businessRef.collection('delivery_settings').doc('config').set(cleanUpdates, { merge: true });

        // ✅ CRITICAL: Increment menuVersion to invalidate public menu cache
        // We fetch the current business doc to get the current version
        const businessSnap = await businessRef.get();
        const businessData = businessSnap.data() || {};

        await businessRef.update({
            menuVersion: (businessData.menuVersion || 0) + 1,
            updatedAt: new Date()
        });

        // Invalidate menu cache (legacy key)
        try {
            const { kv } = await import('@vercel/kv');
            if (process.env.KV_REST_API_URL) {
                await kv.del(`menu:${businessId}`);
                console.log(`[Delivery Settings] 🧹 Invalidated cache for ${businessId}`);
            }
        } catch (e) {
            console.warn("Cache invalidation failed", e);
        }

        return NextResponse.json({ success: true, message: "Delivery settings updated" });

    } catch (error) {
        console.error("PATCH DELIVERY SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
