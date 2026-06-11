import { NextResponse } from 'next/server';
import { getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';
import { invalidateFoodSearchCache } from '@/services/public/foodSearch.service';

export async function POST(req) {
    try {
        // 1. Verify user is logged in and get UID
        const uid = await verifyAndGetUid(req);

        // 2. Parse request body
        const body = await req.json().catch(() => ({}));
        const { phone, claimToken } = body;

        if (!phone || typeof phone !== 'string' || !phone.trim()) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }
        if (!claimToken || typeof claimToken !== 'string' || !claimToken.trim()) {
            return NextResponse.json({ error: 'Claim token is required' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // 3. Find unclaimed business matching phone and claimToken
        const collections = ['restaurants', 'shops', 'street_vendors'];
        let matchedDoc = null;
        let matchedCollection = '';

        const cleanPhone = phone.trim();
        const cleanToken = claimToken.trim();

        for (const colName of collections) {
            const snap = await firestore.collection(colName)
                .where('phone', '==', cleanPhone)
                .where('claimToken', '==', cleanToken)
                .limit(1)
                .get();

            if (!snap.empty) {
                // Verify it hasn't been claimed yet
                const doc = snap.docs[0];
                const data = doc.data();
                if (data.ownerId || data.isClaimed === true) {
                    return NextResponse.json({ error: 'This restaurant profile has already been claimed.' }, { status: 409 });
                }
                matchedDoc = doc;
                matchedCollection = colName;
                break;
            }
        }

        if (!matchedDoc) {
            return NextResponse.json({ error: 'Invalid phone number or claim token. Please verify and try again.' }, { status: 400 });
        }

        const businessId = matchedDoc.id;
        const businessData = matchedDoc.data();
        const businessType = businessData.businessType || (matchedCollection === 'shops' ? 'store' : matchedCollection === 'street_vendors' ? 'street-vendor' : 'restaurant');

        // 4. Update restaurant and user docs atomically in a transaction
        await firestore.runTransaction(async (transaction) => {
            // Update business document
            transaction.update(matchedDoc.ref, {
                ownerId: uid,
                isClaimed: true,
                updatedAt: FieldValue.serverTimestamp()
            });

            // Update user document
            const userRef = firestore.collection('users').doc(uid);
            transaction.set(userRef, {
                role: 'owner',
                businessId: businessId,
                businessType: businessType,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        });

        // 5. Invalidate the global search cache
        invalidateFoodSearchCache();

        return NextResponse.json({
            success: true,
            message: 'Restaurant profile claimed successfully! Welcome aboard.',
            businessId,
            businessType
        }, { status: 200 });

    } catch (error) {
        console.error('POST /api/owner/claim-restaurant error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            message: error.message
        }, { status: 500 });
    }
}
