
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import admin from 'firebase-admin';

// Helper to verify user and get UID
async function getUserId(req, auth) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken.uid;
}

// GET handler to fetch driver data
export async function GET(req) {
    console.log("[DEBUG] /api/rider/dashboard: GET request received.");
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const uid = await getUserId(req, auth);

        console.log(`[DEBUG] /api/rider/dashboard: Fetching driver data for UID: ${uid}`);
        const driverRef = firestore.collection('drivers').doc(uid);
        const driverDoc = await driverRef.get();

        if (!driverDoc.exists) {
            console.error(`[DEBUG] /api/rider/dashboard: Driver document not found for UID: ${uid}`);
            return NextResponse.json({ message: 'Rider profile not found.' }, { status: 404 });
        }

        const driverData = driverDoc.data();
        console.log(`[DEBUG] /api/rider/dashboard: Successfully fetched driver data for UID: ${uid}`);
        return NextResponse.json({ driver: driverData }, { status: 200 });

    } catch (error) {
        console.error("[DEBUG] /api/rider/dashboard: CRITICAL ERROR in GET:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}

// PATCH handler to update driver status or location
export async function PATCH(req) {
    console.log("[DEBUG] /api/rider/dashboard: PATCH request received.");
    try {
        const auth = getAuth();
        const firestore = getFirestore();
        const uid = await getUserId(req, auth);

        const { status, location } = await req.json();
        
        if (!status && !location) {
            return NextResponse.json({ message: 'Either status or location is required.' }, { status: 400 });
        }

        const driverRef = firestore.collection('drivers').doc(uid);
        const updateData = {};

        if (status) {
            console.log(`[DEBUG] /api/rider/dashboard: Updating status to '${status}' for UID: ${uid}`);
            updateData.status = status;
        }
        if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
            console.log(`[DEBUG] /api/rider/dashboard: Updating location for UID: ${uid}`);
            updateData.currentLocation = new admin.firestore.GeoPoint(location.latitude, location.longitude);
        }
        
        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ message: 'No valid data provided for update.' }, { status: 400 });
        }

        await driverRef.update(updateData);
        console.log(`[DEBUG] /api/rider/dashboard: Successfully updated driver profile for UID: ${uid}`);
        return NextResponse.json({ message: 'Profile updated successfully.' }, { status: 200 });

    } catch (error) {
        console.error("[DEBUG] /api/rider/dashboard: CRITICAL ERROR in PATCH:", error);
        return NextResponse.json({ message: error.message || 'Internal Server Error' }, { status: error.status || 500 });
    }
}
