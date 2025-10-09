
import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';

// This function now verifies the user and fetches both user and their restaurant data if they are an owner.
async function verifyUserAndGetData(req, auth, firestore) {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Authorization token not found or invalid.', status: 401 };
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    const userRef = firestore.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        throw { message: "User profile not found.", status: 404 };
    }
    
    const userData = userDoc.data();
    let restaurantData = null;

    if (userData.role === 'owner') {
        const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
        if (!restaurantsQuery.empty) {
            restaurantData = restaurantsQuery.docs[0].data();
        }
    }
    
    return { uid, userData, restaurantData };
}

export async function GET(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { uid, userData, restaurantData } = await verifyUserAndGetData(req, auth, firestore);
        
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
            gstin: restaurantData?.gstin || '',
            fssai: restaurantData?.fssai || '',
            botPhoneNumberId: restaurantData?.botPhoneNumberId || '',
            deliveryCharge: restaurantData?.deliveryCharge || 30, // Default to 30 if not set
            logoUrl: restaurantData?.logoUrl || '',
            bannerUrl: restaurantData?.bannerUrl || '',
        };

        return NextResponse.json(profileData, { status: 200 });

    } catch (error) {
        console.error("GET SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const auth = await getAuth();
        const firestore = await getFirestore();
        const { uid, userData } = await verifyUserAndGetData(req, auth, firestore);
        
        const { name, phone, notifications, gstin, fssai, botPhoneNumberId, deliveryCharge, logoUrl, bannerUrl } = await req.json();

        // --- Update User's Profile in 'users' collection ---
        const userRef = firestore.collection('users').doc(uid);
        const userUpdateData = {};
        if (name) userUpdateData.name = name;
        if (phone) userUpdateData.phone = phone;
        if (notifications) userUpdateData.notifications = notifications;

        if (Object.keys(userUpdateData).length > 0) {
            await userRef.update(userUpdateData);
        }

        // --- Update Restaurant's Profile in 'restaurants' collection (if owner) ---
        if (userData.role === 'owner') {
            const restaurantsQuery = await firestore.collection('restaurants').where('ownerId', '==', uid).limit(1).get();
            if (!restaurantsQuery.empty) {
                const restaurantRef = restaurantsQuery.docs[0].ref;
                const restaurantUpdateData = {};
                // Only update if the values are provided (even if they are empty strings)
                if (gstin !== undefined) restaurantUpdateData.gstin = gstin;
                if (fssai !== undefined) restaurantUpdateData.fssai = fssai;
                if (botPhoneNumberId !== undefined) restaurantUpdateData.botPhoneNumberId = botPhoneNumberId;
                if (deliveryCharge !== undefined) restaurantUpdateData.deliveryCharge = Number(deliveryCharge);
                if (logoUrl !== undefined) restaurantUpdateData.logoUrl = logoUrl;
                if (bannerUrl !== undefined) restaurantUpdateData.bannerUrl = bannerUrl;

                
                if (Object.keys(restaurantUpdateData).length > 0) {
                    await restaurantRef.update(restaurantUpdateData);
                }
            }
        }
        
        // --- Fetch and return the fully updated data ---
        const { userData: finalUserData, restaurantData: finalRestaurantData } = await verifyUserAndGetData(req, auth, firestore);
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
            deliveryCharge: finalRestaurantData?.deliveryCharge || 30,
            logoUrl: finalRestaurantData?.logoUrl || '',
            bannerUrl: finalRestaurantData?.bannerUrl || '',
        };

        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error("PATCH SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
