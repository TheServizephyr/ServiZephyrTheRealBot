import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import {
  SALES_PARTNERS_COLLECTION,
  sanitizePartnerPayload,
  serializePartner,
  validatePartnerPayload,
} from '@/lib/sales-operations';

export const dynamic = 'force-dynamic';

export async function PATCH(req, { params }) {
  try {
    const { verifyAdmin } = await import('@/lib/verify-admin');
    const admin = await verifyAdmin(req);

    const partnerId = String(params?.partnerId || '').trim();
    if (!partnerId) return NextResponse.json({ message: 'Partner ID is required.' }, { status: 400 });

    const payload = sanitizePartnerPayload(await req.json());
    const errors = validatePartnerPayload(payload);
    if (errors.length > 0) {
      return NextResponse.json({ message: errors.join(' ') }, { status: 400 });
    }

    const firestore = await getFirestore();
    const partnerRef = firestore.collection(SALES_PARTNERS_COLLECTION).doc(partnerId);
    const current = await partnerRef.get();
    if (!current.exists) return NextResponse.json({ message: 'Sales partner not found.' }, { status: 404 });

    await partnerRef.set({
      ...payload,
      updatedBy: admin.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const saved = await partnerRef.get();
    return NextResponse.json({ partner: serializePartner(saved) }, { status: 200 });
  } catch (error) {
    console.error('PATCH /api/admin/sales/partners/[partnerId] ERROR:', error);
    return NextResponse.json({ message: error.message || 'Failed to update sales partner.' }, { status: error.status || 500 });
  }
}
