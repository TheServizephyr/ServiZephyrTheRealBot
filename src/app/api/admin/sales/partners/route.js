import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { customAlphabet } from 'nanoid';
import {
  SALES_EMPLOYEE_ID_PREFIX,
  SALES_PARTNERS_COLLECTION,
  SALES_PITCHES_COLLECTION,
  sanitizePartnerPayload,
  serializePartner,
  serializePitch,
  validatePartnerPayload,
} from '@/lib/sales-operations';

export const dynamic = 'force-dynamic';
const makeIdSuffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

async function findExistingPartner(firestore, payload) {
  if (payload.phone) {
    const byPhone = await firestore.collection(SALES_PARTNERS_COLLECTION).where('phone', '==', payload.phone).limit(1).get();
    if (!byPhone.empty) return byPhone.docs[0];
  }
  if (payload.email) {
    const byEmail = await firestore.collection(SALES_PARTNERS_COLLECTION).where('email', '==', payload.email).limit(1).get();
    if (!byEmail.empty) return byEmail.docs[0];
  }
  return null;
}

async function generateEmployeeId(firestore) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const employeeId = `${SALES_EMPLOYEE_ID_PREFIX}-${makeIdSuffix()}`;
    const snapshot = await firestore
      .collection(SALES_PARTNERS_COLLECTION)
      .where('employeeId', '==', employeeId)
      .limit(1)
      .get();
    if (snapshot.empty) return employeeId;
  }
  throw new Error('Could not generate a unique employee ID. Please try again.');
}

export async function GET(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    await verifyAdmin(req);

    const firestore = await getFirestore();
    const [partnersSnap, pitchesSnap] = await Promise.all([
      firestore.collection(SALES_PARTNERS_COLLECTION).get(),
      firestore.collection(SALES_PITCHES_COLLECTION).get(),
    ]);

    const partners = partnersSnap.docs.map(serializePartner).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const pitches = pitchesSnap.docs.map(serializePitch).sort((a, b) => new Date(b.pitchDate || b.createdAt || 0) - new Date(a.pitchDate || a.createdAt || 0));

    return NextResponse.json({
      partners,
      pitches,
      counts: {
        partners: partners.length,
        activePartners: partners.filter((partner) => partner.status === 'active').length,
        trainingPartners: partners.filter((partner) => partner.status === 'training').length,
        totalPitches: pitches.length,
        onboarded: pitches.filter((pitch) => pitch.pitchStatus === 'onboarded').length,
        paidOnboarded: pitches.filter((pitch) => pitch.commissionEligible).length,
        monthlyCommission: pitches.reduce((sum, pitch) => sum + Number(pitch.monthlyCommissionAmount || 0), 0),
      },
    }, { status: 200 });
  } catch (error) {
    console.error('GET /api/admin/sales/partners ERROR:', error);
    return NextResponse.json({ message: error.message || 'Failed to load sales operations.' }, { status: error.status || 500 });
  }
}

export async function POST(req) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const admin = await verifyAdmin(req);

    const payload = sanitizePartnerPayload(await req.json());
    const errors = validatePartnerPayload(payload);
    if (errors.length > 0) {
      return NextResponse.json({ message: errors.join(' ') }, { status: 400 });
    }

    const firestore = await getFirestore();
    const existing = await findExistingPartner(firestore, payload);
    if (existing) {
      return NextResponse.json({ message: 'Sales partner already exists.', partner: serializePartner(existing) }, { status: 409 });
    }

    const partnerRef = await firestore.collection(SALES_PARTNERS_COLLECTION).add({
      ...payload,
      employeeId: await generateEmployeeId(firestore),
      totalPitches: 0,
      onboardedCount: 0,
      createdBy: admin.uid,
      updatedBy: admin.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const saved = await partnerRef.get();
    return NextResponse.json({ partner: serializePartner(saved) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/admin/sales/partners ERROR:', error);
    return NextResponse.json({ message: error.message || 'Failed to create sales partner.' }, { status: error.status || 500 });
  }
}
