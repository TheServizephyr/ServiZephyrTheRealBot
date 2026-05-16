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

export async function GET(req) {
  try {
    const { partner } = await verifySalesPartner(req);
    const firestore = await getFirestore();
    const snapshot = await firestore
      .collection(SALES_PITCHES_COLLECTION)
      .where('partnerId', '==', partner.id)
      .get();
    const pitches = snapshot.docs
      .map(serializePitch)
      .sort((a, b) => new Date(b.pitchDate || b.createdAt || 0) - new Date(a.pitchDate || a.createdAt || 0));

    return NextResponse.json({ pitches }, { status: 200 });
  } catch (error) {
    console.error('GET /api/sales/pitches ERROR:', error);
    return NextResponse.json({ message: error.message || 'Failed to load pitches.' }, { status: error.status || 500 });
  }
}

export async function POST(req) {
  try {
    const { partner, partnerRef } = await verifySalesPartner(req);
    const payload = sanitizePitchPayload(await req.json());
    const errors = validatePitchPayload(payload);
    if (errors.length > 0) {
      return NextResponse.json({ message: errors.join(' ') }, { status: 400 });
    }

    const firestore = await getFirestore();
    const pitchRef = firestore.collection(SALES_PITCHES_COLLECTION).doc();
    const isOnboarded = payload.pitchStatus === 'onboarded';
    await firestore.runTransaction(async (transaction) => {
      transaction.set(pitchRef, {
        ...payload,
        partnerId: partner.id,
        partnerName: partner.name,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(partnerRef, {
        totalPitches: FieldValue.increment(1),
        onboardedCount: FieldValue.increment(isOnboarded ? 1 : 0),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    const saved = await pitchRef.get();
    return NextResponse.json({ pitch: serializePitch(saved) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/sales/pitches ERROR:', error);
    return NextResponse.json({ message: error.message || 'Failed to create pitch.' }, { status: error.status || 500 });
  }
}
