import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import {
  SALES_PITCHES_COLLECTION,
  sanitizePitchPayload,
  serializePitch,
  validatePitchPayload,
} from '@/lib/sales-operations';
import { verifySalesPartner } from '@/lib/verify-sales-partner';

export const dynamic = 'force-dynamic';

const isOnboardedPitch = (pitch) => pitch.pitchStatus === 'onboarded';

export async function PATCH(req, { params }) {
  try {
    const { partner, partnerRef } = await verifySalesPartner(req);
    const pitchId = String(params?.pitchId || '').trim();
    if (!pitchId) return NextResponse.json({ message: 'Pitch ID is required.' }, { status: 400 });

    const payload = sanitizePitchPayload(await req.json());
    const errors = validatePitchPayload(payload);
    if (errors.length > 0) return NextResponse.json({ message: errors.join(' ') }, { status: 400 });

    const firestore = await getFirestore();
    const pitchRef = firestore.collection(SALES_PITCHES_COLLECTION).doc(pitchId);
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(pitchRef);
      if (!current.exists) throw { message: 'Pitch not found.', status: 404 };
      const currentData = current.data() || {};
      if (currentData.partnerId !== partner.id) throw { message: 'Access denied for this pitch.', status: 403 };

      const beforeOnboarded = isOnboardedPitch(currentData);
      const afterOnboarded = isOnboardedPitch(payload);
      transaction.set(pitchRef, {
        ...payload,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (beforeOnboarded !== afterOnboarded) {
        transaction.set(partnerRef, {
          onboardedCount: FieldValue.increment(afterOnboarded ? 1 : -1),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });

    const saved = await pitchRef.get();
    return NextResponse.json({ pitch: serializePitch(saved) }, { status: 200 });
  } catch (error) {
    console.error('PATCH /api/sales/pitches/[pitchId] ERROR:', error);
    return NextResponse.json({ message: error.message || 'Failed to update pitch.' }, { status: error.status || 500 });
  }
}
