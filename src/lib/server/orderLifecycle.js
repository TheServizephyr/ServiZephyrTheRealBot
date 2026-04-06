import { FieldValue } from '@/lib/firebase-admin';
import { rebuildBusinessCustomerProfile } from '@/lib/customer-profiles';

function normalizeCollectionName(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'restaurants' || normalized === 'restaurant') return 'restaurants';
    if (normalized === 'shops' || normalized === 'shop' || normalized === 'store') return 'shops';
    if (normalized === 'street_vendors' || normalized === 'street-vendor' || normalized === 'street_vendor') return 'street_vendors';
    return '';
}

function normalizeBusinessTypeToCollection(businessType = '') {
    const normalized = String(businessType || '').trim().toLowerCase();
    if (normalized === 'shop' || normalized === 'store') return 'shops';
    if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street_vendors';
    if (normalized === 'restaurant') return 'restaurants';
    return '';
}

function normalizeCustomerActorId(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (/^\d{10}$/.test(normalized)) return '';
    if (normalized.startsWith('phone:')) return '';
    return normalized;
}

export function resolveOrderCustomerActorId(orderData = {}) {
    return (
        normalizeCustomerActorId(orderData.userId) ||
        normalizeCustomerActorId(orderData.customerId) ||
        normalizeCustomerActorId(orderData.actorUid)
    );
}

export function resolveOrderBusinessCollection(orderData = {}, fallbackCollection = '') {
    return (
        normalizeCollectionName(fallbackCollection) ||
        normalizeBusinessTypeToCollection(orderData.businessType)
    );
}

function getCouponRedemptionKeysFromOrder(orderData = {}) {
    return [...new Set(
        (Array.isArray(orderData?.couponRedemptionKeys) ? orderData.couponRedemptionKeys : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )];
}

export async function rebuildCustomerProfileForOrder({
    firestore,
    orderData,
    fallbackCollection = '',
} = {}) {
    const businessId = String(orderData?.restaurantId || '').trim();
    const businessCollection = resolveOrderBusinessCollection(orderData, fallbackCollection);
    const customerDocId = resolveOrderCustomerActorId(orderData);

    if (!firestore || !businessId || !businessCollection || !customerDocId) return false;

    await rebuildBusinessCustomerProfile({
        firestore,
        businessCollection,
        businessId,
        customerDocId,
        customerName: orderData?.customerName || '',
        customerEmail: orderData?.customerEmail || '',
        customerPhone: orderData?.customerPhone || '',
        customerAddress: orderData?.customerAddress || null,
        customerStatus: String(customerDocId).startsWith('g_') ? 'unclaimed' : 'verified',
        customerType: String(customerDocId).startsWith('g_') ? 'guest' : 'uid',
    });

    return true;
}

export async function reserveCouponForOrder({
    firestore,
    orderRef,
    orderData,
    fallbackCollection = '',
} = {}) {
    const couponId = String(orderData?.coupon?.id || '').trim();
    const businessId = String(orderData?.restaurantId || '').trim();
    const businessCollection = resolveOrderBusinessCollection(orderData, fallbackCollection);
    if (!firestore || !orderRef || !couponId || !businessId || !businessCollection) return false;

    await firestore.runTransaction(async (transaction) => {
        const currentOrderSnap = await transaction.get(orderRef);
        const currentOrder = currentOrderSnap.exists ? (currentOrderSnap.data() || {}) : (orderData || {});
        if (String(currentOrder?.couponUsageState || '').trim().toLowerCase() === 'reserved') return;

        const couponRef = firestore
            .collection(businessCollection)
            .doc(businessId)
            .collection('coupons')
            .doc(couponId);

        const couponUpdate = {
            timesUsed: FieldValue.increment(1),
        };
        if (currentOrder?.coupon?.singleUsePerCustomer === true) {
            const redemptionKeys = getCouponRedemptionKeysFromOrder(currentOrder);
            if (redemptionKeys.length > 0) {
                couponUpdate.redeemedCustomerIds = FieldValue.arrayUnion(...redemptionKeys);
            }
        }

        transaction.set(couponRef, couponUpdate, { merge: true });
        transaction.set(orderRef, {
            couponUsageState: 'reserved',
            couponUsageReservedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });

    return true;
}

export async function releaseCouponForOrder({
    firestore,
    orderRef,
    orderData,
    fallbackCollection = '',
} = {}) {
    const couponId = String(orderData?.coupon?.id || '').trim();
    const businessId = String(orderData?.restaurantId || '').trim();
    const businessCollection = resolveOrderBusinessCollection(orderData, fallbackCollection);
    if (!firestore || !orderRef || !couponId || !businessId || !businessCollection) return false;

    await firestore.runTransaction(async (transaction) => {
        const currentOrderSnap = await transaction.get(orderRef);
        if (!currentOrderSnap.exists) return;

        const currentOrder = currentOrderSnap.data() || {};
        if (String(currentOrder?.couponUsageState || '').trim().toLowerCase() !== 'reserved') return;

        const couponRef = firestore
            .collection(businessCollection)
            .doc(businessId)
            .collection('coupons')
            .doc(couponId);

        const couponUpdate = {
            timesUsed: FieldValue.increment(-1),
        };
        const redemptionKeys = getCouponRedemptionKeysFromOrder(currentOrder);
        if (redemptionKeys.length > 0) {
            couponUpdate.redeemedCustomerIds = FieldValue.arrayRemove(...redemptionKeys);
        }

        transaction.set(couponRef, couponUpdate, { merge: true });
        transaction.set(orderRef, {
            couponUsageState: 'released',
            couponUsageReleasedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });

    return true;
}
