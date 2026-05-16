import { NextResponse } from 'next/server';
import { SALES_PITCHES_COLLECTION, serializePitch } from '@/lib/sales-operations';
import { verifySalesPartner } from '@/lib/verify-sales-partner';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { partner } = await verifySalesPartner(req);
    const firestore = await getFirestore();
    const pitchesSnap = await firestore
      .collection(SALES_PITCHES_COLLECTION)
      .where('partnerId', '==', partner.id)
      .get();
    const pitches = pitchesSnap.docs
      .map(serializePitch)
      .sort((a, b) => new Date(b.pitchDate || b.createdAt || 0) - new Date(a.pitchDate || a.createdAt || 0));

    return NextResponse.json({
      partner,
      counts: {
        totalPitches: pitches.length,
        followUps: pitches.filter((pitch) => pitch.pitchStatus === 'follow_up').length,
        demos: pitches.filter((pitch) => pitch.pitchStatus === 'demo_scheduled').length,
        onboarded: pitches.filter((pitch) => pitch.pitchStatus === 'onboarded').length,
        paidOnboarded: pitches.filter((pitch) => pitch.commissionEligible).length,
        monthlyCommission: pitches.reduce((sum, pitch) => sum + Number(pitch.monthlyCommissionAmount || 0), 0),
      },
      recentPitches: pitches.slice(0, 8),
    }, { status: 200 });
  } catch (error) {
    console.error('GET /api/sales/me ERROR:', error);
    return NextResponse.json({ message: error.message || 'Failed to load sales dashboard.' }, { status: error.status || 500 });
  }
}
