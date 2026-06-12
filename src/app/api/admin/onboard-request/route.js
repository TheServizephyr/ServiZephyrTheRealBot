import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyAdmin } from '@/lib/verify-admin';
import { invalidateFoodSearchCache } from '@/services/public/foodSearch.service';

export const dynamic = 'force-dynamic';

// GET all onboarding requests
export async function GET(req) {
    try {
        await verifyAdmin(req);
        const firestore = await getFirestore();

        const snapshot = await firestore.collection('onboarding_requests').get();
        const requests = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            const createdAt = data.createdAt?.toDate?.()?.toISOString() || null;
            const approvedAt = data.approvedAt?.toDate?.()?.toISOString() || null;
            const rejectedAt = data.rejectedAt?.toDate?.()?.toISOString() || null;

            requests.push({
                id: doc.id,
                ...data,
                createdAt,
                approvedAt,
                rejectedAt
            });
        });

        // Sort by createdAt desc in JavaScript to avoid Firestore index errors
        requests.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        return NextResponse.json({ success: true, requests }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/onboard-request ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

// POST approve or reject onboarding requests
export async function POST(req) {
    try {
        await verifyAdmin(req);
        const firestore = await getFirestore();

        const body = await req.json().catch(() => ({}));
        const {
            requestId,
            action,
            city = '',
            restaurantName,
            whatsappNumber,
            cuisines,
            location,
            menuUrls
        } = body;

        if (!requestId || !action) {
            return NextResponse.json({ message: 'requestId and action are required.' }, { status: 400 });
        }

        if (!['approve', 'reject'].includes(action)) {
            return NextResponse.json({ message: "Invalid action. Must be 'approve' or 'reject'." }, { status: 400 });
        }

        const requestDocRef = firestore.collection('onboarding_requests').doc(requestId);
        const requestDoc = await requestDocRef.get();

        if (!requestDoc.exists) {
            return NextResponse.json({ message: 'Onboarding request not found.' }, { status: 404 });
        }

        const requestData = requestDoc.data();

        if (requestData.status !== 'pending') {
            return NextResponse.json({ message: `Request has already been processed. Current status: ${requestData.status}` }, { status: 400 });
        }

        if (action === 'reject') {
            await requestDocRef.update({
                status: 'rejected',
                rejectedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            return NextResponse.json({
                success: true,
                message: 'Onboarding request rejected successfully.'
            }, { status: 200 });
        }

        // Action is 'approve'
        const finalName = (restaurantName || requestData.restaurantName || '').trim();
        const finalPhone = (whatsappNumber || requestData.whatsappNumber || '').trim();
        
        if (!finalName) {
            return NextResponse.json({ message: 'Restaurant name is required for approval.' }, { status: 400 });
        }
        if (!finalPhone) {
            return NextResponse.json({ message: 'WhatsApp number is required for approval.' }, { status: 400 });
        }

        const finalLocation = {
            formattedAddress: (location?.formattedAddress || requestData.location?.formattedAddress || '').trim(),
            latitude: Number(location?.latitude ?? requestData.location?.latitude ?? 0),
            longitude: Number(location?.longitude ?? requestData.location?.longitude ?? 0),
            placeId: (location?.placeId || requestData.location?.placeId || '').trim()
        };

        if (!finalLocation.formattedAddress || !finalLocation.latitude || !finalLocation.longitude || !finalLocation.placeId) {
            return NextResponse.json({ message: 'A valid Google Maps location (address, coordinates, placeId) is required for approval.' }, { status: 400 });
        }

        const finalCuisines = cuisines || requestData.cuisines || [];
        const finalReferral = requestData.referralSource || 'Other';
        const finalMenuUrls = menuUrls || requestData.menuUrls || [];

        // Generate slug
        const baseSlug = finalName
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const slug = `${baseSlug}-${randomNum}`;

        // Generate claimToken
        const tokenDigits = Math.floor(100000 + Math.random() * 900000);
        const claimToken = `SZ-${tokenDigits}`;

        // Create the restaurant listing
        const newRestaurant = {
            name: finalName,
            phone: finalPhone,
            slug,
            isClaimed: false,
            ownerId: null,
            claimToken,
            isPublished: true,
            approvalStatus: 'approved',
            profileViewCount: 0,
            searchCount: 0,
            appearanceCount: 0,
            addressText: finalLocation.formattedAddress,
            address: {
                street: finalLocation.formattedAddress,
                city: (city || 'delhi').trim().toLowerCase(), // Default to delhi if city is not selected
                latitude: finalLocation.latitude,
                longitude: finalLocation.longitude
            },
            coordinates: {
                lat: finalLocation.latitude,
                lng: finalLocation.longitude
            },
            cuisines: finalCuisines,
            referralSource: finalReferral,
            menuUrls: finalMenuUrls,
            onboardingRequestId: requestId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        const restaurantDocRef = firestore.collection('restaurants').doc();
        await restaurantDocRef.set(newRestaurant);

        // Update the onboarding request status
        await requestDocRef.update({
            status: 'approved',
            restaurantId: restaurantDocRef.id,
            approvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        // Invalidate public search cache
        invalidateFoodSearchCache();

        return NextResponse.json({
            success: true,
            message: 'Onboarding request approved and restaurant listing created successfully!',
            restaurantId: restaurantDocRef.id,
            claimToken
        }, { status: 200 });

    } catch (error) {
        console.error("POST /api/admin/onboard-request ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
