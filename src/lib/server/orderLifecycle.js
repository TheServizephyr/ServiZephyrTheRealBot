import { FieldValue } from '@/lib/firebase-admin';
import {
    COUNTABLE_CUSTOMER_ORDER_STATUSES,
    rebuildBusinessCustomerProfile,
    resolveBusinessCustomerProfileRef,
} from '@/lib/customer-profiles';

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

function resolveOrderCustomerDocId(orderData = {}) {
    return (
        String(orderData?.restaurantCustomerDocId || '').trim() ||
        resolveOrderCustomerActorId(orderData)
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
    const customerDocId = resolveOrderCustomerDocId(orderData);

    if (!firestore || !businessId || !businessCollection || !customerDocId) return false;

    await rebuildBusinessCustomerProfile({
        firestore,
        businessCollection,
        businessId,
        customerDocId,
        actorId: resolveOrderCustomerActorId(orderData),
        customerName: orderData?.customerName || '',
        customerEmail: orderData?.customerEmail || '',
        customerPhone: orderData?.customerPhone || '',
        customerAddress: orderData?.customerAddress || null,
        customerStatus: String(customerDocId).startsWith('g_') ? 'unclaimed' : 'verified',
        customerType: String(customerDocId).startsWith('g_') ? 'guest' : 'uid',
    });

    return true;
}

export async function syncCompletedOrderCounterForOrder({
    firestore,
    orderRef,
    orderData,
    fallbackCollection = '',
} = {}) {
    const businessId = String(orderData?.restaurantId || '').trim();
    const businessCollection = resolveOrderBusinessCollection(orderData, fallbackCollection);
    const actorId = resolveOrderCustomerActorId(orderData);
    const stableCustomerDocId = resolveOrderCustomerDocId(orderData);
    const normalizedStatus = String(orderData?.status || '').trim().toLowerCase();

    if (
        !firestore ||
        !orderRef ||
        !businessId ||
        !businessCollection ||
        !stableCustomerDocId ||
        !COUNTABLE_CUSTOMER_ORDER_STATUSES.has(normalizedStatus)
    ) {
        return false;
    }

    const resolvedProfile = await resolveBusinessCustomerProfileRef({
        firestore,
        businessCollection,
        businessId,
        customerDocId: stableCustomerDocId,
        actorId,
        customerPhone: orderData?.customerPhone || '',
    });
    if (!resolvedProfile?.customerRef) return false;

    const { customerRef, customerDocId } = resolvedProfile;

    await firestore.runTransaction(async (transaction) => {
        const currentOrderSnap = await transaction.get(orderRef);
        const currentOrder = currentOrderSnap.exists ? (currentOrderSnap.data() || {}) : (orderData || {});
        if (currentOrder?.countedForCompletedOrders === true) return;

        const liveStatus = String(currentOrder?.status || normalizedStatus).trim().toLowerCase();
        if (!COUNTABLE_CUSTOMER_ORDER_STATUSES.has(liveStatus)) return;

        transaction.set(customerRef, {
            customerId: String(customerDocId),
            completedOrderCount: FieldValue.increment(1),
            lastOrderId: currentOrderSnap.id,
            lastOrderDate: currentOrder?.orderDate || FieldValue.serverTimestamp(),
            lastActivityAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        transaction.set(orderRef, {
            restaurantCustomerDocId: String(customerDocId),
            countedForCompletedOrders: true,
            countedForCompletedOrdersAt: FieldValue.serverTimestamp(),
        }, { merge: true });
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
