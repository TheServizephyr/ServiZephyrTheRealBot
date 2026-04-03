import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { verifyOwnerWithAudit } from '@/lib/verify-owner-with-audit';
import { PERMISSIONS } from '@/lib/permissions';
import { generateCustomerOrderId } from '@/utils/generateCustomerOrderId';
import { isValidCustomerOrderId } from '@/utils/generateCustomerOrderId';
import { applyInventoryMovementTransaction, isInventoryManagedBusinessType } from '@/lib/server/inventory';
import { upsertBusinessCustomerProfile } from '@/lib/customer-profiles';
import { getOrSetEphemeralCache, invalidateEphemeralCacheByPrefix } from '@/lib/server/ephemeralCache';

const CUSTOM_BILL_HISTORY_CACHE_TTL_MS = 30 * 1000;

const toAmount = (value, fallback = 0) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
};

const normalizePhone = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length >= 10 ? digits.slice(-10) : digits;
};

const sanitizeText = (value, fallback = '') => String(value || fallback).trim();
const toLowerText = (value) => String(value || '').toLowerCase();
const isSettlementEligible = (printedVia) => printedVia !== 'create_order';
const isCancelledBill = (data = {}) => String(data.status || '').trim().toLowerCase() === 'cancelled';

const normalizeItem = (item, index) => {
    const quantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
    const unitPrice = toAmount(item?.price ?? item?.portion?.price, 0);
    const totalPrice = toAmount(item?.totalPrice, unitPrice * quantity);
    const portionName = sanitizeText(
        item?.portion?.name ||
        item?.selectedPortion?.name ||
        item?.variant ||
        item?.portionName ||
        '',
        ''
    );
    const selectedPortion = item?.selectedPortion && typeof item.selectedPortion === 'object'
        ? {
            name: sanitizeText(item.selectedPortion.name, portionName),
            price: toAmount(item.selectedPortion.price, unitPrice),
        }
        : null;
    const portion = item?.portion && typeof item.portion === 'object'
        ? {
            name: sanitizeText(item.portion.name, portionName),
            price: toAmount(item.portion.price, unitPrice),
        }
        : null;
    const portions = Array.isArray(item?.portions)
        ? item.portions
            .map((candidate) => ({
                name: sanitizeText(candidate?.name, ''),
                price: toAmount(candidate?.price, 0),
            }))
            .filter((candidate) => candidate.name)
        : [];
    const portionCount = Math.max(
        0,
        parseInt(item?.portionCount, 10) || 0,
        portions.length
    );

    return {
        id: item?.id || `manual-item-${index + 1}`,
        name: sanitizeText(item?.name, 'Custom Item'),
        quantity,
        price: unitPrice,
        totalPrice,
        categoryId: sanitizeText(item?.categoryId, 'manual'),
        portionName,
        variant: sanitizeText(item?.variant, portionName),
        portion: portion || (portionName ? { name: portionName, price: unitPrice } : null),
        selectedPortion: selectedPortion || (portionName ? { name: portionName, price: unitPrice } : null),
        portionCount,
        portions,
    };
};

const timestampToDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value?.toDate === 'function') {
        const converted = value.toDate();
        return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildHistoryQuery = (historyRef, fromDate, toDate, maxRecords) => {
    let query = historyRef.orderBy('printedAt', 'desc');
    if (fromDate) query = query.where('printedAt', '>=', fromDate);
    if (toDate) query = query.where('printedAt', '<=', toDate);
    return query.limit(maxRecords);
};

const buildFingerprint = ({ businessId, phone, items, totalAmount }) => {
    const normalizedItems = (items || [])
        .map((item) => `${item.id}:${item.quantity}:${Number(item.totalPrice || 0).toFixed(2)}`)
        .sort()
        .join('|');

    const signature = `${businessId}|${phone}|${Number(totalAmount || 0).toFixed(2)}|${normalizedItems}`;
    return createHash('sha256').update(signature).digest('hex').slice(0, 32);
};

async function resolveCustomerIdentity(firestore, normalizedPhone) {
    if (!normalizedPhone) {
        return {
            customerType: 'guest',
            customerId: null,
        };
    }

    const usersRef = firestore.collection('users');
    const candidatePhones = [normalizedPhone, `+91${normalizedPhone}`];

    for (const candidate of candidatePhones) {
        const snap = await usersRef.where('phone', '==', candidate).limit(1).get();
        if (!snap.empty) {
            return {
                customerType: 'uid',
                customerId: snap.docs[0].id,
            };
        }
    }

    return {
        customerType: 'guest',
        customerId: normalizedPhone,
    };
}

export async function POST(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_save_history',
            {},
            false,
            [PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName, uid, adminId = null, businessSnap } = context;
        const firestore = await getFirestore();
        const body = await req.json();

        const customerDetails = body?.customerDetails || {};
        const rawItems = Array.isArray(body?.items) ? body.items : [];
        const billDetails = body?.billDetails || {};

        if (rawItems.length === 0) {
            return NextResponse.json({ message: 'At least one item is required for bill history.' }, { status: 400 });
        }

        const items = rawItems.map(normalizeItem);
        const subtotalFromItems = items.reduce((sum, item) => sum + toAmount(item.totalPrice), 0);
        const subtotal = toAmount(billDetails?.subtotal, subtotalFromItems);
        const cgst = toAmount(billDetails?.cgst, 0);
        const sgst = toAmount(billDetails?.sgst, 0);
        const deliveryCharge = toAmount(billDetails?.deliveryCharge, 0);
        const serviceFee = toAmount(billDetails?.serviceFee, 0);
        const serviceFeeLabel = sanitizeText(billDetails?.serviceFeeLabel, 'Additional Charge') || 'Additional Charge';
        const discount = toAmount(billDetails?.discount, 0);
        const paymentMode = sanitizeText(billDetails?.paymentMode, '') || null;
        const totalAmount = toAmount(billDetails?.grandTotal, subtotal + cgst + sgst + deliveryCharge + serviceFee);

        const customerName = sanitizeText(customerDetails?.name, 'Walk-in Customer') || 'Walk-in Customer';
        const customerAddress = sanitizeText(customerDetails?.address, '');
        const customerPhone = normalizePhone(customerDetails?.phone);

        const billDraftId = sanitizeText(body?.billDraftId, '');
        const printedViaRaw = sanitizeText(body?.printedVia, '').toLowerCase();
        const printedVia = ['browser', 'direct_usb', 'create_order'].includes(printedViaRaw)
            ? printedViaRaw
            : 'browser';
        const orderTypeRaw = sanitizeText(body?.orderType, '').toLowerCase();
        const orderType = ['delivery', 'pickup', 'dine-in'].includes(orderTypeRaw) ? orderTypeRaw : (['delivery', 'pickup', 'dine-in'].includes(printedViaRaw) ? printedViaRaw : 'dine-in');
        const settlementEligible = isSettlementEligible(printedVia);

        const historyRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('custom_bill_history');

        if (billDraftId) {
            const duplicateSnap = await historyRef.where('billDraftId', '==', billDraftId).limit(1).get();
            if (!duplicateSnap.empty) {
                const duplicateDoc = duplicateSnap.docs[0];
                return NextResponse.json({
                    message: 'Bill history already saved.',
                    duplicateRequest: true,
                    historyId: duplicateDoc.id,
                });
            }
        }

        const { customerType, customerId } = await resolveCustomerIdentity(firestore, customerPhone);
        const fingerprint = buildFingerprint({
            businessId,
            phone: customerPhone || 'na',
            items,
            totalAmount,
        });

        const requestedCustomerOrderId = sanitizeText(body?.customerOrderId, '');
        const customerOrderId = isValidCustomerOrderId(requestedCustomerOrderId)
            ? requestedCustomerOrderId
            : generateCustomerOrderId();
        const docRef = historyRef.doc();
        const historyPayload = {
            historyId: docRef.id,
            customerOrderId,
            billDraftId: billDraftId || null,
            source: 'offline_counter',
            channel: 'custom_bill',
            printedVia,
            orderType,
            fingerprint,
            businessId,
            ownerId: uid,
            actorUid: adminId || uid,
            customerName,
            customerPhone: customerPhone || null,
            customerAddress: customerAddress || null,
            customerType,
            customerId: customerId || null,
            itemCount: items.length,
            items,
            subtotal,
            cgst,
            sgst,
            deliveryCharge,
            serviceFee,
            serviceFeeLabel,
            discount,
            paymentMode,
            totalAmount,
            settlementEligible,
            isSettled: false,
            settledAt: null,
            settledByUid: null,
            settledByRole: null,
            settlementBatchId: null,
            createdAt: FieldValue.serverTimestamp(),
            printedAt: FieldValue.serverTimestamp(),
        };

        const businessType = businessSnap?.data()?.businessType || (collectionName === 'shops' ? 'store' : 'restaurant');
        if (isInventoryManagedBusinessType(businessType)) {
            await firestore.runTransaction(async (transaction) => {
                await applyInventoryMovementTransaction({
                    transaction,
                    businessRef: businessSnap.ref,
                    items,
                    mode: 'sale',
                    actorId: adminId || uid,
                    actorRole: 'owner',
                    referenceId: docRef.id,
                    referenceType: 'custom_bill_history',
                    note: `Offline bill saved (${printedVia})`,
                });

                transaction.set(docRef, {
                    ...historyPayload,
                    inventoryState: 'deducted',
                    inventoryLastSyncedAt: FieldValue.serverTimestamp(),
                });
            });
        } else {
            await docRef.set(historyPayload);
        }

        if (customerPhone) {
            await upsertBusinessCustomerProfile({
                firestore,
                businessCollection: collectionName,
                businessId,
                customerDocId: customerId || customerPhone,
                customerName,
                customerPhone,
                customerAddress: customerAddress || null,
                customerStatus: customerType === 'uid' ? 'verified' : 'unclaimed',
                orderId: docRef.id,
                orderSubtotal: subtotal,
                orderTotal: totalAmount,
                items,
                customerType,
            }).catch((profileError) => {
                console.error('[Custom Bill History] Failed to update customer profile:', profileError);
            });
        }
        invalidateEphemeralCacheByPrefix(`owner:custom-bill-history:${collectionName}:${businessId}:`);

        return NextResponse.json({
            message: 'Bill history saved successfully.',
            historyId: docRef.id,
            customerOrderId,
            duplicateRequest: false,
        });
    } catch (error) {
        console.error('[Custom Bill History] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}

export async function GET(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_view_history',
            {},
            false,
            [PERMISSIONS.VIEW_ORDERS, PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName } = context;
        const firestore = await getFirestore();
        const url = new URL(req.url);

        const fromParam = sanitizeText(url.searchParams.get('from'), '');
        const toParam = sanitizeText(url.searchParams.get('to'), '');
        const search = toLowerText(url.searchParams.get('search') || '');
        const maxRecords = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 200));

        const fromDate = fromParam ? new Date(fromParam) : null;
        const toDate = toParam ? new Date(toParam) : null;
        if (fromDate) fromDate.setHours(0, 0, 0, 0);
        if (toDate) toDate.setHours(23, 59, 59, 999);

        const historyRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('custom_bill_history');

        const cacheKey = `owner:custom-bill-history:${collectionName}:${businessId}:from:${fromParam || 'na'}:to:${toParam || 'na'}:search:${search || 'na'}:limit:${maxRecords}`;
        const payload = await getOrSetEphemeralCache(cacheKey, CUSTOM_BILL_HISTORY_CACHE_TTL_MS, async () => {
            let snapshot;
            try {
                snapshot = await buildHistoryQuery(historyRef, fromDate, toDate, maxRecords).get();
            } catch (queryError) {
                snapshot = await historyRef
                    .orderBy('printedAt', 'desc')
                    .limit(maxRecords)
                    .get();
            }

            let totalAmount = 0;
            let totalBills = 0;
            let pendingSettlementAmount = 0;
            let pendingSettlementBills = 0;
            let settledAmount = 0;
            let settledBills = 0;
            const history = [];

            snapshot.forEach((doc) => {
                const data = doc.data() || {};
                const printedAt = timestampToDate(data.printedAt) || timestampToDate(data.createdAt);

                if (fromDate && printedAt && printedAt < fromDate) return;
                if (toDate && printedAt && printedAt > toDate) return;

                const itemNames = Array.isArray(data.items)
                    ? data.items.map((item) => sanitizeText(item?.name, '')).join(' ')
                    : '';

                if (search) {
                    const haystack = [
                        sanitizeText(data.historyId, doc.id),
                        sanitizeText(data.billDraftId, ''),
                        sanitizeText(data.customerName, ''),
                        sanitizeText(data.customerPhone, ''),
                        sanitizeText(data.customerAddress, ''),
                        sanitizeText(data.customerId, ''),
                        itemNames,
                    ]
                        .join(' ')
                        .toLowerCase();

                    if (!haystack.includes(search)) return;
                }

                const amount = toAmount(data.totalAmount, 0);
                const cancelled = isCancelledBill(data);
                if (!cancelled) {
                    totalAmount += amount;
                    totalBills += 1;
                }

                const printedVia = data.printedVia || 'browser';
                const settlementEligible = data.settlementEligible ?? isSettlementEligible(printedVia);
                const isSettled = settlementEligible ? !!data.isSettled : false;
                if (!cancelled && settlementEligible) {
                    if (isSettled) {
                        settledAmount += amount;
                        settledBills += 1;
                    } else {
                        pendingSettlementAmount += amount;
                        pendingSettlementBills += 1;
                    }
                }

                history.push({
                    id: doc.id,
                    historyId: data.historyId || doc.id,
                    billDraftId: data.billDraftId || null,
                    source: data.source || 'offline_counter',
                    channel: data.channel || 'custom_bill',
                    printedVia,
                    customerName: data.customerName || 'Walk-in Customer',
                    customerPhone: data.customerPhone || null,
                    customerAddress: data.customerAddress || null,
                    customerType: data.customerType || 'guest',
                    customerId: data.customerId || null,
                    customerOrderId: data.customerOrderId || null,
                    orderType: data.orderType || data.printedVia || 'dine-in',
                    status: data.status || 'active',
                    cancelledAt: timestampToDate(data.cancelledAt)?.toISOString() || null,
                    cancellationReason: data.cancellationReason || null,
                    settlementEligible,
                    isSettled,
                    settledAt: timestampToDate(data.settledAt)?.toISOString() || null,
                    settledByUid: data.settledByUid || null,
                    settledByRole: data.settledByRole || null,
                    settlementBatchId: data.settlementBatchId || null,
                    subtotal: toAmount(data.subtotal, 0),
                    cgst: toAmount(data.cgst, 0),
                    sgst: toAmount(data.sgst, 0),
                    deliveryCharge: toAmount(data.deliveryCharge, 0),
                    serviceFee: toAmount(data.serviceFee, 0),
                    serviceFeeLabel: sanitizeText(data.serviceFeeLabel, 'Additional Charge') || 'Additional Charge',
                    totalAmount: amount,
                    itemCount: Number(data.itemCount || (Array.isArray(data.items) ? data.items.length : 0)),
                    items: Array.isArray(data.items) ? data.items.map((item, index) => normalizeItem(item, index)) : [],
                    printedAt: printedAt ? printedAt.toISOString() : null,
                    createdAt: timestampToDate(data.createdAt)?.toISOString() || null,
                });
            });

            return {
                history,
                summary: {
                    totalBills,
                    totalAmount,
                    avgBillValue: totalBills > 0 ? totalAmount / totalBills : 0,
                    pendingSettlementAmount,
                    pendingSettlementBills,
                    settledAmount,
                    settledBills,
                },
            };
        });

        return NextResponse.json(payload);
    } catch (error) {
        console.error('[Custom Bill History][GET] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}

export async function PATCH(req) {
    try {
        const context = await verifyOwnerWithAudit(
            req,
            'custom_bill_settle_history',
            {},
            false,
            [PERMISSIONS.MANUAL_BILLING?.WRITE || PERMISSIONS.MANUAL_BILLING, PERMISSIONS.CREATE_ORDER]
        );

        const { businessId, collectionName, uid, callerRole, adminId = null } = context;
        const firestore = await getFirestore();
        const body = await req.json();

        const action = sanitizeText(body?.action, '').toLowerCase();
        const historyIds = Array.isArray(body?.historyIds)
            ? [...new Set(body.historyIds.map((id) => sanitizeText(id, '')).filter(Boolean))]
            : [];

        const newOrderType = sanitizeText(body?.orderType, '').toLowerCase();
        const newCustomerPhone = sanitizeText(body?.customerPhone, '') || null;

        if (action !== 'settle' && action !== 'unsettle' && action !== 'update-type') {
            return NextResponse.json({ message: 'Unsupported action.' }, { status: 400 });
        }
        if (action === 'update-type' && !['delivery', 'pickup', 'dine-in'].includes(newOrderType)) {
            return NextResponse.json({ message: 'Invalid order type.' }, { status: 400 });
        }
        if (historyIds.length === 0) {
            return NextResponse.json({ message: 'At least one bill ID is required.' }, { status: 400 });
        }
        if (historyIds.length > 500) {
            return NextResponse.json({ message: `You can ${action} up to 500 bills in one request.` }, { status: 400 });
        }

        const historyRef = firestore
            .collection(collectionName)
            .doc(businessId)
            .collection('custom_bill_history');

        const nowIso = new Date().toISOString();
        const actorUid = adminId || uid;
        const settlementBatchId = createHash('sha256')
            .update(`${businessId}|${historyIds.sort().join('|')}|${nowIso}`)
            .digest('hex')
            .slice(0, 16);

        const docs = await Promise.all(historyIds.map((id) => historyRef.doc(id).get()));
        const batch = firestore.batch();
        let updatedCount = 0;
        let updatedAmount = 0;
        let skippedCount = 0;

        docs.forEach((docSnap) => {
            if (!docSnap.exists) {
                skippedCount += 1;
                return;
            }

            const data = docSnap.data() || {};
            const printedVia = data.printedVia || 'browser';
            const settlementEligible = data.settlementEligible ?? isSettlementEligible(printedVia);
            
            if (action === 'update-type') {
                const updateFields = { orderType: newOrderType };
                if (newCustomerPhone) {
                    updateFields.customerPhone = newCustomerPhone;
                }
                updatedCount += 1;
                batch.update(docSnap.ref, updateFields);
                return;
            }

            if (!settlementEligible) {
                skippedCount += 1;
                return;
            }

            if (action === 'settle') {
                if (data.isSettled) {
                    skippedCount += 1;
                    return;
                }
                updatedCount += 1;
                updatedAmount += toAmount(data.totalAmount, 0);
                batch.update(docSnap.ref, {
                    settlementEligible: true,
                    isSettled: true,
                    settledAt: FieldValue.serverTimestamp(),
                    settledByUid: actorUid,
                    settledByRole: callerRole || null,
                    settlementBatchId,
                });
            } else if (action === 'unsettle') {
                if (!data.isSettled) {
                    skippedCount += 1;
                    return;
                }
                updatedCount += 1;
                updatedAmount += toAmount(data.totalAmount, 0);
                batch.update(docSnap.ref, {
                    isSettled: false,
                    settledAt: null,
                    settledByUid: null,
                    settledByRole: null,
                    settlementBatchId: null,
                });
            }
        });

        if (updatedCount > 0) {
            await batch.commit();
        }
        invalidateEphemeralCacheByPrefix(`owner:custom-bill-history:${collectionName}:${businessId}:`);

        const actionPastTense = action === 'settle' ? 'settled' : 'unsettled';

        return NextResponse.json({
            message: updatedCount > 0
                ? `${updatedCount} bill(s) ${actionPastTense} successfully.`
                : `No bills were eligible to be ${actionPastTense}.`,
            settledCount: updatedCount,
            settledAmount: updatedAmount,
            skippedCount,
            settlementBatchId: updatedCount > 0 && action === 'settle' ? settlementBatchId : null,
        });
    } catch (error) {
        console.error('[Custom Bill History][PATCH] Error:', error);
        return NextResponse.json(
            { message: `Backend Error: ${error.message}` },
            { status: error.status || 500 }
        );
    }
}
