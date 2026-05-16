import { NextResponse } from 'next/server';
import { FieldValue, getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';
import {
  SALES_PARTNERS_COLLECTION,
  normalizeEmployeeId,
  serializePartner,
} from '@/lib/sales-operations';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const uid = await verifyAndGetUid(req);
    const { employeeId } = await req.json();
    const normalizedEmployeeId = normalizeEmployeeId(employeeId);

    if (!normalizedEmployeeId) {
      return NextResponse.json({ message: 'Employee ID is required.' }, { status: 400 });
    }

    const firestore = await getFirestore();
    const partnerSnap = await firestore
      .collection(SALES_PARTNERS_COLLECTION)
      .where('employeeId', '==', normalizedEmployeeId)
      .limit(1)
      .get();

    if (partnerSnap.empty) {
      return NextResponse.json({ message: 'Invalid employee ID.' }, { status: 404 });
    }

    const partnerDoc = partnerSnap.docs[0];
    const partner = serializePartner(partnerDoc);
    if (partner.status === 'inactive') {
      return NextResponse.json({ message: 'This sales partner account is inactive.' }, { status: 403 });
    }

    if (partner.userId && partner.userId !== uid) {
      return NextResponse.json({ message: 'This employee ID is already linked to another login account.' }, { status: 409 });
    }

    const userRef = firestore.collection('users').doc(uid);
    await firestore.runTransaction(async (transaction) => {
      transaction.set(partnerDoc.ref, {
        userId: uid,
        activatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(userRef, {
        role: 'sales-partner',
        salesPartnerId: partnerDoc.id,
        salesEmployeeId: normalizedEmployeeId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    const saved = await partnerDoc.ref.get();
    return NextResponse.json({
      success: true,
      partner: serializePartner(saved),
      message: 'Sales dashboard activated successfully.',
    }, { status: 200 });
  } catch (error) {
    console.error('POST /api/sales/activate ERROR:', error);
    return NextResponse.json(
      { message: error.message || 'Failed to activate sales dashboard.' },
      { status: error.status || 500 }
    );
  }
}
