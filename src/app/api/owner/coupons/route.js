
import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { logAuditEvent, AUDIT_ACTIONS } from '@/lib/security/audit-log';
import { sendSystemMessage } from '@/lib/whatsapp';
import { couponLimiter } from '@/lib/security/rate-limiter';
import { verifyOwnerFeatureAccess } from '@/lib/verify-owner-with-audit';
import { markMenuSnapshotStale } from '@/lib/server/menuSnapshot';


export async function GET(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerFeatureAccess(req, 'coupons', 'view_coupons');

        const couponsRef = firestore.collection(collectionName).doc(businessId).collection('coupons');
        const couponsSnap = await couponsRef.orderBy('expiryDate', 'desc').get();

        let coupons = couponsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return NextResponse.json({ coupons }, { status: 200 });

    } catch (error) {
        console.error("GET COUPONS ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName, uid, businessSnap, callerRole: userRole } = await verifyOwnerFeatureAccess(req, 'coupons', 'create_coupon');
        const businessData = businessSnap.data() || {};
        const { coupon } = await req.json();

        // 🔒 Rate limit check (15 coupon operations per minute)
        const rateLimitCheck = couponLimiter.check(uid, businessId);
        if (!rateLimitCheck.allowed) {
            logAuditEvent({
                actorUid: uid,
                actorRole: userRole,
                action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                targetUid: null,
                outletId: businessId,
                metadata: {
                    endpoint: 'coupon_create',
                    limit: '15/min',
                    retryAfter: rateLimitCheck.retryAfter
                },
                source: 'rate_limiter',
                req
            }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

            return NextResponse.json({
                message: `Too many coupon operations. Please wait ${rateLimitCheck.retryAfter} seconds.`
            }, { status: 429 });
        }

        // Updated Validation
        const isFreeDelivery = coupon.type === 'free_delivery';
        if (!coupon || !coupon.code || coupon.minOrder === undefined || (!isFreeDelivery && coupon.value === undefined)) {
            return NextResponse.json({ message: 'Missing required coupon data.' }, { status: 400 });
        }

        const couponsCollectionRef = firestore.collection(collectionName).doc(businessId).collection('coupons');
        const newCouponRef = couponsCollectionRef.doc();

        const newCouponData = {
            ...coupon,
            id: newCouponRef.id,
            timesUsed: 0,
            value: isFreeDelivery ? 0 : Number(coupon.value),
            maxDiscount: coupon.type === 'percentage' ? (Number(coupon.maxDiscount) || 0) : 0,
            singleUsePerCustomer: coupon.singleUsePerCustomer === true,
            redeemedCustomerIds: [],
            createdAt: FieldValue.serverTimestamp(),
            startDate: new Date(coupon.startDate),
            expiryDate: new Date(coupon.expiryDate),
        };

        await newCouponRef.set(newCouponData);

        // 🔍 Audit log: COUPON_CREATE (fire-and-forget)
        logAuditEvent({
            actorUid: uid,
            actorRole: userRole,
            action: AUDIT_ACTIONS.COUPON_CREATE,
            targetUid: null,
            outletId: businessId,
            metadata: {
                couponId: newCouponRef.id,
                couponCode: coupon.code,
                discountType: coupon.type, // 'percentage', 'fixed', 'free_delivery'
                discountValue: isFreeDelivery ? 0 : coupon.value,
                minOrder: coupon.minOrder,
                expiryDate: coupon.expiryDate,
                createdAt: new Date().toISOString()
            },
            source: 'coupons_api',
            req
        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

        // 📱 SEND WHATSAPP NOTIFICATION
        if (businessData.botPhoneNumberId && coupon.customerId) {
            try {
                // 1. Fetch Customer to get Phone Number
                const customerDoc = await firestore.collection(collectionName).doc(businessId).collection('customers').doc(coupon.customerId).get();
                if (customerDoc.exists) {
                    const customerData = customerDoc.data();
                    const phone = customerData.phone || customerData.phoneNumber || customerData.contactInfo?.phone;

                    if (phone) {
                        // Ensure phone has country code (default to 91 if missing and looks like 10 digits)
                        let formattedPhone = phone.toString().replace(/\D/g, ''); // Remove non-digits
                        if (formattedPhone.length === 10) formattedPhone = '91' + formattedPhone;

                        const discountText = isFreeDelivery ? 'FREE DELIVERY' : (coupon.type === 'percentage' ? `${coupon.value}% OFF` : `₹${coupon.value} OFF`);
                        const message = `High five, ${customerData.name?.split(' ')[0] || 'there'}! 🙌\n\nYou've just unlocked a special reward at ${businessData.name}: *${discountText}*!\n\nUse Code: *${coupon.code}*\n${coupon.description || ''}\n\nMinimum Order: ₹${coupon.minOrder}\nValid until: ${new Date(coupon.expiryDate).toLocaleDateString('en-IN')}\n\nOrder now to redeem! 🍕`;

                        await sendSystemMessage(
                            formattedPhone,
                            message,
                            businessData.botPhoneNumberId,
                            businessId,
                            businessData.name || 'Your Restaurant',
                            collectionName,
                            {
                                customerName: customerData.name || null,
                                conversationPreview: `Reward sent: ${coupon.code}`,
                            }
                        );
                    } else {
                        console.warn(`[Coupon API] Customer ${coupon.customerId} has no phone number. Skipped WhatsApp.`);
                    }
                }
            } catch (waError) {
                console.error(`[Coupon API] Failed to send WhatsApp notification: ${waError.message}`);
                // Verify we don't fail the request request just because notification failed
            }
        }

        // 🔄 CACHE INVALIDATION: Increment menuVersion to force public API refresh
        const businessRef = firestore.collection(collectionName).doc(businessId);
        await businessRef.update({
            menuVersion: FieldValue.increment(1)
        });
        await markMenuSnapshotStale({
            businessRef,
            businessId,
            collectionName,
            reason: 'coupon_created',
        });

        return NextResponse.json({ message: 'Coupon created successfully!', id: newCouponRef.id }, { status: 201 });

    } catch (error) {
        console.error("POST COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}

export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName } = await verifyOwnerFeatureAccess(req, 'coupons', 'update_coupon');
        const { coupon } = await req.json();

        if (!coupon || !coupon.id) {
            return NextResponse.json({ message: 'Coupon ID is required for updating.' }, { status: 400 });
        }

        const couponRef = firestore.collection(collectionName).doc(businessId).collection('coupons').doc(coupon.id);

        const { id, timesUsed, createdAt, ...updateData } = coupon;

        if (updateData.type === 'free_delivery') {
            updateData.value = 0;
            updateData.maxDiscount = 0;
        } else {
            updateData.value = Number(updateData.value);
            updateData.maxDiscount = updateData.type === 'percentage' ? (Number(updateData.maxDiscount) || 0) : 0;
        }

        updateData.singleUsePerCustomer = updateData.singleUsePerCustomer === true;

        if (updateData.startDate) {
            updateData.startDate = new Date(updateData.startDate);
        }
        if (updateData.expiryDate) {
            updateData.expiryDate = new Date(updateData.expiryDate);
        }

        await couponRef.update(updateData);

        // 🔄 CACHE INVALIDATION: Increment menuVersion to force public API refresh
        const businessRef = firestore.collection(collectionName).doc(businessId);
        await businessRef.update({
            menuVersion: FieldValue.increment(1)
        });
        await markMenuSnapshotStale({
            businessRef,
            businessId,
            collectionName,
            reason: 'coupon_updated',
        });

        return NextResponse.json({ message: 'Coupon updated successfully!' }, { status: 200 });

    } catch (error) {
        console.error("PATCH COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}


export async function DELETE(req) {
    try {
        const firestore = await getFirestore();
        const { businessId, collectionName, uid, callerRole: userRole } = await verifyOwnerFeatureAccess(req, 'coupons', 'delete_coupon');
        const { couponId } = await req.json();

        if (!couponId) {
            return NextResponse.json({ message: 'Coupon ID is required.' }, { status: 400 });
        }

        // 🔒 Rate limit check (15 coupon operations per minute)
        const rateLimitCheck = couponLimiter.check(uid, businessId);
        if (!rateLimitCheck.allowed) {
            logAuditEvent({
                actorUid: uid,
                actorRole: userRole,
                action: AUDIT_ACTIONS.RATE_LIMIT_VIOLATION,
                targetUid: null,
                outletId: businessId,
                metadata: {
                    endpoint: 'coupon_delete',
                    limit: '15/min',
                    retryAfter: rateLimitCheck.retryAfter
                },
                source: 'rate_limiter',
                req
            }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

            return NextResponse.json({
                message: `Too many coupon operations. Please wait ${rateLimitCheck.retryAfter} seconds.`
            }, { status: 429 });
        }

        // Fetch coupon data before deleting for audit log
        const couponRef = firestore.collection(collectionName).doc(businessId).collection('coupons').doc(couponId);
        const couponSnap = await couponRef.get();

        let couponData = {};
        if (couponSnap.exists) {
            couponData = couponSnap.data();
        }

        await couponRef.delete();

        // 🔄 CACHE INVALIDATION: Increment menuVersion to force public API refresh
        const businessRef = firestore.collection(collectionName).doc(businessId);
        await businessRef.update({
            menuVersion: FieldValue.increment(1)
        });
        await markMenuSnapshotStale({
            businessRef,
            businessId,
            collectionName,
            reason: 'coupon_deleted',
        });

        // 🔍 Audit log: COUPON_DELETE (fire-and-forget)
        logAuditEvent({
            actorUid: uid,
            actorRole: userRole,
            action: AUDIT_ACTIONS.COUPON_DELETE,
            targetUid: null,
            outletId: businessId,
            metadata: {
                couponId,
                couponCode: couponData.code || 'N/A',
                discountType: couponData.type || 'N/A',
                discountValue: couponData.value || 0,
                timesUsed: couponData.timesUsed || 0,
                deletedAt: new Date().toISOString()
            },
            source: 'coupons_api',
            req
        }).catch(err => console.error('[AUDIT_LOG_FAILED]', err));

        return NextResponse.json({ message: 'Coupon deleted successfully.' }, { status: 200 });
    } catch (error) {
        console.error("DELETE COUPON ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: error.status || 500 });
    }
}
