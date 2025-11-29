// Test if indexes are working
import { getFirestore } from '@/lib/firebase-admin';

export async function GET() {
    const firestore = await getFirestore();
    const startTime = Date.now();

    try {
        // Test 1: User phone lookup (Collection query)
        const userStart = Date.now();
        const userQuery = await firestore
            .collection('users')
            .where('phone', '==', '+919876543210')
            .limit(1)
            .get();
        const userTime = Date.now() - userStart;

        // Test 2: Active coupons (Subcollection query)
        const couponStart = Date.now();
        const couponQuery = await firestore
            .collection('street_vendors')
            .doc('baaghi-chai')
            .collection('coupons')
            .where('status', '==', 'Active')
            .get();
        const couponTime = Date.now() - couponStart;

        // Test 3: Menu items - NO FILTER (just get all - no index needed!)
        const menuStart = Date.now();
        const menuQuery = await firestore
            .collection('street_vendors')
            .doc('baaghi-chai')
            .collection('menu')
            .get(); // No where clause!
        const menuTime = Date.now() - menuStart;

        const totalTime = Date.now() - startTime;

        return Response.json({
            success: true,
            indexStatus: {
                userPhoneIndex: {
                    queryTime: `${userTime}ms`,
                    status: userTime < 100 ? '✅ FAST (Indexed)' : '⚠️ SLOW (No Index)',
                    ready: userTime < 100
                },
                couponStatusIndex: {
                    queryTime: `${couponTime}ms`,
                    status: couponTime < 100 ? '✅ FAST (Indexed)' : '⚠️ SLOW (No Index)',
                    ready: couponTime < 100
                },
                menuFetchTime: {
                    queryTime: `${menuTime}ms`,
                    status: menuTime < 200 ? '✅ FAST' : '⚠️ SLOW',
                    ready: menuTime < 200,
                    note: 'No index needed - fetching all items'
                }
            },
            totalTime: `${totalTime}ms`,
            allIndexesReady: userTime < 100 && couponTime < 100
        });

    } catch (error) {
        return Response.json({
            success: false,
            error: error.message,
            note: 'If error mentions "requires an index", indexes are not ready yet'
        }, { status: 500 });
    }
}
