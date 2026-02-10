

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { sendRestaurantStatusChangeNotification } from '@/lib/notifications';
import { kv } from '@vercel/kv';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const businessIdFromQuery = searchParams.get('restaurantId') || searchParams.get('businessId');

        // This block is for public-facing queries that only need payment settings.
        if (businessIdFromQuery) {
            const firestore = await getFirestore();
            let businessDoc;
            const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
            for (const collectionName of collectionsToTry) {
                const docRef = firestore.collection(collectionName).doc(businessIdFromQuery);
                businessDoc = await docRef.get();
                if (businessDoc.exists) break;
            }

            if (!businessDoc || !businessDoc.exists) {
                return NextResponse.json({ message: "Business not found." }, { status: 404 });
            }
            const businessData = businessDoc.data();

            // FETCH DELIVERY SETTINGS FROM SUB-COLLECTION
            const deliveryConfigSnap = await businessDoc.ref.collection('delivery_settings').doc('config').get();
            const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};

            // Fallback to parent doc if sub-collection empty (during migration/rollout)
            const fallback = (key, defaultVal) => deliveryConfig[key] ?? businessData[key] ?? defaultVal;

            // This is the public response, only contains necessary info.
            const responsePayload = {
                deliveryCodEnabled: fallback('deliveryCodEnabled', true),
                deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
                pickupPodEnabled: fallback('pickupPodEnabled', true),
                pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
                dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
                dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
                botPhoneNumberId: businessData.botPhoneNumberId || null,
                botDisplayNumber: businessData.botDisplayNumber || null,
                // Add-on Charges Configuration
                gstEnabled: businessData.gstEnabled || false,
                gstPercentage: businessData.gstPercentage || businessData.gstRate || 0,
                gstMinAmount: businessData.gstMinAmount || 0,
                convenienceFeeEnabled: businessData.convenienceFeeEnabled || false,
                convenienceFeeRate: businessData.convenienceFeeRate || 2.5,
                convenienceFeePaidBy: businessData.convenienceFeePaidBy || 'customer',
                convenienceFeeLabel: businessData.convenienceFeeLabel || 'Payment Processing Fee',
                packagingChargeEnabled: businessData.packagingChargeEnabled || false,
                packagingChargeAmount: businessData.packagingChargeAmount || 0,
                // Include delivery fees for public menu (often needed for cart calc)
                deliveryFeeType: fallback('deliveryFeeType', 'fixed'),
                // FIXED: Calculate deliveryCharge for frontend compatibility
                deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
                deliveryFixedFee: fallback('deliveryFixedFee', 30),
                deliveryPerKmFee: fallback('deliveryPerKmFee', 5),
                deliveryFreeThreshold: fallback('deliveryFreeThreshold', 500),
                deliveryRadius: fallback('deliveryRadius', 5),
                deliveryEnabled: fallback('deliveryEnabled', true),
                // NEW: Road factor & free delivery zone
                roadDistanceFactor: fallback('roadDistanceFactor', 1.0),
                freeDeliveryRadius: fallback('freeDeliveryRadius', 0),
                freeDeliveryMinOrder: fallback('freeDeliveryMinOrder', 0),
                pickupEnabled: fallback('pickupEnabled', true),
                dineInEnabled: fallback('dineInEnabled', true),
            };

            // Fetch active coupons from subcollection
            try {
                const couponsSnap = await businessDoc.ref.collection('coupons')
                    .where('status', '==', 'active') // Only fetch active coupons
                    .get();

                const now = new Date();
                const coupons = couponsSnap.docs
                    .map(doc => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            ...data,
                            // Ensure dates are serialized strings for JSON response
                            startDate: data.startDate?.toDate ? data.startDate.toDate().toISOString() : data.startDate,
                            expiryDate: data.expiryDate?.toDate ? data.expiryDate.toDate().toISOString() : data.expiryDate,
                        };
                    })
                    .filter(c => new Date(c.expiryDate) > now); // double check expiry

                responsePayload.coupons = coupons;
            } catch (err) {
                console.error("Error fetching coupons for public settings:", err);
                responsePayload.coupons = [];
            }

            return NextResponse.json(responsePayload, { status: 200 });
        }

        // This block is for authenticated owner dashboard queries.
        // Use standard verifyOwnerWithAudit for robust impersonation handling
        const context = await verifyOwnerWithAudit(req, 'view_settings');
        const { uid, userData, businessSnap, businessId } = context;
        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data();

        // FETCH DELIVERY SETTINGS FROM SUB-COLLECTION
        const deliveryConfigSnap = await businessRef.collection('delivery_settings').doc('config').get();
        const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
        const fallback = (key, defaultVal) => deliveryConfig[key] ?? businessData[key] ?? defaultVal;

        const profileData = {
            name: userData.name || 'No Name',
            email: userData.email || 'No Email',
            phone: userData.phone || '',
            role: userData.role || 'customer',
            restaurantName: businessData?.name || '',
            profilePicture: userData.profilePictureUrl || `https://picsum.photos/seed/${uid}/200/200`,
            notifications: userData.notifications || { newOrders: true, dailySummary: false, marketing: true },
            address: businessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            gstin: businessData?.gstin || '',
            fssai: businessData?.fssai || '',
            botPhoneNumberId: businessData?.botPhoneNumberId || '',
            botDisplayNumber: businessData?.botDisplayNumber || '',
            razorpayAccountId: businessData?.razorpayAccountId || '',
            logoUrl: businessData?.logoUrl || '',
            bannerUrls: businessData?.bannerUrls || [],
            // Delivery Settings (Sourced from Sub-collection or Fallback)
            deliveryEnabled: fallback('deliveryEnabled', true),
            deliveryRadius: fallback('deliveryRadius', 5),
            deliveryFeeType: fallback('deliveryFeeType', 'fixed'),
            // FIXED: Calculate deliveryCharge for frontend compatibility
            deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
            deliveryFixedFee: fallback('deliveryFixedFee', 30),
            deliveryPerKmFee: fallback('deliveryPerKmFee', 5),
            deliveryFreeThreshold: fallback('deliveryFreeThreshold', 500),
            // NEW: Road factor & free delivery zone
            roadDistanceFactor: fallback('roadDistanceFactor', 1.0),
            freeDeliveryRadius: fallback('freeDeliveryRadius', 0),
            freeDeliveryMinOrder: fallback('freeDeliveryMinOrder', 0),
            // Other Settings
            pickupEnabled: fallback('pickupEnabled', false),
            dineInEnabled: fallback('dineInEnabled', true),
            deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
            deliveryCodEnabled: fallback('deliveryCodEnabled', true),
            pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
            pickupPodEnabled: fallback('pickupPodEnabled', true),
            dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
            dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
            isOpen: businessData?.isOpen === undefined ? true : businessData.isOpen,
            dineInModel: businessData?.dineInModel || 'post-paid',
            // Add-on Charges Configuration
            gstEnabled: businessData?.gstEnabled || false,
            gstRate: businessData?.gstPercentage || businessData?.gstRate || 5,
            gstMinAmount: businessData?.gstMinAmount || 0,
            convenienceFeeEnabled: businessData?.convenienceFeeEnabled || false,
            convenienceFeeRate: businessData?.convenienceFeeRate || 2.5,
            convenienceFeePaidBy: businessData?.convenienceFeePaidBy || 'customer',
            convenienceFeeLabel: businessData?.convenienceFeeLabel || 'Payment Processing Fee',
            packagingChargeEnabled: businessData?.packagingChargeEnabled || false,
            packagingChargeAmount: businessData?.packagingChargeAmount || 0,
            businessId: businessId,
            merchantId: businessData?.merchantId || '',
            customerId: userData?.customerId || '',
            paymentQRCode: businessData?.paymentQRCode || null, // ✅ Return QR Code URL
        };

        return NextResponse.json(profileData, { status: 200 });

    } catch (error) {
        console.error("GET SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        // Use standard verifyOwnerWithAudit for robust impersonation handling
        const context = await verifyOwnerWithAudit(req, 'update_settings');
        const { uid, userData, businessSnap, businessId } = context;
        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data();

        const firestore = await getFirestore();
        const userRef = firestore.collection('users').doc(uid);

        const updates = await req.json();

        const userUpdateData = {};
        if (updates.name !== undefined) userUpdateData.name = updates.name;
        if (updates.phone !== undefined) userUpdateData.phone = updates.phone;
        if (updates.notifications !== undefined) userUpdateData.notifications = updates.notifications;

        if (Object.keys(userUpdateData).length > 0) {
            await userRef.update(userUpdateData);
        }

        // Validate Dine-In payment method toggles: at least one must be enabled
        if (updates.dineInOnlinePaymentEnabled !== undefined || updates.dineInPayAtCounterEnabled !== undefined) {
            // Note: We need to check sub-collection for current values properly if not provided
            // But for simplicity, we'll enforce this validation on the frontend or assume safe defaults
        }

        const businessUpdateData = {};
        if (updates.restaurantName !== undefined) businessUpdateData.name = updates.restaurantName;
        if (updates.gstin !== undefined) businessUpdateData.gstin = updates.gstin;
        if (updates.fssai !== undefined) businessUpdateData.fssai = updates.fssai;
        if (updates.botPhoneNumberId !== undefined) businessUpdateData.botPhoneNumberId = updates.botPhoneNumberId;
        if (updates.botDisplayNumber !== undefined) businessUpdateData.botDisplayNumber = updates.botDisplayNumber;
        if (updates.razorpayAccountId !== undefined) businessUpdateData.razorpayAccountId = updates.razorpayAccountId;
        if (updates.logoUrl !== undefined) businessUpdateData.logoUrl = updates.logoUrl;
        if (updates.bannerUrls !== undefined) businessUpdateData.bannerUrls = updates.bannerUrls;
        if (updates.logoUrl !== undefined) businessUpdateData.logoUrl = updates.logoUrl;
        if (updates.bannerUrls !== undefined) businessUpdateData.bannerUrls = updates.bannerUrls;
        if (updates.address !== undefined && typeof updates.address === 'object') {
            const { full, ...sanitizedAddress } = updates.address;
            businessUpdateData.address = sanitizedAddress;
        }
        // ✅ Payment QR Code
        if (updates.paymentQRCode !== undefined) businessUpdateData.paymentQRCode = updates.paymentQRCode;

        // NOTE: Delivery Settings are now handled by /api/owner/delivery-settings
        // We will NOT write them to parent doc anymore to ensure single source of truth (sub-collection)
        // However, we handle NON-delivery settings here still:


        if (updates.isOpen !== undefined && updates.isOpen !== businessData?.isOpen) {
            businessUpdateData.isOpen = updates.isOpen;

            // 🔍 PROOF: Log current menuVersion BEFORE increment
            const currentMenuVersion = businessData.menuVersion || 1;
            console.log(`%c[Settings API] 📊 BEFORE UPDATE`, 'color: orange; font-weight: bold');
            console.log(`[Settings API]    ├─ Restaurant: ${businessId}`);
            console.log(`[Settings API]    ├─ Current menuVersion: ${currentMenuVersion}`);
            console.log(`[Settings API]    ├─ Old isOpen: ${businessData?.isOpen}`);
            console.log(`[Settings API]    └─ New isOpen: ${updates.isOpen}`);

            // Increment menuVersion to invalidate menu cache (restaurant status is part of menu response)
            console.log(`[Settings API] 🔄 Incrementing menuVersion...`);
            businessUpdateData.menuVersion = FieldValue.increment(1);

            // 🔍 PROOF: Show what cache keys will be affected
            const newMenuVersion = currentMenuVersion + 1;
            const oldCacheKey = `menu:${businessId}:v${currentMenuVersion}_patch2`;
            const newCacheKey = `menu:${businessId}:v${newMenuVersion}_patch2`;
            console.log(`%c[Settings API] ✅ CACHE INVALIDATION`, 'color: green; font-weight: bold');
            console.log(`[Settings API]    ├─ Old cache key: ${oldCacheKey} (will expire)`);
            console.log(`[Settings API]    └─ New cache key: ${newCacheKey} (will be fresh)`);
            console.log(`[Settings API] ⏰ Timestamp: ${new Date().toISOString()}`);

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

        // Add-on Charges Configuration
        if (updates.gstEnabled !== undefined) businessUpdateData.gstEnabled = updates.gstEnabled;
        if (updates.gstPercentage !== undefined) businessUpdateData.gstPercentage = updates.gstPercentage;
        if (updates.gstMinAmount !== undefined) businessUpdateData.gstMinAmount = updates.gstMinAmount;
        if (updates.convenienceFeeEnabled !== undefined) businessUpdateData.convenienceFeeEnabled = updates.convenienceFeeEnabled;
        if (updates.convenienceFeeRate !== undefined) businessUpdateData.convenienceFeeRate = updates.convenienceFeeRate;
        if (updates.convenienceFeePaidBy !== undefined) businessUpdateData.convenienceFeePaidBy = updates.convenienceFeePaidBy;
        if (updates.convenienceFeeLabel !== undefined) businessUpdateData.convenienceFeeLabel = updates.convenienceFeeLabel;
        if (updates.packagingChargeEnabled !== undefined) businessUpdateData.packagingChargeEnabled = updates.packagingChargeEnabled;
        if (updates.packagingChargeAmount !== undefined) businessUpdateData.packagingChargeAmount = updates.packagingChargeAmount;

        // Dine-In Settings (Not moved to delivery-settings yet)
        if (updates.dineInEnabled !== undefined) businessUpdateData.dineInEnabled = updates.dineInEnabled;
        if (updates.dineInModel !== undefined) businessUpdateData.dineInModel = updates.dineInModel;

        // Pickup Settings
        if (updates.pickupEnabled !== undefined) businessUpdateData.pickupEnabled = updates.pickupEnabled;

        // Payment Method Settings (Specific per Order Type)
        if (updates.pickupOnlinePaymentEnabled !== undefined) businessUpdateData.pickupOnlinePaymentEnabled = updates.pickupOnlinePaymentEnabled;
        if (updates.pickupPodEnabled !== undefined) businessUpdateData.pickupPodEnabled = updates.pickupPodEnabled;
        if (updates.dineInOnlinePaymentEnabled !== undefined) businessUpdateData.dineInOnlinePaymentEnabled = updates.dineInOnlinePaymentEnabled;
        if (updates.dineInPayAtCounterEnabled !== undefined) businessUpdateData.dineInPayAtCounterEnabled = updates.dineInPayAtCounterEnabled;

        // Handle delivery settings update here IF provided (Legacy support or single-save screens)
        // If frontend sends delivery params to THIS endpoint, we should forward them to sub-collection
        const deliveryFields = [
            'deliveryEnabled', 'deliveryRadius', 'deliveryFeeType',
            'deliveryFixedFee', 'deliveryPerKmFee', 'deliveryFreeThreshold',
            'deliveryOnlinePaymentEnabled', 'deliveryCodEnabled',
            // NEW: Road factor & free delivery zone
            'roadDistanceFactor', 'freeDeliveryRadius', 'freeDeliveryMinOrder'
        ];

        const deliveryUpdates = {};
        let hasDeliveryUpdates = false;

        deliveryFields.forEach(field => {
            if (updates[field] !== undefined) {
                deliveryUpdates[field] = updates[field];
                hasDeliveryUpdates = true;
            }
        });

        if (hasDeliveryUpdates) {
            if (!businessRef) {
                throw { message: 'Business not found. Cannot update delivery settings.', status: 404 };
            }
            await businessRef.collection('delivery_settings').doc('config').set(deliveryUpdates, { merge: true });
        }

        if (Object.keys(businessUpdateData).length > 0) {
            if (!businessRef) {
                throw { message: 'Business not found. Cannot update settings.', status: 404 };
            }
            await businessRef.update(businessUpdateData);
            console.log(`[Settings API] ✅ Settings updated for ${businessId}`);
        }


        // Re-fetch final data for response
        // Optimization: reusing context is risky if updates changed something critical (rare), but safe to reuse ID/Ref
        const finalBusinessSnap = await businessRef.get();
        const finalBusinessData = finalBusinessSnap.data();
        const finalUserDataSnap = await userRef.get(); // Re-fetch user data
        const finalUserData = finalUserDataSnap.data();
        const finalBusinessId = businessId;

        // Fetch fresh delivery config
        const deliveryConfigSnap = await businessRef.collection('delivery_settings').doc('config').get();
        const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
        const fallback = (key, defaultVal) => deliveryConfig[key] ?? finalBusinessData[key] ?? defaultVal;

        const responseData = {
            name: finalUserData.name, email: finalUserData.email, phone: finalUserData.phone,
            role: finalUserData.role, restaurantName: finalBusinessData?.name || '',
            profilePicture: finalUserData.profilePictureUrl, notifications: finalUserData.notifications,
            gstin: finalBusinessData?.gstin || '', fssai: finalBusinessData?.fssai || '',
            botPhoneNumberId: finalBusinessData?.botPhoneNumberId || '',
            botDisplayNumber: finalBusinessData?.botDisplayNumber || '',
            razorpayAccountId: finalBusinessData?.razorpayAccountId || '',
            logoUrl: finalBusinessData?.logoUrl || '', bannerUrls: finalBusinessData?.bannerUrls || [],
            // Delivery (from Sub-coll)
            deliveryEnabled: fallback('deliveryEnabled', true),
            deliveryRadius: fallback('deliveryRadius', 5),
            deliveryFeeType: fallback('deliveryFeeType', 'fixed'),
            // FIXED: Calculate deliveryCharge (Unified Field)
            deliveryCharge: fallback('deliveryFeeType', 'fixed') === 'fixed' ? fallback('deliveryFixedFee', 30) : 0,
            deliveryFixedFee: fallback('deliveryFixedFee', 30),
            deliveryPerKmFee: fallback('deliveryPerKmFee', 5),
            deliveryFreeThreshold: fallback('deliveryFreeThreshold', 500),
            deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
            deliveryCodEnabled: fallback('deliveryCodEnabled', true),
            // NEW: Road factor & free delivery zone
            roadDistanceFactor: fallback('roadDistanceFactor', 1.0),
            freeDeliveryRadius: fallback('freeDeliveryRadius', 0),
            freeDeliveryMinOrder: fallback('freeDeliveryMinOrder', 0),
            // Other
            pickupEnabled: fallback('pickupEnabled', false),
            dineInEnabled: fallback('dineInEnabled', true),
            pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
            pickupPodEnabled: fallback('pickupPodEnabled', true),
            dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
            dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
            isOpen: finalBusinessData?.isOpen === undefined ? true : finalBusinessData.isOpen,
            dineInModel: finalBusinessData?.dineInModel || 'post-paid',
            address: finalBusinessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            // Add-on Charges Configuration
            gstEnabled: finalBusinessData?.gstEnabled || false,
            gstRate: finalBusinessData?.gstPercentage || finalBusinessData?.gstRate || 5,
            gstMinAmount: finalBusinessData?.gstMinAmount || 0,
            convenienceFeeEnabled: finalBusinessData?.convenienceFeeEnabled || false,
            convenienceFeeRate: finalBusinessData?.convenienceFeeRate || 2.5,
            convenienceFeePaidBy: finalBusinessData?.convenienceFeePaidBy || 'customer',
            convenienceFeeLabel: finalBusinessData?.convenienceFeeLabel || 'Payment Processing Fee',
            packagingChargeEnabled: finalBusinessData?.packagingChargeEnabled || false,
            packagingChargeAmount: finalBusinessData?.packagingChargeAmount || 0,
            businessId: finalBusinessId,
            merchantId: finalBusinessData?.merchantId || '',
            customerId: finalUserData?.customerId || '',
            gstPercentage: finalBusinessData?.gstPercentage || finalBusinessData?.gstRate || 0,
        };

        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error("PATCH SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
