

import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { sendRestaurantStatusChangeNotification } from '@/lib/notifications';


// This function now verifies the user and fetches both user and their business data if they are an owner.
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
    
    // Admin impersonation logic
    const url = new URL(req.headers.get('referer'));
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const adminUserDoc = await firestore.collection('users').doc(uid).get();

    let finalUserId = uid;
    if (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId) {
        console.log(`[API Impersonation] Admin ${uid} is viewing data for owner ${impersonatedOwnerId}.`);
        finalUserId = impersonatedOwnerId;
    }
    
    const userRef = firestore.collection('users').doc(finalUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
        throw { message: "User profile not found.", status: 404 };
    }
    
    const userData = userDoc.data();
    let businessData = null;
    let businessRef = null;
    let businessId = null;

    if (userData.role === 'owner' || userData.role === 'restaurant-owner' || userData.role === 'shop-owner' || (adminUserDoc.exists && adminUserDoc.data().role === 'admin' && impersonatedOwnerId)) {
        const collectionName = userData.businessType === 'shop' ? 'shops' : 'restaurants';
        const businessesQuery = await firestore.collection(collectionName).where('ownerId', '==', finalUserId).limit(1).get();
        if (!businessesQuery.empty) {
            const businessDoc = businessesQuery.docs[0];
            businessRef = businessDoc.ref;
            businessData = businessDoc.data();
            businessId = businessDoc.id;
        }
    }
    
    return { uid: finalUserId, userRef, userData, businessRef, businessData, businessId };
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const businessId = searchParams.get('restaurantId') || searchParams.get('businessId');
        
        // Public endpoint for fetching only COD status
        if (businessId) {
            const firestore = getFirestore();
            let businessDoc = await firestore.collection('restaurants').doc(businessId).get();
            if (!businessDoc.exists) {
                businessDoc = await firestore.collection('shops').doc(businessId).get();
            }
            if (!businessDoc.exists) {
                return NextResponse.json({ message: "Business not found." }, { status: 404 });
            }
            const businessData = businessDoc.data();
            return NextResponse.json({ codEnabled: businessData.codEnabled || false }, { status: 200 });
        }
        
        // Authenticated endpoint for full settings
        const { uid, userData, businessData } = await verifyUserAndGetData(req);
        
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
            address: businessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            gstin: businessData?.gstin || '',
            fssai: businessData?.fssai || '',
            botPhoneNumberId: businessData?.botPhoneNumberId || '',
            razorpayAccountId: businessData?.razorpayAccountId || '', 
            deliveryCharge: businessData?.deliveryCharge === undefined ? 30 : businessData.deliveryCharge,
            logoUrl: businessData?.logoUrl || '',
            bannerUrls: businessData?.bannerUrls || [],
            codEnabled: businessData?.codEnabled || false,
            onlinePaymentsEnabled: businessData?.onlinePaymentsEnabled === undefined ? true : businessData.onlinePaymentsEnabled,
            isOpen: businessData?.isOpen === undefined ? true : businessData.isOpen,
        };

        return NextResponse.json(profileData, { status: 200 });

    } catch (error) {
        console.error("GET SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const { userRef, userData, businessRef, businessData, businessId } = await verifyUserAndGetData(req);
        
        const { name, phone, notifications, gstin, fssai, botPhoneNumberId, deliveryCharge, logoUrl, bannerUrls, codEnabled, address, isOpen, onlinePaymentsEnabled } = await req.json();

        // --- Update User's Profile in 'users' collection ---
        const userUpdateData = {};
        if (name !== undefined) userUpdateData.name = name;
        if (phone !== undefined) userUpdateData.phone = phone;
        if (notifications !== undefined) userUpdateData.notifications = notifications;

        if (Object.keys(userUpdateData).length > 0) {
            await userRef.update(userUpdateData);
        }

        // --- Update Business Profile ---
        if (businessRef) {
            const businessUpdateData = {};
            if (gstin !== undefined) businessUpdateData.gstin = gstin;
            if (fssai !== undefined) businessUpdateData.fssai = fssai;
            if (botPhoneNumberId !== undefined) businessUpdateData.botPhoneNumberId = botPhoneNumberId;
            if (deliveryCharge !== undefined) businessUpdateData.deliveryCharge = Number(deliveryCharge);
            if (logoUrl !== undefined) businessUpdateData.logoUrl = logoUrl;
            if (bannerUrls !== undefined) businessUpdateData.bannerUrls = bannerUrls;
            if (codEnabled !== undefined) businessUpdateData.codEnabled = codEnabled;
            if (onlinePaymentsEnabled !== undefined) businessUpdateData.onlinePaymentsEnabled = onlinePaymentsEnabled;
            if (address !== undefined) businessUpdateData.address = address; 
            
            if (isOpen !== undefined && isOpen !== businessData?.isOpen) {
                businessUpdateData.isOpen = isOpen;
                
                sendRestaurantStatusChangeNotification({
                    ownerPhone: businessData.ownerPhone,
                    botPhoneNumberId: businessData.botPhoneNumberId,
                    newStatus: isOpen,
                    restaurantId: businessId,
                }).catch(e => console.error("Failed to send status change notification:", e));
            }

            if (phone !== undefined && phone !== businessData?.ownerPhone) {
                businessUpdateData.ownerPhone = phone;
            }
            
            if (Object.keys(businessUpdateData).length > 0) {
                await businessRef.update(businessUpdateData);
            }
        }
        
        const { userData: finalUserData, businessData: finalBusinessData } = await verifyUserAndGetData(req);
        const responseData = {
            name: finalUserData.name,
            email: finalUserData.email,
            phone: finalUserData.phone,
            role: finalUserData.role,
            profilePicture: finalUserData.profilePictureUrl,
            notifications: finalUserData.notifications,
            gstin: finalBusinessData?.gstin || '',
            fssai: finalBusinessData?.fssai || '',
            botPhoneNumberId: finalBusinessData?.botPhoneNumberId || '',
            razorpayAccountId: finalBusinessData?.razorpayAccountId || '',
            deliveryCharge: finalBusinessData?.deliveryCharge === undefined ? 30 : finalBusinessData.deliveryCharge,
            logoUrl: finalBusinessData?.logoUrl || '',
            bannerUrls: finalBusinessData?.bannerUrls || [],
            codEnabled: finalBusinessData?.codEnabled || false,
            onlinePaymentsEnabled: finalBusinessData?.onlinePaymentsEnabled === undefined ? true : finalBusinessData.onlinePaymentsEnabled,
            isOpen: finalBusinessData?.isOpen === undefined ? true : finalBusinessData.isOpen,
            address: finalBusinessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
        };

        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error("PATCH SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
