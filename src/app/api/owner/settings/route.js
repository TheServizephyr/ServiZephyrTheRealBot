

import { NextResponse } from 'next/server';
import { getAuth } from '@/lib/firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { sendRestaurantStatusChangeNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

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
        const businessIdFromQuery = searchParams.get('restaurantId') || searchParams.get('businessId');
        
        // Public endpoint for fetching only COD status
        if (businessIdFromQuery) {
            const firestore = getFirestore();
            let businessDoc = await firestore.collection('restaurants').doc(businessIdFromQuery).get();
            if (!businessDoc.exists) {
                businessDoc = await firestore.collection('shops').doc(businessIdFromQuery).get();
            }
            if (!businessDoc.exists) {
                return NextResponse.json({ message: "Business not found." }, { status: 404 });
            }
            const businessData = businessDoc.data();
            return NextResponse.json({ 
                codEnabled: businessData.codEnabled || false,
                dineInPayAtCounterEnabled: businessData.dineInPayAtCounterEnabled,
            }, { status: 200 });
        }
        
        // Authenticated endpoint for full settings
        const { uid, userData, businessData, businessId } = await verifyUserAndGetData(req);
        
        const profileData = {
            name: userData.name || 'No Name',
            email: userData.email || 'No Email',
            phone: userData.phone || '',
            role: userData.role || 'customer',
            restaurantName: businessData?.name || '',
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
            deliveryEnabled: businessData?.deliveryEnabled === undefined ? true : businessData.deliveryEnabled,
            pickupEnabled: businessData?.pickupEnabled === undefined ? false : businessData.pickupEnabled,
            dineInEnabled: businessData?.dineInEnabled === undefined ? false : businessData.dineInEnabled,
            deliveryOnlinePaymentEnabled: businessData?.deliveryOnlinePaymentEnabled === undefined ? true : businessData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: businessData?.deliveryCodEnabled === undefined ? true : businessData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: businessData?.pickupOnlinePaymentEnabled === undefined ? true : businessData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: businessData?.pickupPodEnabled === undefined ? true : businessData.pickupPodEnabled,
            dineInOnlinePaymentEnabled: businessData?.dineInOnlinePaymentEnabled === undefined ? true : businessData.dineInOnlinePaymentEnabled,
            dineInPayAtCounterEnabled: businessData?.dineInPayAtCounterEnabled === undefined ? true : businessData.dineInPayAtCounterEnabled,
            isOpen: businessData?.isOpen === undefined ? true : businessData.isOpen,
            businessId: businessId // THE FIX: Explicitly include businessId
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
        
        const updates = await req.json();

        // --- Update User's Profile in 'users' collection ---
        const userUpdateData = {};
        if (updates.name !== undefined) userUpdateData.name = updates.name;
        if (updates.phone !== undefined) userUpdateData.phone = updates.phone;
        if (updates.notifications !== undefined) userUpdateData.notifications = updates.notifications;

        if (Object.keys(userUpdateData).length > 0) {
            await userRef.update(userUpdateData);
        }

        // --- Update Business Profile ---
        if (businessRef) {
            const businessUpdateData = {};
            if (updates.restaurantName !== undefined) businessUpdateData.name = updates.restaurantName;
            if (updates.gstin !== undefined) businessUpdateData.gstin = updates.gstin;
            if (updates.fssai !== undefined) businessUpdateData.fssai = updates.fssai;
            if (updates.botPhoneNumberId !== undefined) businessUpdateData.botPhoneNumberId = updates.botPhoneNumberId;
            if (updates.deliveryCharge !== undefined) businessUpdateData.deliveryCharge = Number(updates.deliveryCharge);
            if (updates.logoUrl !== undefined) businessUpdateData.logoUrl = updates.logoUrl;
            if (updates.bannerUrls !== undefined) businessUpdateData.bannerUrls = updates.bannerUrls;
            if (updates.address !== undefined) businessUpdateData.address = updates.address; 
            
            // Order & Payment Settings
            if (updates.deliveryEnabled !== undefined) businessUpdateData.deliveryEnabled = updates.deliveryEnabled;
            if (updates.pickupEnabled !== undefined) businessUpdateData.pickupEnabled = updates.pickupEnabled;
            if (updates.dineInEnabled !== undefined) businessUpdateData.dineInEnabled = updates.dineInEnabled;
            if (updates.deliveryOnlinePaymentEnabled !== undefined) businessUpdateData.deliveryOnlinePaymentEnabled = updates.deliveryOnlinePaymentEnabled;
            if (updates.deliveryCodEnabled !== undefined) businessUpdateData.deliveryCodEnabled = updates.deliveryCodEnabled;
            if (updates.pickupOnlinePaymentEnabled !== undefined) businessUpdateData.pickupOnlinePaymentEnabled = updates.pickupOnlinePaymentEnabled;
            if (updates.pickupPodEnabled !== undefined) businessUpdateData.pickupPodEnabled = updates.pickupPodEnabled;
            if (updates.dineInOnlinePaymentEnabled !== undefined) businessUpdateData.dineInOnlinePaymentEnabled = updates.dineInOnlinePaymentEnabled;
            if (updates.dineInPayAtCounterEnabled !== undefined) businessUpdateData.dineInPayAtCounterEnabled = updates.dineInPayAtCounterEnabled;

            if (updates.isOpen !== undefined && updates.isOpen !== businessData?.isOpen) {
                businessUpdateData.isOpen = updates.isOpen;
                
                sendRestaurantStatusChangeNotification({
                    ownerPhone: businessData.ownerPhone,
                    botPhoneNumberId: businessData.botPhoneNumberId,
                    newStatus: updates.isOpen,
                    restaurantId: businessId,
                }).catch(e => console.error("Failed to send status change notification:", e));
            }

            if (updates.phone !== undefined && updates.phone !== businessData?.ownerPhone) {
                businessUpdateData.ownerPhone = updates.phone;
            }
            
            if (Object.keys(businessUpdateData).length > 0) {
                await businessRef.update(businessUpdateData);
            }
        }
        
        const { userData: finalUserData, businessData: finalBusinessData, businessId: finalBusinessId } = await verifyUserAndGetData(req);
        const responseData = {
            name: finalUserData.name,
            email: finalUserData.email,
            phone: finalUserData.phone,
            role: finalUserData.role,
            restaurantName: finalBusinessData?.name || '',
            profilePicture: finalUserData.profilePictureUrl,
            notifications: finalUserData.notifications,
            gstin: finalBusinessData?.gstin || '',
            fssai: finalBusinessData?.fssai || '',
            botPhoneNumberId: finalBusinessData?.botPhoneNumberId || '',
            razorpayAccountId: finalBusinessData?.razorpayAccountId || '',
            deliveryCharge: finalBusinessData?.deliveryCharge === undefined ? 30 : finalBusinessData.deliveryCharge,
            logoUrl: finalBusinessData?.logoUrl || '',
            bannerUrls: finalBusinessData?.bannerUrls || [],
            deliveryEnabled: finalBusinessData?.deliveryEnabled === undefined ? true : finalBusinessData.deliveryEnabled,
            pickupEnabled: finalBusinessData?.pickupEnabled === undefined ? false : finalBusinessData.pickupEnabled,
            dineInEnabled: finalBusinessData?.dineInEnabled === undefined ? false : finalBusinessData.dineInEnabled,
            deliveryOnlinePaymentEnabled: finalBusinessData?.deliveryOnlinePaymentEnabled === undefined ? true : finalBusinessData.deliveryOnlinePaymentEnabled,
            deliveryCodEnabled: finalBusinessData?.deliveryCodEnabled === undefined ? true : finalBusinessData.deliveryCodEnabled,
            pickupOnlinePaymentEnabled: finalBusinessData?.pickupOnlinePaymentEnabled === undefined ? true : finalBusinessData.pickupOnlinePaymentEnabled,
            pickupPodEnabled: finalBusinessData?.pickupPodEnabled === undefined ? true : finalBusinessData.pickupPodEnabled,
            dineInOnlinePaymentEnabled: finalBusinessData?.dineInOnlinePaymentEnabled === undefined ? true : finalBusinessData.dineInOnlinePaymentEnabled,
            dineInPayAtCounterEnabled: finalBusinessData?.dineInPayAtCounterEnabled === undefined ? true : finalBusinessData.dineInPayAtCounterEnabled,
            isOpen: finalBusinessData?.isOpen === undefined ? true : finalBusinessData.isOpen,
            address: finalBusinessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            businessId: finalBusinessId, // THE FIX: Also return businessId on PATCH
        };

        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error("PATCH SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
