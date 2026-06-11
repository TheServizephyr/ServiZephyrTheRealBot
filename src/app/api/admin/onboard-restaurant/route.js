import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyAdmin } from '@/lib/verify-admin';
import { getBusinessCollection } from '@/services/business/businessService';
import { invalidateFoodSearchCache } from '@/services/public/foodSearch.service';

export async function POST(req) {
    try {
        // 1. Verify Request is from an Admin
        await verifyAdmin(req);

        // 2. Parse request body
        const body = await req.json().catch(() => ({}));
        const {
            name,
            phone,
            addressText,
            city = '',
            coordinates,
            businessType = 'restaurant',
            menu = []
        } = body;

        // 3. Validation
        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }
        if (!phone || typeof phone !== 'string' || !phone.trim()) {
            return NextResponse.json({ error: 'Phone is required' }, { status: 400 });
        }
        if (!addressText || typeof addressText !== 'string' || !addressText.trim()) {
            return NextResponse.json({ error: 'Address text is required' }, { status: 400 });
        }
        if (!coordinates || typeof coordinates.lat !== 'number' || typeof coordinates.lng !== 'number') {
            return NextResponse.json({ error: 'Coordinates lat and lng are required and must be numbers' }, { status: 400 });
        }

        const firestore = await getFirestore();

        // 4. Generate random 6-digit claim token (e.g. SZ-892401)
        const tokenDigits = Math.floor(100000 + Math.random() * 900000);
        const claimToken = `SZ-${tokenDigits}`;

        // Get matching Firestore collection name
        const collectionName = getBusinessCollection(businessType);

        // 5. Structure Business Document
        const newBusinessData = {
            name: name.trim(),
            phone: phone.trim(),
            isClaimed: false,
            ownerId: null,
            claimToken,
            isPublished: true,
            approvalStatus: 'approved',
            profileViewCount: 0,
            searchCount: 0,
            appearanceCount: 0,
            addressText: addressText.trim(),
            address: {
                street: addressText.trim(),
                city: city.trim(),
                latitude: coordinates.lat,
                longitude: coordinates.lng
            },
            coordinates: {
                lat: coordinates.lat,
                lng: coordinates.lng
            },
            businessType,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        // Create the business document
        const businessDocRef = firestore.collection(collectionName).doc();
        await businessDocRef.set(newBusinessData);

        // 6. Onboard Menu Subcollection
        if (Array.isArray(menu) && menu.length > 0) {
            const batch = firestore.batch();
            const menuCollectionRef = businessDocRef.collection('menu');

            menu.forEach((item, index) => {
                const portions = Array.isArray(item.portions) && item.portions.length > 0
                    ? item.portions.map(p => ({
                        name: String(p.name || 'Regular'),
                        price: Number(p.price) || 0
                    }))
                    : [{ name: 'Regular', price: Number(item.price) || 0 }];

                const price = portions.length > 0 ? portions[0].price : (Number(item.price) || 0);

                const menuItemDocRef = menuCollectionRef.doc();
                batch.set(menuItemDocRef, {
                    id: menuItemDocRef.id,
                    name: String(item.name || 'Unnamed Dish').trim(),
                    description: String(item.description || '').trim(),
                    price,
                    portions,
                    isVeg: item.isVeg === true,
                    isAvailable: item.isAvailable !== false,
                    isDeleted: false,
                    categoryId: String(item.categoryId || 'general').trim().toLowerCase(),
                    order: index + 1,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            });

            await batch.commit();
        }

        // 7. Invalidate food search cache so it immediately loads new items
        invalidateFoodSearchCache();

        return NextResponse.json({
            success: true,
            restaurantId: businessDocRef.id,
            claimToken,
            message: 'Unclaimed business and menu onboarded successfully'
        }, { status: 201 });

    } catch (error) {
        console.error('POST /api/admin/onboard-restaurant error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            message: error.message
        }, { status: 500 });
    }
}
