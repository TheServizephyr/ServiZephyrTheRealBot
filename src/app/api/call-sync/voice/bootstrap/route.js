import { NextResponse } from 'next/server';

import { getDatabase, getFirestore } from '@/lib/firebase-admin';
import { bootstrapCallSyncVoiceDraft } from '@/lib/server/callSyncVoiceBilling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const token = String(body?.token || '').trim();
        if (!token) {
            return NextResponse.json({ message: 'Call sync token is required.' }, { status: 400 });
        }

        const [firestore, rtdb] = await Promise.all([
            getFirestore(),
            getDatabase(),
        ]);

        const result = await bootstrapCallSyncVoiceDraft({
            firestore,
            rtdb,
            token,
        });

        return NextResponse.json(
            {
                ok: result.ok,
                restaurantName: result.restaurantName || '',
                businessType: result.businessType || 'restaurant',
                draft: result.draft || null,
                message: result.message || '',
            },
            { status: result.status || 200 }
        );
    } catch (error) {
        console.error('[CallSyncVoiceBootstrap] Failed to load draft:', error);
        return NextResponse.json(
            { message: error?.message || 'Failed to load companion voice draft.' },
            { status: 500 }
        );
    }
}
