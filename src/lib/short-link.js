import { randomBytes } from 'crypto';

const SHORT_LINK_COLLECTION = 'short_links';
const SHORT_LINK_LENGTH = 8;
const SHORT_LINK_MAX_ATTEMPTS = 5;
const BILL_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generates a random short code of the given length using an unambiguous alphabet.
 */
export function generateShortCode(length = SHORT_LINK_LENGTH) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

/**
 * Creates a short link for a bill URL and saves it to Firestore.
 * Returns the short code (e.g. "Ab3kR9mZ").
 * The full short URL would be: `https://www.servizephyr.com/a/${shortCode}`
 *
 * @param {object} params
 * @param {FirebaseFirestore.Firestore} params.firestore
 * @param {string} params.targetPath - The path to redirect to (e.g. "/public/bill/ORDER_ID?token=TOKEN")
 * @param {string} params.orderId
 * @param {string} [params.businessId]
 * @param {string} [params.customerPhone]
 * @returns {Promise<string>} The generated short code
 */
export async function createShortLink({
    firestore,
    targetPath,
    orderId,
    businessId,
    customerPhone,
    purpose = 'generic',
    ttlMs = BILL_LINK_TTL_MS,
    extraData = {},
}) {
    for (let attempt = 0; attempt < SHORT_LINK_MAX_ATTEMPTS; attempt += 1) {
        const code = generateShortCode();
        const docRef = firestore.collection(SHORT_LINK_COLLECTION).doc(code);
        try {
            await docRef.create({
                code,
                targetPath,
                purpose,
                orderId: orderId || null,
                businessId: businessId || null,
                customerPhone: customerPhone || null,
                accessCount: 0,
                status: 'active',
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + ttlMs),
                ...extraData,
            });
            return code;
        } catch (error) {
            const alreadyExists =
                error?.code === 6 ||
                /already exists/i.test(String(error?.message || ''));
            if (!alreadyExists) {
                throw error;
            }
        }
    }
    throw new Error('Unable to generate short link code after max attempts.');
}

export async function createShortBillLink({ firestore, targetPath, orderId, businessId, customerPhone }) {
    return createShortLink({
        firestore,
        targetPath,
        orderId,
        businessId,
        customerPhone,
        purpose: 'bill_view',
        ttlMs: BILL_LINK_TTL_MS,
    });
}
