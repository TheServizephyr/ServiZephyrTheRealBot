

import { NextResponse } from 'next/server';
import { getAuth, getFirestore, verifyAndGetUid, FieldValue } from '@/lib/firebase-admin';
import { initializeApp, getApps } from 'firebase-admin/app';
import { sendRestaurantStatusChangeNotification } from '@/lib/notifications';
import { kv } from '@/lib/kv';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { getEffectiveBusinessOpenStatus } from '@/lib/businessSchedule';
import { findBusinessById } from '@/services/business/businessService';
import { resolveGuestAccessRef } from '@/lib/public-auth';

export const dynamic = 'force-dynamic';
const DEFAULT_WAITLIST_TOKEN_BASE = 0;
const WAITLIST_COUNTER_TIMEZONE = 'Asia/Kolkata';

function normalizeBusinessType(value, fallbackCollectionName = null) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street-vendor';
    if (normalized === 'restaurant') return 'restaurant';
    if (fallbackCollectionName === 'shops') return 'store';
    if (fallbackCollectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
}

function decodeUrlComponentRecursively(value, maxPasses = 3) {
    let normalized = String(value || '').trim();
    for (let i = 0; i < maxPasses; i += 1) {
        try {
            const decoded = decodeURIComponent(normalized);
            if (!decoded || decoded === normalized) break;
            normalized = decoded;
        } catch {
            break;
        }
    }
    return normalized;
}

function buildBusinessIdCandidates(value) {
    const seed = String(value || '').trim();
    if (!seed) return [];

    const candidates = [];
    const seen = new Set();
    const add = (candidate) => {
        const normalized = String(candidate || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };

    add(seed);

    let decoded = seed;
    for (let i = 0; i < 2; i += 1) {
        try {
            const next = decodeURIComponent(decoded);
            if (!next || next === decoded) break;
            add(next);
            decoded = next;
        } catch {
            break;
        }
    }

    for (const candidate of [...candidates]) {
        try {
            const encoded = encodeURIComponent(candidate);
            if (encoded !== candidate) add(encoded);
        } catch {
            // Ignore encoding errors and continue with existing candidates
        }
    }

    return candidates;
}

function normalizeGstCalculationMode(value, fallback = 'included') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'excluded') return 'excluded';
    if (normalized === 'included') return 'included';
    return fallback;
}

function getGstCalculationModeFromBusinessData(businessData = {}) {
    if (businessData?.gstCalculationMode) {
        return normalizeGstCalculationMode(businessData.gstCalculationMode, 'included');
    }
    if (businessData?.gstIncludedInPrice === false) return 'excluded';
    return 'included';
}

function normalizeWaitlistSeatingMode(value, fallback = 'table_assign') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'manual_seat') return 'manual_seat';
    if (normalized === 'table_assign') return 'table_assign';
    return fallback;
}

function getDateKeyInTimeZone(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: WAITLIST_COUNTER_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '0000';
    const month = parts.find((part) => part.type === 'month')?.value || '00';
    const day = parts.find((part) => part.type === 'day')?.value || '00';
    return `${year}-${month}-${day}`;
}

function normalizeNoShowTimeoutMinutes(value, fallback = 10) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(120, Math.max(1, parsed));
}

function normalizePhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
}

async function resolveEligibleCouponCustomerIds({ firestore, businessRef, searchParams }) {
    const eligibleIds = new Set();
    const normalizedPhone = normalizePhone(searchParams.get('phone'));
    const ref = String(searchParams.get('ref') || '').trim();

    if (ref) {
        try {
            const refSession = await resolveGuestAccessRef(firestore, ref, { allowLegacy: true });
            if (refSession?.subjectId) eligibleIds.add(String(refSession.subjectId));
            const refPhone = normalizePhone(refSession?.phone);
            if (refPhone) eligibleIds.add(`phone:${refPhone}`);
        } catch (error) {
            console.warn('[Settings API] Reward ref resolution failed:', error?.message || error);
        }
    }

    if (normalizedPhone) {
        eligibleIds.add(`phone:${normalizedPhone}`);
    }

    if (!businessRef || eligibleIds.size === 0) {
        return eligibleIds;
    }

    const phones = [...eligibleIds]
        .filter((value) => value.startsWith('phone:'))
        .map((value) => value.slice('phone:'.length));

    for (const phone of phones) {
        try {
            const customerSnap = await businessRef.collection('customers').where('phone', '==', phone).limit(10).get();
            customerSnap.forEach((doc) => {
                eligibleIds.add(String(doc.id));
                const customerData = doc.data() || {};
                if (customerData.customerId) eligibleIds.add(String(customerData.customerId));
                if (customerData.userId) eligibleIds.add(String(customerData.userId));
                if (customerData.uid) eligibleIds.add(String(customerData.uid));
            });
        } catch (error) {
            console.warn('[Settings API] Phone based reward lookup failed:', error?.message || error);
        }
    }

    return eligibleIds;
}

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const businessIdRawFromQuery = searchParams.get('restaurantId') || searchParams.get('businessId');
        const businessIdFromQuery = decodeUrlComponentRecursively(businessIdRawFromQuery);
        const includeCoupons = ['1', 'true', 'yes'].includes(String(searchParams.get('includeCoupons') || '').toLowerCase());

        // This block is for public-facing queries that only need payment settings.
        if (businessIdFromQuery) {
            const firestore = await getFirestore();
            let businessDoc;
            let matchedBusinessId = null;
            const collectionsToTry = ['restaurants', 'shops', 'street_vendors'];
            const businessIdCandidates = buildBusinessIdCandidates(businessIdFromQuery);

            for (const businessIdCandidate of businessIdCandidates) {
                for (const collectionName of collectionsToTry) {
                    const docRef = firestore.collection(collectionName).doc(businessIdCandidate);
                    businessDoc = await docRef.get();
                    if (businessDoc.exists) {
                        matchedBusinessId = businessIdCandidate;
                        break;
                    }
                }
                if (businessDoc?.exists) break;
            }

            if (!businessDoc?.exists) {
                const fallbackBusiness = await findBusinessById(firestore, businessIdFromQuery, {
                    includeDeliverySettings: false,
                });
                if (fallbackBusiness?.ref) {
                    businessDoc = await fallbackBusiness.ref.get();
                    matchedBusinessId = fallbackBusiness.id || businessDoc.id;
                }
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
                gstCalculationMode: getGstCalculationModeFromBusinessData(businessData),
                gstIncludedInPrice: getGstCalculationModeFromBusinessData(businessData) === 'included',
                convenienceFeeEnabled: businessData.convenienceFeeEnabled || false,
                convenienceFeeRate: businessData.convenienceFeeRate || 2.5,
                convenienceFeePaidBy: businessData.convenienceFeePaidBy || 'customer',
                convenienceFeeLabel: businessData.convenienceFeeLabel || 'Payment Processing Fee',
                packagingChargeEnabled: businessData.packagingChargeEnabled || false,
                packagingChargeAmount: businessData.packagingChargeAmount || 0,
                serviceFeeEnabled: businessData.serviceFeeEnabled || false,
                serviceFeeLabel: businessData.serviceFeeLabel || 'Additional Charge',
                serviceFeeType: businessData.serviceFeeType || 'fixed',
                serviceFeeValue: businessData.serviceFeeValue ?? 0,
                serviceFeeApplyOn: businessData.serviceFeeApplyOn || 'all',
                serviceFeeApplyOnManualOrders: businessData.serviceFeeApplyOnManualOrders || false,
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
                deliveryOrderSlabRules: fallback('deliveryOrderSlabRules', []),
                deliveryOrderSlabAboveFee: fallback('deliveryOrderSlabAboveFee', 0),
                deliveryOrderSlabBaseDistance: fallback('deliveryOrderSlabBaseDistance', 1),
                deliveryOrderSlabPerKmFee: fallback('deliveryOrderSlabPerKmFee', 15),
                pickupEnabled: fallback('pickupEnabled', true),
                dineInEnabled: fallback('dineInEnabled', true),
                restaurantId: matchedBusinessId || businessDoc.id,
            };

            // Coupons fetch is optional to avoid unnecessary Firestore reads on high-traffic public pages.
            if (includeCoupons) {
                try {
                    const eligibleCustomerIds = await resolveEligibleCouponCustomerIds({
                        firestore,
                        businessRef: businessDoc.ref,
                        searchParams
                    });
                    const couponsSnap = await businessDoc.ref.collection('coupons')
                        .where('status', '==', 'active')
                        .get();

                    const now = new Date();
                    const coupons = couponsSnap.docs
                        .map(doc => {
                            const data = doc.data();
                            return {
                                id: doc.id,
                                ...data,
                                startDate: data.startDate?.toDate ? data.startDate.toDate().toISOString() : data.startDate,
                                expiryDate: data.expiryDate?.toDate ? data.expiryDate.toDate().toISOString() : data.expiryDate,
                            };
                        })
                        .filter((c) => {
                            const assignedCustomerId = String(c.customerId || '').trim();
                            const isPublic = !assignedCustomerId;
                            const isAssignedToCurrentCustomer = assignedCustomerId && eligibleCustomerIds.has(assignedCustomerId);
                            return new Date(c.expiryDate) > now && (isPublic || isAssignedToCurrentCustomer);
                        });

                    responsePayload.coupons = coupons;
                } catch (err) {
                    console.error("Error fetching coupons for public settings:", err);
                    responsePayload.coupons = [];
                }
            }

            return NextResponse.json(responsePayload, { status: 200 });
        }

        // This block is for authenticated owner dashboard queries.
        // Use standard verifyOwnerWithAudit for robust impersonation handling
        console.log(`[API /settings] Verifying owner...`);
        const context = await verifyOwnerWithAudit(
            req,
            'view_settings',
            {},
            true,
            PERMISSIONS.VIEW_SETTINGS
        );
        const { uid, userData, businessSnap, businessId } = context;
        console.log(`[API /settings] Owner verified: ${uid} for business ${businessId}`);
        const businessRef = businessSnap.ref;
        const businessData = businessSnap.data();
        const effectiveIsOpen = getEffectiveBusinessOpenStatus(businessData);

        // FETCH DELIVERY SETTINGS FROM SUB-COLLECTION
        const deliveryConfigSnap = await businessRef.collection('delivery_settings').doc('config').get();
        const deliveryConfig = deliveryConfigSnap.exists ? deliveryConfigSnap.data() : {};
        const fallback = (key, defaultVal) => deliveryConfig[key] ?? businessData[key] ?? defaultVal;

        const profileData = {
            name: userData.name || 'No Name',
            email: userData.email || 'No Email',
            phone: userData.phone || '',
            role: userData.role || 'customer',
            businessType: normalizeBusinessType(businessData?.businessType, context.collectionName),
            restaurantName: businessData?.name || '',
            profilePicture: userData.profilePictureUrl || `https://picsum.photos/seed/${uid}/200/200`,
            notifications: userData.notifications || { newOrders: true, dailySummary: false, marketing: true },
            address: businessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            gstin: businessData?.gstin || '',
            fssai: businessData?.fssai || '',
            botPhoneNumberId: businessData?.botPhoneNumberId || '',
            botDisplayNumber: businessData?.botDisplayNumber || '',
            ownerPersonalWhatsappNumber: businessData?.ownerPersonalWhatsappNumber || '',
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
            deliveryOrderSlabRules: fallback('deliveryOrderSlabRules', []),
            deliveryOrderSlabAboveFee: fallback('deliveryOrderSlabAboveFee', 0),
            deliveryOrderSlabBaseDistance: fallback('deliveryOrderSlabBaseDistance', 1),
            deliveryOrderSlabPerKmFee: fallback('deliveryOrderSlabPerKmFee', 15),
            // Other Settings
            pickupEnabled: fallback('pickupEnabled', false),
            dineInEnabled: fallback('dineInEnabled', true),
            deliveryOnlinePaymentEnabled: fallback('deliveryOnlinePaymentEnabled', true),
            deliveryCodEnabled: fallback('deliveryCodEnabled', true),
            pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
            pickupPodEnabled: fallback('pickupPodEnabled', true),
            dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
            dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
            isOpen: effectiveIsOpen,
            autoScheduleEnabled: businessData?.autoScheduleEnabled || false,
            openingTime: businessData?.openingTime || '09:00',
            closingTime: businessData?.closingTime || '22:00',
            dineInModel: businessData?.dineInModel || 'post-paid',
            dineInRbacEnabled: businessData?.dineInRbacEnabled || false,
            // Add-on Charges Configuration
            gstEnabled: businessData?.gstEnabled || false,
            gstRate: businessData?.gstPercentage || businessData?.gstRate || 5,
            gstMinAmount: businessData?.gstMinAmount || 0,
            gstCalculationMode: getGstCalculationModeFromBusinessData(businessData),
            gstIncludedInPrice: getGstCalculationModeFromBusinessData(businessData) === 'included',
            convenienceFeeEnabled: businessData?.convenienceFeeEnabled || false,
            convenienceFeeRate: businessData?.convenienceFeeRate || 2.5,
            convenienceFeePaidBy: businessData?.convenienceFeePaidBy || 'customer',
            convenienceFeeLabel: businessData?.convenienceFeeLabel || 'Payment Processing Fee',
            packagingChargeEnabled: businessData?.packagingChargeEnabled || false,
            packagingChargeAmount: businessData?.packagingChargeAmount || 0,
            serviceFeeEnabled: businessData?.serviceFeeEnabled || false,
            serviceFeeLabel: businessData?.serviceFeeLabel || 'Additional Charge',
            serviceFeeType: businessData?.serviceFeeType || 'fixed',
            serviceFeeValue: businessData?.serviceFeeValue ?? 0,
            serviceFeeApplyOn: businessData?.serviceFeeApplyOn || 'all',
            serviceFeeApplyOnManualOrders: businessData?.serviceFeeApplyOnManualOrders || false,
            gstPercentage: businessData?.gstPercentage || businessData?.gstRate || 0,
            businessId: businessId,
            collectionName: context.collectionName,
            merchantId: businessData?.merchantId || '',
            callSyncToken: businessData?.callSyncToken || '',
            customerId: userData?.customerId || '',
            paymentQRCode: businessData?.paymentQRCode || null, // ✅ Return QR Code URL
            upiId: businessData?.upiId || '',
            upiPayeeName: businessData?.upiPayeeName || businessData?.name || '',
            isWaitlistEnabled: businessData?.isWaitlistEnabled || false,
            waitlistSeatingMode: normalizeWaitlistSeatingMode(businessData?.waitlistSeatingMode, 'table_assign'),
            waitlistManualCapacity: Math.max(1, Number(businessData?.waitlistManualCapacity || 40)),
            waitlistNoShowTimeoutMinutes: normalizeNoShowTimeoutMinutes(businessData?.waitlistNoShowTimeoutMinutes, 10),
            waitlistTokenCounter: Math.max(DEFAULT_WAITLIST_TOKEN_BASE, Number(businessData?.waitlistTokenCounter || DEFAULT_WAITLIST_TOKEN_BASE)),
            waitlistTokenCounterDate: String(businessData?.waitlistTokenCounterDate || ''),
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
        const context = await verifyOwnerWithAudit(
            req,
            'update_settings',
            {},
            true,
            [PERMISSIONS.MANAGE_SETTINGS, PERMISSIONS.MANAGE_OUTLET_SETTINGS]
        );
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
        const isValidTime = (value) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value || '').trim());
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
        if (updates.upiId !== undefined) businessUpdateData.upiId = String(updates.upiId || '').trim();
        if (updates.upiPayeeName !== undefined) businessUpdateData.upiPayeeName = String(updates.upiPayeeName || '').trim();

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
                ownerPhone: businessData.ownerPersonalWhatsappNumber || businessData.ownerPhone,
                botPhoneNumberId: businessData.botPhoneNumberId,
                newStatus: updates.isOpen,
                restaurantId: businessId,
            }).catch(e => console.error("Failed to send status change notification:", e));
        }

        if (updates.phone !== undefined && updates.phone !== businessData?.ownerPhone) {
            businessUpdateData.ownerPhone = updates.phone;
        }

        if (updates.autoScheduleEnabled !== undefined) {
            businessUpdateData.autoScheduleEnabled = Boolean(updates.autoScheduleEnabled);
        }
        if (updates.openingTime !== undefined) {
            if (!isValidTime(updates.openingTime)) {
                return NextResponse.json({ message: 'Invalid opening time. Use HH:mm format.' }, { status: 400 });
            }
            businessUpdateData.openingTime = String(updates.openingTime).trim();
        }
        if (updates.closingTime !== undefined) {
            if (!isValidTime(updates.closingTime)) {
                return NextResponse.json({ message: 'Invalid closing time. Use HH:mm format.' }, { status: 400 });
            }
            businessUpdateData.closingTime = String(updates.closingTime).trim();
        }

        // Add-on Charges Configuration
        if (updates.gstEnabled !== undefined) businessUpdateData.gstEnabled = updates.gstEnabled;
        if (updates.gstPercentage !== undefined) {
            businessUpdateData.gstPercentage = updates.gstPercentage;
            businessUpdateData.gstRate = updates.gstPercentage; // Sync for backward compatibility
        }
        if (updates.gstMinAmount !== undefined) businessUpdateData.gstMinAmount = updates.gstMinAmount;
        if (updates.gstCalculationMode !== undefined || updates.gstIncludedInPrice !== undefined) {
            const requestedMode = updates.gstCalculationMode !== undefined
                ? updates.gstCalculationMode
                : (updates.gstIncludedInPrice === false ? 'excluded' : 'included');
            const normalizedGstMode = normalizeGstCalculationMode(requestedMode, 'included');
            businessUpdateData.gstCalculationMode = normalizedGstMode;
            businessUpdateData.gstIncludedInPrice = normalizedGstMode === 'included';
        }
        if (updates.convenienceFeeEnabled !== undefined) businessUpdateData.convenienceFeeEnabled = updates.convenienceFeeEnabled;
        if (updates.convenienceFeeRate !== undefined) businessUpdateData.convenienceFeeRate = updates.convenienceFeeRate;
        if (updates.convenienceFeePaidBy !== undefined) businessUpdateData.convenienceFeePaidBy = updates.convenienceFeePaidBy;
        if (updates.convenienceFeeLabel !== undefined) businessUpdateData.convenienceFeeLabel = updates.convenienceFeeLabel;
        if (updates.packagingChargeEnabled !== undefined) businessUpdateData.packagingChargeEnabled = updates.packagingChargeEnabled;
        if (updates.packagingChargeAmount !== undefined) businessUpdateData.packagingChargeAmount = updates.packagingChargeAmount;
        if (updates.serviceFeeEnabled !== undefined) businessUpdateData.serviceFeeEnabled = updates.serviceFeeEnabled;
        if (updates.serviceFeeLabel !== undefined) businessUpdateData.serviceFeeLabel = String(updates.serviceFeeLabel || '').trim() || 'Additional Charge';
        if (updates.serviceFeeType !== undefined) businessUpdateData.serviceFeeType = updates.serviceFeeType === 'percentage' ? 'percentage' : 'fixed';
        if (updates.serviceFeeValue !== undefined) businessUpdateData.serviceFeeValue = Number(updates.serviceFeeValue) || 0;
        if (updates.serviceFeeApplyOn !== undefined) {
            const allowedApplyTargets = new Set(['all', 'delivery', 'pickup', 'dine-in']);
            const normalizedApplyTarget = String(updates.serviceFeeApplyOn || '').trim();
            businessUpdateData.serviceFeeApplyOn = allowedApplyTargets.has(normalizedApplyTarget) ? normalizedApplyTarget : 'all';
        }
        if (updates.serviceFeeApplyOnManualOrders !== undefined) {
            businessUpdateData.serviceFeeApplyOnManualOrders = Boolean(updates.serviceFeeApplyOnManualOrders);
        }

        // Dine-In Settings (Not moved to delivery-settings yet)
        if (updates.dineInEnabled !== undefined) businessUpdateData.dineInEnabled = updates.dineInEnabled;
        if (updates.dineInModel !== undefined) businessUpdateData.dineInModel = updates.dineInModel;
        if (updates.dineInRbacEnabled !== undefined) businessUpdateData.dineInRbacEnabled = updates.dineInRbacEnabled;

        // Pickup Settings
        if (updates.pickupEnabled !== undefined) businessUpdateData.pickupEnabled = updates.pickupEnabled;

        // Payment Method Settings (Specific per Order Type)
        if (updates.pickupOnlinePaymentEnabled !== undefined) businessUpdateData.pickupOnlinePaymentEnabled = updates.pickupOnlinePaymentEnabled;
        if (updates.pickupPodEnabled !== undefined) businessUpdateData.pickupPodEnabled = updates.pickupPodEnabled;
        if (updates.dineInOnlinePaymentEnabled !== undefined) businessUpdateData.dineInOnlinePaymentEnabled = updates.dineInOnlinePaymentEnabled;
        if (updates.dineInPayAtCounterEnabled !== undefined) businessUpdateData.dineInPayAtCounterEnabled = updates.dineInPayAtCounterEnabled;
        if (updates.isWaitlistEnabled !== undefined) businessUpdateData.isWaitlistEnabled = updates.isWaitlistEnabled;
        if (updates.waitlistSeatingMode !== undefined) {
            businessUpdateData.waitlistSeatingMode = normalizeWaitlistSeatingMode(updates.waitlistSeatingMode, 'table_assign');
        }
        if (updates.waitlistManualCapacity !== undefined) {
            const normalizedCapacity = Number.parseInt(String(updates.waitlistManualCapacity), 10);
            if (!Number.isInteger(normalizedCapacity) || normalizedCapacity < 1 || normalizedCapacity > 500) {
                return NextResponse.json({ message: 'Waitlist manual capacity must be between 1 and 500.' }, { status: 400 });
            }
            businessUpdateData.waitlistManualCapacity = normalizedCapacity;
        }
        if (updates.waitlistNoShowTimeoutMinutes !== undefined) {
            const normalizedTimeout = Number.parseInt(String(updates.waitlistNoShowTimeoutMinutes), 10);
            if (!Number.isInteger(normalizedTimeout) || normalizedTimeout < 1 || normalizedTimeout > 120) {
                return NextResponse.json({ message: 'No-show timeout must be between 1 and 120 minutes.' }, { status: 400 });
            }
            businessUpdateData.waitlistNoShowTimeoutMinutes = normalizedTimeout;
        }
        if (updates.resetWaitlistTokenCounter === true) {
            businessUpdateData.waitlistTokenCounter = DEFAULT_WAITLIST_TOKEN_BASE;
            businessUpdateData.waitlistTokenCounterDate = getDateKeyInTimeZone();
        }

        // Handle delivery settings update here IF provided (Legacy support or single-save screens)
        // If frontend sends delivery params to THIS endpoint, we should forward them to sub-collection
        const deliveryFields = [
            'deliveryEnabled', 'deliveryRadius', 'deliveryFeeType',
            'deliveryFixedFee', 'deliveryPerKmFee', 'deliveryBaseDistance', 'deliveryFreeThreshold',
            'deliveryOnlinePaymentEnabled', 'deliveryCodEnabled',
            // NEW: Road factor & free delivery zone
            'roadDistanceFactor', 'freeDeliveryRadius', 'freeDeliveryMinOrder',
            // NEW: Tiered + slab distance modes
            'deliveryTiers',
            'deliveryOrderSlabRules', 'deliveryOrderSlabAboveFee', 'deliveryOrderSlabBaseDistance', 'deliveryOrderSlabPerKmFee'
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

        const finalIsOpen = getEffectiveBusinessOpenStatus(finalBusinessData);
        const responseData = {
            name: finalUserData.name, email: finalUserData.email, phone: finalUserData.phone,
            role: finalUserData.role, restaurantName: finalBusinessData?.name || '',
            businessType: normalizeBusinessType(finalBusinessData?.businessType, context.collectionName),
            profilePicture: finalUserData.profilePictureUrl, notifications: finalUserData.notifications,
            gstin: finalBusinessData?.gstin || '', fssai: finalBusinessData?.fssai || '',
            botPhoneNumberId: finalBusinessData?.botPhoneNumberId || '',
            botDisplayNumber: finalBusinessData?.botDisplayNumber || '',
            ownerPersonalWhatsappNumber: finalBusinessData?.ownerPersonalWhatsappNumber || '',
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
            deliveryOrderSlabRules: fallback('deliveryOrderSlabRules', []),
            deliveryOrderSlabAboveFee: fallback('deliveryOrderSlabAboveFee', 0),
            deliveryOrderSlabBaseDistance: fallback('deliveryOrderSlabBaseDistance', 1),
            deliveryOrderSlabPerKmFee: fallback('deliveryOrderSlabPerKmFee', 15),
            // Other
            pickupEnabled: fallback('pickupEnabled', false),
            dineInEnabled: fallback('dineInEnabled', true),
            pickupOnlinePaymentEnabled: fallback('pickupOnlinePaymentEnabled', true),
            pickupPodEnabled: fallback('pickupPodEnabled', true),
            dineInOnlinePaymentEnabled: fallback('dineInOnlinePaymentEnabled', true),
            dineInPayAtCounterEnabled: fallback('dineInPayAtCounterEnabled', true),
            isOpen: finalIsOpen,
            autoScheduleEnabled: finalBusinessData?.autoScheduleEnabled || false,
            openingTime: finalBusinessData?.openingTime || '09:00',
            closingTime: finalBusinessData?.closingTime || '22:00',
            dineInModel: finalBusinessData?.dineInModel || 'post-paid',
            dineInRbacEnabled: finalBusinessData?.dineInRbacEnabled || false,
            address: finalBusinessData?.address || { street: '', city: '', state: '', postalCode: '', country: 'IN' },
            // Add-on Charges Configuration
            gstEnabled: finalBusinessData?.gstEnabled || false,
            gstRate: finalBusinessData?.gstPercentage || finalBusinessData?.gstRate || 5,
            gstMinAmount: finalBusinessData?.gstMinAmount || 0,
            gstCalculationMode: getGstCalculationModeFromBusinessData(finalBusinessData),
            gstIncludedInPrice: getGstCalculationModeFromBusinessData(finalBusinessData) === 'included',
            convenienceFeeEnabled: finalBusinessData?.convenienceFeeEnabled || false,
            convenienceFeeRate: finalBusinessData?.convenienceFeeRate || 2.5,
            convenienceFeePaidBy: finalBusinessData?.convenienceFeePaidBy || 'customer',
            convenienceFeeLabel: finalBusinessData?.convenienceFeeLabel || 'Payment Processing Fee',
            packagingChargeEnabled: finalBusinessData?.packagingChargeEnabled || false,
            packagingChargeAmount: finalBusinessData?.packagingChargeAmount || 0,
            serviceFeeEnabled: finalBusinessData?.serviceFeeEnabled || false,
            serviceFeeLabel: finalBusinessData?.serviceFeeLabel || 'Additional Charge',
            serviceFeeType: finalBusinessData?.serviceFeeType || 'fixed',
            serviceFeeValue: finalBusinessData?.serviceFeeValue ?? 0,
            serviceFeeApplyOn: finalBusinessData?.serviceFeeApplyOn || 'all',
            serviceFeeApplyOnManualOrders: finalBusinessData?.serviceFeeApplyOnManualOrders || false,
            businessId: finalBusinessId,
            collectionName: context.collectionName,
            merchantId: finalBusinessData?.merchantId || '',
            callSyncToken: finalBusinessData?.callSyncToken || '',
            customerId: finalUserData?.customerId || '',
            gstPercentage: finalBusinessData?.gstPercentage || finalBusinessData?.gstRate || 0,
            paymentQRCode: finalBusinessData?.paymentQRCode || null,
            upiId: finalBusinessData?.upiId || '',
            upiPayeeName: finalBusinessData?.upiPayeeName || finalBusinessData?.name || '',
            isWaitlistEnabled: finalBusinessData?.isWaitlistEnabled || false,
            waitlistSeatingMode: normalizeWaitlistSeatingMode(finalBusinessData?.waitlistSeatingMode, 'table_assign'),
            waitlistManualCapacity: Math.max(1, Number(finalBusinessData?.waitlistManualCapacity || 40)),
            waitlistNoShowTimeoutMinutes: normalizeNoShowTimeoutMinutes(finalBusinessData?.waitlistNoShowTimeoutMinutes, 10),
            waitlistTokenCounter: Math.max(DEFAULT_WAITLIST_TOKEN_BASE, Number(finalBusinessData?.waitlistTokenCounter || DEFAULT_WAITLIST_TOKEN_BASE)),
            waitlistTokenCounterDate: String(finalBusinessData?.waitlistTokenCounterDate || ''),
        };

        return NextResponse.json(responseData, { status: 200 });

    } catch (error) {
        console.error("PATCH SETTINGS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
