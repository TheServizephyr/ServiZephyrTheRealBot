import { getFirestore, FieldValue } from '@/lib/firebase-admin';

/**
 * Check if restaurant has exceeded rate limit
 * @param {string} restaurantId - Restaurant ID
 * @param {number} limitPerMinute - Max orders per minute (default: 50)
 * @returns {Promise<{allowed: boolean}>}
 */
export async function checkRateLimit(restaurantId, limitPerMinute = 50) {
    const firestore = await getFirestore();

    // Generate minute key (e.g., "2026-01-06-03-30")
    const now = new Date();
    const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

    const docId = `restaurant_${restaurantId}_${minuteKey}`;
    const ref = firestore.collection('rate_limits').doc(docId);

    // Atomic transaction for count increment
    return await firestore.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);

        if (!snap.exists) {
            // First request this minute
            transaction.set(ref, {
                restaurantId,
                minute: minuteKey,
                count: 1,
                createdAt: FieldValue.serverTimestamp(),
            });
            return { allowed: true };
        }

        const currentCount = snap.data().count;

        if (currentCount >= limitPerMinute) {
            // Limit exceeded
            console.log(`[Rate Limit] ${restaurantId} exceeded ${limitPerMinute}/min (current: ${currentCount})`);
            return { allowed: false };
        }

        // Increment counter
        transaction.update(ref, {
            count: FieldValue.increment(1),
        });

        return { allowed: true };
    });
}
