import { NextResponse } from 'next/server';

import { kv, getKvFailoverState } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export async function GET() {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const testKey = `debug:kv-failover:${Date.now()}`;
    const testValue = {
        ok: true,
        at: new Date().toISOString(),
    };

    const stateBefore = getKvFailoverState();

    try {
        await kv.set(testKey, testValue, { ex: 120 });
        const roundTripValue = await kv.get(testKey);
        const stateAfter = getKvFailoverState();
        const secondaryLikelyUsed = Boolean(
            stateAfter.enabled &&
            stateAfter.forceSecondaryUntil &&
            stateAfter.forceSecondaryUntil > Date.now()
        );

        return NextResponse.json({
            ok: true,
            testKey,
            roundTripValue,
            stateBefore,
            stateAfter,
            secondaryLikelyUsed,
        });
    } catch (error) {
        return NextResponse.json({
            ok: false,
            error: error?.message || 'kv_failover_test_failed',
            stateBefore,
            stateAfter: getKvFailoverState(),
        }, { status: 500 });
    }
}
