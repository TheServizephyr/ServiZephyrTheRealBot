import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const firestore = await getFirestore();

        const body = await req.json();
        const { restaurantName, whatsappNumber, location, cuisines, referralSource, menuUrls } = body;

        // Validation checks
        if (!restaurantName || !String(restaurantName).trim()) {
            return NextResponse.json({ message: 'Restaurant name is required.' }, { status: 400 });
        }

        if (!whatsappNumber || !String(whatsappNumber).trim()) {
            return NextResponse.json({ message: 'WhatsApp number is required.' }, { status: 400 });
        }

        if (!location || !location.formattedAddress || typeof location.latitude !== 'number' || typeof location.longitude !== 'number' || !location.placeId) {
            return NextResponse.json({ message: 'A valid Google Maps location is required.' }, { status: 400 });
        }

        if (!menuUrls || !Array.isArray(menuUrls) || menuUrls.length === 0) {
            return NextResponse.json({ message: 'At least one menu file (image/PDF) must be uploaded.' }, { status: 400 });
        }

        // Prepare the onboarding request document
        const onboardingRequest = {
            restaurantName: String(restaurantName).trim(),
            whatsappNumber: String(whatsappNumber).trim(),
            location: {
                formattedAddress: String(location.formattedAddress).trim(),
                latitude: Number(location.latitude),
                longitude: Number(location.longitude),
                placeId: String(location.placeId).trim(),
            },
            cuisines: Array.isArray(cuisines) ? cuisines.map(c => String(c).trim()) : [],
            referralSource: referralSource ? String(referralSource).trim() : 'Other',
            menuUrls: menuUrls.map(url => String(url).trim()),
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
        };

        const docRef = await firestore.collection('onboarding_requests').add(onboardingRequest);

        return NextResponse.json({
            success: true,
            id: docRef.id,
            message: 'Onboarding request submitted successfully!'
        }, { status: 200 });

    } catch (error) {
        console.error("ONBOARDING REQUEST SUBMISSION ERROR:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
