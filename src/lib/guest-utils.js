import { nanoid } from 'nanoid';
import { FieldValue } from 'firebase-admin/firestore';

// --- OBFUSCATION LOGIC ---

/**
 * Obfuscates a Guest ID into a public reference string.
 * Format: <4_random_chars><base64_encoded_id_with_noise>
 * Goal: Make it look complex and hide the standard "g_" pattern in URL.
 */
export const obfuscateGuestId = (guestId) => {
    if (!guestId) return null;

    // 1. Add noise (salt) inside the string before encoding
    // Insert a random char after every 3rd char of the real ID
    let saltedId = "";
    const chars = guestId.split('');
    const noiseChars = "XpOr9LaZwQ";

    chars.forEach((c, index) => {
        saltedId += c;
        if ((index + 1) % 3 === 0) {
            saltedId += noiseChars[Math.floor(Math.random() * noiseChars.length)];
        }
    });

    // 2. Base64 encode the salted string
    const encoded = Buffer.from(saltedId).toString('base64');

    // 3. Add a random 4-char prefix to make the start of the string look changing
    const prefix = nanoid(4);

    // Public Ref
    return `${prefix}${encoded}`.replace(/\=/g, ''); // Remove padding for cleaner URL
};

/**
 * De-obfuscates a public reference string back to the real Guest ID.
 */
export const deobfuscateGuestId = (publicRef) => {
    try {
        if (!publicRef || publicRef.length < 5) return null;

        // 1. Remove 4-char prefix
        const encoded = publicRef.substring(4);

        // 2. Base64 decode
        const saltedId = Buffer.from(encoded, 'base64').toString('utf-8');

        // 3. Remove noise (every 4th char was noise)
        // Logic: The obfuscation inserted a char after every 3 chars of ORIGINAL.
        // So in the salted string, indices 3, 7, 11... are noise.
        // (0-indexed: 0,1,2 [3=noise], 4,5,6 [7=noise])

        let guestId = "";
        for (let i = 0; i < saltedId.length; i++) {
            // If (i + 1) is divisible by 4, it's a noise character *in the salted string*
            // Wait, let's trace:
            // Orig: A B C D E F
            // Salted: A B C [N] D E F [N]
            // Indices: 0 1 2  3  4 5 6  7
            // Yes, indices 3, 7, 11 are noise.
            if ((i + 1) % 4 !== 0) {
                guestId += saltedId[i];
            }
        }

        return guestId;
    } catch (e) {
        console.error("Failed to deobfuscate guest ID:", e);
        return null;
    }
};


// --- PROFILE MANAGEMENT ---

export const getOrCreateGuestProfile = async (firestore, phone) => {
    if (!phone) return null;
    const normalizedPhone = phone.startsWith('91') && phone.length === 12 ? phone.substring(2) : (phone.length > 10 ? phone.slice(-10) : phone);

    console.log(`[GuestUtils] Processing profile for phone: ${normalizedPhone}`);

    // 1. Check if Guest Profile already exists
    // We assume an index on 'phone' in guest_profiles
    const guestQuery = await firestore.collection('guest_profiles')
        .where('phone', '==', normalizedPhone)
        .limit(1)
        .get();

    if (!guestQuery.empty) {
        const doc = guestQuery.docs[0];
        console.log(`[GuestUtils] Found existing Guest Profile: ${doc.id}`);
        return {
            guestId: doc.id,
            data: doc.data(),
            isNew: false
        };
    }

    // 2. Check for Legacy Unclaimed Profile (Migration)
    const unclaimedRef = firestore.collection('unclaimed_profiles').doc(normalizedPhone);
    const unclaimedSnap = await unclaimedRef.get();

    let initialData = {
        phone: normalizedPhone,
        createdAt: FieldValue.serverTimestamp(),
        addresses: [],
        migratedFrom: null
    };

    if (unclaimedSnap.exists) {
        console.log(`[GuestUtils] Found Legacy Unclaimed Profile. Migrating...`);
        const legacyData = unclaimedSnap.data();
        initialData = {
            ...initialData,
            name: legacyData.name || null,
            addresses: legacyData.addresses || [],
            orderedFrom: legacyData.orderedFrom || [],
            migratedFrom: 'unclaimed_profiles'
        };
    }

    // 3. Create New Guest Profile
    const guestId = `g_${nanoid(16)}`; // Internal Secure ID
    const guestRef = firestore.collection('guest_profiles').doc(guestId);

    await firestore.runTransaction(async (t) => {
        t.set(guestRef, initialData);
        if (unclaimedSnap.exists) {
            // Optional: Delete old profile immediately or keep for backup?
            // Deleting to prevent split-brain data
            t.delete(unclaimedRef);
        }
    });

    console.log(`[GuestUtils] Created New Guest Profile: ${guestId}`);
    return {
        guestId: guestId,
        data: initialData,
        isNew: true
    };
};
