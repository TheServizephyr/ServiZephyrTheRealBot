import { NextResponse } from 'next/server';

import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const OWNER_ROLES = new Set(['owner', 'restaurant-owner', 'shop-owner', 'street-vendor']);
const BUSINESS_COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];

function normalizeBorrowerText(value = '') {
    return String(value ?? '').trim();
}

function normalizeBorrowerAddress(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeBorrowerPhone(value = '') {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function isValidBorrowerPhone(value = '') {
    return /^\d{10}$/.test(String(value || ''));
}

function parseAmount(value) {
    const normalized = String(value ?? '').replace(/,/g, '').trim();
    if (!normalized) return NaN;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function createBorrowerHistoryId() {
    return `borrower_history_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBorrowerHistory(entry = {}, index = 0) {
    const rawDelta = Number(entry?.delta ?? entry?.amountDelta ?? entry?.change ?? 0);
    const fallbackType = rawDelta < 0 ? 'reduced' : 'added';
    const type = String(entry?.type || fallbackType).trim().toLowerCase() === 'reduced' ? 'reduced' : 'added';
    const amount = Math.abs(Number.isFinite(rawDelta) ? rawDelta : Number(entry?.amount || 0) || 0);
    const delta = type === 'reduced' ? -amount : amount;
    const updatedAt = Number(entry?.updatedAt || entry?.createdAt || 0) || 0;
    const resultingAmount = Number.isFinite(Number(entry?.resultingAmount))
        ? Number(entry.resultingAmount)
        : 0;

    return {
        id: String(entry?.id || `${createBorrowerHistoryId()}_${index}`),
        type,
        amount,
        delta,
        note: normalizeBorrowerText(entry?.note),
        updatedAt,
        resultingAmount,
    };
}

function normalizeBorrowerRecord(id, borrower = {}) {
    const history = (Array.isArray(borrower?.history) ? borrower.history : [])
        .map((entry, index) => normalizeBorrowerHistory(entry, index))
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
    const baseAmount = Number.isFinite(Number(borrower?.amount)) ? Number(borrower.amount) : 0;
    const derivedAmount = history.length > 0 ? Number(history[0]?.resultingAmount || 0) : baseAmount;

    return {
        id: String(id || borrower?.id || ''),
        name: normalizeBorrowerText(borrower?.name),
        phone: normalizeBorrowerPhone(borrower?.phone),
        address: normalizeBorrowerAddress(borrower?.address),
        amount: Number(derivedAmount || 0),
        history,
        lastEditedAt: Number(borrower?.lastEditedAt || borrower?.updatedAt || 0) || 0,
    };
}

function getBorrowersCollection(firestore, context) {
    return firestore
        .collection(context.collectionName)
        .doc(context.businessId)
        .collection('borrowers');
}

async function verifyOwnerAndGetBusinessContext(req, firestore) {
    const uid = await verifyAndGetUid(req);
    const url = new URL(req.url, 'http://localhost');
    const impersonatedOwnerId = url.searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = url.searchParams.get('employee_of');
    const userDoc = await firestore.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw { message: 'Access denied: user profile not found.', status: 403 };
    }

    const userData = userDoc.data() || {};
    const userRole = String(userData.role || '').trim().toLowerCase();
    let targetOwnerId = uid;

    if (userRole === 'admin' && impersonatedOwnerId) {
        targetOwnerId = impersonatedOwnerId;
    } else if (employeeOfOwnerId) {
        const linkedOutlets = Array.isArray(userData.linkedOutlets) ? userData.linkedOutlets : [];
        const hasAccess = linkedOutlets.some((outlet) => (
            outlet?.ownerId === employeeOfOwnerId && outlet?.status === 'active'
        ));

        if (!hasAccess) {
            throw { message: 'Access denied: you are not linked to this outlet.', status: 403 };
        }

        targetOwnerId = employeeOfOwnerId;
    } else if (!OWNER_ROLES.has(userRole)) {
        throw { message: 'Access denied: insufficient privileges.', status: 403 };
    }

    for (const collectionName of BUSINESS_COLLECTIONS) {
        const businessSnap = await firestore
            .collection(collectionName)
            .where('ownerId', '==', targetOwnerId)
            .limit(1)
            .get();

        if (!businessSnap.empty) {
            return {
                requesterId: uid,
                targetOwnerId,
                businessId: businessSnap.docs[0].id,
                collectionName,
            };
        }
    }

    throw { message: 'No business found for this owner.', status: 404 };
}

function toErrorResponse(error, fallbackMessage) {
    const message = String(error?.message || fallbackMessage || 'Something went wrong.');
    const status = Number(error?.status) || 500;
    return NextResponse.json({ message }, { status });
}

export async function GET(req) {
    try {
        const firestore = await getFirestore();
        const context = await verifyOwnerAndGetBusinessContext(req, firestore);
        const snap = await getBorrowersCollection(firestore, context)
            .orderBy('lastEditedAt', 'desc')
            .get();

        const borrowers = snap.docs.map((doc) => normalizeBorrowerRecord(doc.id, doc.data()));
        return NextResponse.json({ borrowers }, { status: 200 });
    } catch (error) {
        console.error('GET BORROWERS ERROR:', error);
        return toErrorResponse(error, 'Failed to load borrowers.');
    }
}

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const context = await verifyOwnerAndGetBusinessContext(req, firestore);
        const body = await req.json();
        const name = normalizeBorrowerText(body?.name);
        const phone = normalizeBorrowerPhone(body?.phone);
        const address = normalizeBorrowerAddress(body?.address);

        if (!name && !phone) {
            return NextResponse.json({ message: 'Name or phone number is required.' }, { status: 400 });
        }

        if (phone && !isValidBorrowerPhone(phone)) {
            return NextResponse.json({ message: 'Phone number must be exactly 10 digits.' }, { status: 400 });
        }

        const now = Date.now();
        const borrowersRef = getBorrowersCollection(firestore, context);
        const borrowerRef = borrowersRef.doc();
        const borrower = normalizeBorrowerRecord(borrowerRef.id, {
            id: borrowerRef.id,
            name,
            phone,
            address,
            amount: 0,
            history: [],
            lastEditedAt: now,
        });

        await borrowerRef.set({
            ...borrower,
            ownerId: context.targetOwnerId,
            businessId: context.businessId,
            createdAt: now,
            updatedAt: now,
            createdBy: context.requesterId,
            updatedBy: context.requesterId,
        });

        return NextResponse.json({ borrower }, { status: 201 });
    } catch (error) {
        console.error('POST BORROWER ERROR:', error);
        return toErrorResponse(error, 'Failed to create borrower.');
    }
}

export async function PUT(req) {
    try {
        const firestore = await getFirestore();
        const context = await verifyOwnerAndGetBusinessContext(req, firestore);
        const body = await req.json();
        const rawBorrowers = Array.isArray(body?.borrowers) ? body.borrowers : [];

        if (rawBorrowers.length === 0) {
            return NextResponse.json({ borrowers: [] }, { status: 200 });
        }

        const borrowersRef = getBorrowersCollection(firestore, context);
        const batch = firestore.batch();
        const now = Date.now();
        const borrowers = rawBorrowers.map((entry, index) => {
            const fallbackId = `borrower_${now}_${index}_${Math.random().toString(36).slice(2, 7)}`;
            const normalized = normalizeBorrowerRecord(
                normalizeBorrowerText(entry?.id) || fallbackId,
                entry
            );

            if (!normalized.name && !normalized.phone) {
                throw { message: `Borrower ${index + 1} must include a name or phone number.`, status: 400 };
            }

            if (normalized.phone && !isValidBorrowerPhone(normalized.phone)) {
                throw { message: `Borrower ${index + 1} has an invalid phone number.`, status: 400 };
            }

            const borrowerRef = borrowersRef.doc(normalized.id);
            batch.set(borrowerRef, {
                ...normalized,
                ownerId: context.targetOwnerId,
                businessId: context.businessId,
                createdAt: Number(entry?.createdAt || normalized.lastEditedAt || now) || now,
                updatedAt: now,
                createdBy: normalizeBorrowerText(entry?.createdBy) || context.requesterId,
                updatedBy: context.requesterId,
            }, { merge: true });

            return normalized;
        }).sort((left, right) => Number(right.lastEditedAt || 0) - Number(left.lastEditedAt || 0));

        await batch.commit();
        return NextResponse.json({ borrowers }, { status: 200 });
    } catch (error) {
        console.error('PUT BORROWERS ERROR:', error);
        return toErrorResponse(error, 'Failed to sync borrowers.');
    }
}

export async function PATCH(req) {
    try {
        const firestore = await getFirestore();
        const context = await verifyOwnerAndGetBusinessContext(req, firestore);
        const body = await req.json();
        const borrowerId = normalizeBorrowerText(body?.borrowerId);
        const mode = String(body?.mode || '').trim().toLowerCase() === 'reduced' ? 'reduced' : 'added';
        const note = normalizeBorrowerText(body?.note);
        const parsedAmount = parseAmount(body?.amount);
        const operationKey = normalizeBorrowerText(body?.operationKey);

        if (!borrowerId) {
            return NextResponse.json({ message: 'Borrower ID is required.' }, { status: 400 });
        }

        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return NextResponse.json({ message: 'Amount must be a positive number.' }, { status: 400 });
        }

        const borrowerRef = getBorrowersCollection(firestore, context).doc(borrowerId);
        const borrower = await firestore.runTransaction(async (transaction) => {
            const borrowerSnap = await transaction.get(borrowerRef);
            if (!borrowerSnap.exists) {
                throw { message: 'Borrower not found.', status: 404 };
            }

            const rawBorrower = borrowerSnap.data() || {};
            if (operationKey && normalizeBorrowerText(rawBorrower?.lastOperationKey) === operationKey) {
                return normalizeBorrowerRecord(borrowerSnap.id, rawBorrower);
            }

            const currentBorrower = normalizeBorrowerRecord(borrowerSnap.id, rawBorrower);
            const delta = mode === 'reduced' ? -parsedAmount : parsedAmount;
            const nextAmount = Number((currentBorrower.amount + delta).toFixed(2));

            if (nextAmount < 0) {
                throw { message: 'Amount cannot go below zero.' , status: 400 };
            }

            const now = Date.now();
            const historyEntry = normalizeBorrowerHistory({
                id: createBorrowerHistoryId(),
                type: mode,
                amount: parsedAmount,
                delta,
                note,
                updatedAt: now,
                resultingAmount: nextAmount,
            });

            const nextBorrower = normalizeBorrowerRecord(borrowerSnap.id, {
                ...currentBorrower,
                amount: nextAmount,
                history: [historyEntry, ...currentBorrower.history],
                lastEditedAt: now,
            });

            transaction.set(borrowerRef, {
                ...nextBorrower,
                ownerId: context.targetOwnerId,
                businessId: context.businessId,
                lastOperationKey: operationKey || rawBorrower?.lastOperationKey || '',
                lastOperationAt: now,
                updatedAt: now,
                updatedBy: context.requesterId,
            }, { merge: true });

            return nextBorrower;
        });

        return NextResponse.json({ borrower }, { status: 200 });
    } catch (error) {
        console.error('PATCH BORROWER ERROR:', error);
        return toErrorResponse(error, 'Failed to update borrower.');
    }
}

export async function DELETE(req) {
    try {
        const firestore = await getFirestore();
        const context = await verifyOwnerAndGetBusinessContext(req, firestore);
        const body = await req.json().catch(() => ({}));
        const borrowerId = normalizeBorrowerText(body?.borrowerId);

        if (!borrowerId) {
            return NextResponse.json({ message: 'Borrower ID is required.' }, { status: 400 });
        }

        const borrowerRef = getBorrowersCollection(firestore, context).doc(borrowerId);
        const borrowerSnap = await borrowerRef.get();

        if (!borrowerSnap.exists) {
            return NextResponse.json({ message: 'Borrower not found.' }, { status: 404 });
        }

        await borrowerRef.delete();
        return NextResponse.json({ borrowerId }, { status: 200 });
    } catch (error) {
        console.error('DELETE BORROWER ERROR:', error);
        return toErrorResponse(error, 'Failed to delete borrower.');
    }
}
