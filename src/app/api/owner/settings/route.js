

import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';


// This function now verifies the user and fetches both user and their restaurant data if they are an owner.
async function verifyUserAndGetData(req) {
    const auth = getAuth();
    const firestore = getFirestore();
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // --- ADMIN IMPERSONATION & PERMISSION LOGIC ---
    const url = new URL(req.headers.get('referer'));
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    let finalUserId = uid;
    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        finalUserId = impersonatedOwnerId;
    }
    // --- END ADMIN IMPERSONATION LOGIC ---

    const userRef = firestore.collection('users').doc(finalUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        throw { message: "User profile not found.", status: 404 };
    }
    
    const userData = userDoc.data();
    let restaurantData = null;
    let restaurantRef = null;

    if (userData.role === 'owner' || (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId)) {
        const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', finalUserId).limit(1).get();
        if (!restaurantsQuery.empty) {
            restaurantRef = restaurantsQuery.docs[0].ref;
            restaurantData = restaurantsQuery.docs[0].data();
        }
    }
    
    return { uid: finalUserId, userRef, userData, restaurantRef, restaurantData };
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const restaurantId = searchParams.get('restaurantId');
        
        // Public endpoint for fetching only COD status
        if (restaurantId) {
            const firestore = getFirestore();
            const restaurantDoc = await firestore.collection('restaurants').doc(restaurantId).get();
            if (!restaurantDoc.exists) {
                return NextResponse.json({ message: "Restaurant not found." }, { status: 404 });
            }
            const restaurantData = restaurantDoc.data();
            return NextResponse.json({ codEnabled: restaurantData.codEnabled || false }, { status: 200 });
        }
        
        // Authenticated endpoint for full settings
        const { uid, userData, restaurantData } = await verifyUserAndGetData(req);
        
        const profileData = {
            name: userData.name || 'No Name',
            email: userData.email || 'No Email',
            phone: userData.phone || '',
            role: userData.role || 'customer',
            profilePicture: userData.profilePictureUrl || `https://picsum.photos/seed/${uid}/200/200`,
            notifications: userData.notifications || {
                newOrders: true,
                dailySummary: false,
                marketing: true,
            },
            // Add restaurant-specific fields if they exist
            address: restaurantData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            gstin: restaurantData?.gstin || '',
            fssai: restaurantData?.fssai || '',
            botPhoneNumberId: restaurantData?.botPhoneNumberId || '',
            razorpayAccountId: restaurantData?.razorpayAccountId || '', 
            deliveryCharge: restaurantData?.deliveryCharge === undefined ? 30 : restaurantData.deliveryCharge,
            logoUrl: restaurantData?.logoUrl || '',
            bannerUrls: restaurantData?.bannerUrls || [],
            codEnabled: restaurantData?.codEnabled || false, // Add this line
        };

        return NextResponse.json(profileData, { status: 200 });

    } catch (error) {
        console.error("GET SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const { userRef, userData, restaurantRef, restaurantData } = await verifyUserAndGetData(req);
        
        const { name, phone, notifications, gstin, fssai, botPhoneNumberId, deliveryCharge, logoUrl, bannerUrls, codEnabled, address } = await req.json();

        // --- Update User's Profile in 'users' collection ---
        const userUpdateData = {};
        if (name !== undefined) userUpdateData.name = name;
        if (phone !== undefined) userUpdateData.phone = phone;
        if (notifications !== undefined) userUpdateData.notifications = notifications;

        if (Object.keys(userUpdateData).length > 0) {
            await userRef.update(userUpdateData);
        }

        // --- Update Restaurant's Profile in 'restaurants' collection ---
        if (restaurantRef) {
            const restaurantUpdateData = {};
            if (gstin !== undefined) restaurantUpdateData.gstin = gstin;
            if (fssai !== undefined) restaurantUpdateData.fssai = fssai;
            if (botPhoneNumberId !== undefined) restaurantUpdateData.botPhoneNumberId = botPhoneNumberId;
            if (deliveryCharge !== undefined) restaurantUpdateData.deliveryCharge = Number(deliveryCharge);
            if (logoUrl !== undefined) restaurantUpdateData.logoUrl = logoUrl;
            if (bannerUrls !== undefined) restaurantUpdateData.bannerUrls = bannerUrls;
            if (codEnabled !== undefined) restaurantUpdateData.codEnabled = codEnabled;
            if (address !== undefined) restaurantUpdateData.address = address; // Save the structured address

            if (phone !== undefined && phone !== restaurantData?.ownerPhone) {
                restaurantUpdateData.ownerPhone = phone;
            }
            
            if (Object.keys(restaurantUpdateData).length > 0) {
                await restaurantRef.update(restaurantUpdateData);
            }
        }
        
        const { userData: finalUserData, restaurantData: finalRestaurantData } = await verifyUserAndGetData(req);
        const responseData = {
            name: finalUserData.name,
            email: finalUserData.email,
            phone: finalUserData.phone,
            role: finalUserData.role,
            profilePicture: finalUserData.profilePictureUrl,
            notifications: finalUserData.notifications,
            gstin: finalRestaurantData?.gstin || '',
            fssai: finalRestaurantData?.fssai || '',
            botPhoneNumberId: finalRestaurantData?.botPhoneNumberId || '',
            razorpayAccountId: finalRestaurantData?.razorpayAccountId || '',
            deliveryCharge: finalRestaurantData?.deliveryCharge === undefined ? 30 : finalRestaurantData.deliveryCharge,
            logoUrl: finalRestaurantData?.logoUrl || '',
            bannerUrls: finalRestaurantData?.bannerUrls || [],
            codEnabled: finalRestaurantData?.codEnabled || false,
            address: finalRestaurantData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
        };

        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error("PATCH SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
