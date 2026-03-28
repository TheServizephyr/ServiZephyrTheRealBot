
import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
const DEFAULT_WAITLIST_TOKEN_BASE = 0;
const WAITLIST_COUNTER_TIMEZONE = 'Asia/Kolkata';

function randomUpperAlpha(length = 2) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(length);
    let output = '';
    for (let i = 0; i < length; i += 1) {
        output += alphabet[bytes[i] % alphabet.length];
    }
    return output;
}

function formatWaitlistToken(numberValue) {
    return `#${String(Math.max(0, Number(numberValue) || 0)).padStart(2, '0')}${randomUpperAlpha(2)}`;
}

function generateArrivalCode() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function getDateKeyInTimeZone(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: WAITLIST_COUNTER_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '0000';
    const month = parts.find((part) => part.type === 'month')?.value || '00';
    const day = parts.find((part) => part.type === 'day')?.value || '00';
    return `${year}-${month}-${day}`;
}

export async function POST(req) {
    try {
        const firestore = await getFirestore();
        const { restaurantId, name, phone, paxCount } = await req.json();

        if (!restaurantId || !name || !phone || paxCount === undefined || paxCount === null) {
            return NextResponse.json({ message: 'Missing required fields.' }, { status: 400 });
        }

        const normalizedPaxCount = Number.parseInt(String(paxCount), 10);
        if (!Number.isInteger(normalizedPaxCount) || normalizedPaxCount < 1 || normalizedPaxCount > 20) {
            return NextResponse.json({ message: 'Invalid guest count. Please enter between 1 and 20.' }, { status: 400 });
        }

        const phoneDigits = String(phone || '').replace(/\D/g, '');
        const normalizedPhone = phoneDigits.length > 10 ? phoneDigits.slice(-10) : phoneDigits;
        if (!/^\d{10}$/.test(normalizedPhone)) {
            return NextResponse.json({ message: 'Invalid phone number format.' }, { status: 400 });
        }

        // Validate restaurant exists
        const restaurantSnap = await firestore.collection('restaurants').doc(restaurantId).get();
        if (!restaurantSnap.exists) {
            return NextResponse.json({ message: 'Restaurant not found.' }, { status: 404 });
        }

        const restaurantData = restaurantSnap.data();
        const businessType = String(restaurantData?.businessType || 'restaurant').trim().toLowerCase();
        if (businessType === 'shop' || businessType === 'store' || businessType === 'street-vendor' || businessType === 'street_vendor') {
            return NextResponse.json({ message: 'Waitlist is only available for restaurant businesses.' }, { status: 403 });
        }
        if (restaurantData.isOpen === false) {
            return NextResponse.json({ message: 'Restaurant is currently closed. We are not accepting new waitlist entries.' }, { status: 403 });
        }
        if (!restaurantData.isWaitlistEnabled) {
            return NextResponse.json({ message: 'Waitlist is currently disabled for this restaurant.' }, { status: 403 });
        }

        const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
        const waitlistRef = firestore.collection('restaurants').doc(restaurantId).collection('waitlist');
        const activePhoneLockRef = restaurantRef.collection('waitlist_active_phone').doc(normalizedPhone);

        let entryId = null;
        let waitlistToken = null;
        let arrivalCode = null;
        const now = new Date();
        const nowIso = now.toISOString();
        const todayCounterDateKey = getDateKeyInTimeZone(now);

        await firestore.runTransaction(async (transaction) => {
            const businessSnap = await transaction.get(restaurantRef);
            const businessDataTx = businessSnap.data() || {};

            const lockSnap = await transaction.get(activePhoneLockRef);
            if (lockSnap.exists) {
                const lockData = lockSnap.data() || {};
                const existingEntryId = String(lockData.entryId || '').trim();
                if (existingEntryId) {
                    const existingEntryRef = waitlistRef.doc(existingEntryId);
                    const existingEntrySnap = await transaction.get(existingEntryRef);
                    const existingStatus = String(existingEntrySnap.data()?.status || '').toLowerCase();
                    if (existingEntrySnap.exists && ['pending', 'notified', 'arrived'].includes(existingStatus)) {
                        throw Object.assign(new Error('ALREADY_ON_WAITLIST'), { code: 'ALREADY_ON_WAITLIST' });
                    }
                } else {
                    throw Object.assign(new Error('ALREADY_ON_WAITLIST'), { code: 'ALREADY_ON_WAITLIST' });
                }
            }

            const storedCounterDateKey = String(businessDataTx.waitlistTokenCounterDate || '').trim();
            const shouldResetCounter = storedCounterDateKey !== todayCounterDateKey;
            const currentCounter = shouldResetCounter
                ? DEFAULT_WAITLIST_TOKEN_BASE
                : Math.max(DEFAULT_WAITLIST_TOKEN_BASE, Number(businessDataTx.waitlistTokenCounter || DEFAULT_WAITLIST_TOKEN_BASE));
            const nextCounter = currentCounter + 1;
            const tokenNumber = currentCounter;
            waitlistToken = formatWaitlistToken(tokenNumber);
            arrivalCode = generateArrivalCode();

            const newEntryRef = waitlistRef.doc();
            entryId = newEntryRef.id;
            const newEntryData = {
                id: newEntryRef.id,
                name: String(name || '').trim(),
                phone: normalizedPhone,
                paxCount: normalizedPaxCount,
                status: 'pending',
                queuePriority: 2,
                queueType: 'walk_in',
                waitlistTokenNumber: tokenNumber,
                waitlistToken,
                arrivalCode,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                restaurantId: restaurantId,
                restaurantName: restaurantData.name || 'Restaurant'
            };

            transaction.set(newEntryRef, newEntryData);
            transaction.set(restaurantRef, {
                waitlistTokenCounter: nextCounter,
                waitlistTokenCounterDate: todayCounterDateKey,
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            transaction.set(activePhoneLockRef, {
                phone: normalizedPhone,
                entryId: newEntryRef.id,
                status: 'active',
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                updatedAtIso: nowIso,
            }, { merge: true });
        });


        return NextResponse.json({
            message: 'Successfully joined the waitlist!',
            entryId,
            waitlistToken,
            arrivalCode,
        }, { status: 201 });

    } catch (error) {
        if (error?.code === 'ALREADY_ON_WAITLIST' || String(error?.message || '').includes('ALREADY_ON_WAITLIST')) {
            return NextResponse.json({ message: 'You are already on the waitlist for this restaurant.' }, { status: 409 });
        }
        console.error("PUBLIC JOIN WAITLIST ERROR:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
