// Test obfuscation/deobfuscation
const { nanoid } = require('nanoid');

// Copy-paste the exact functions from guest-utils.js
const obfuscateGuestId = (guestId) => {
    if (!guestId) return null;

    let saltedId = "";
    const chars = guestId.split('');
    const noiseChars = "XpOr9LaZwQ";

    chars.forEach((c, index) => {
        saltedId += c;
        if ((index + 1) % 3 === 0) {
            saltedId += noiseChars[Math.floor(Math.random() * noiseChars.length)];
        }
    });

    const encoded = Buffer.from(saltedId).toString('base64');
    const prefix = nanoid(4);
    return `${prefix}${encoded}`.replace(/=/g, '');
};

const deobfuscateGuestId = (publicRef) => {
    try {
        if (!publicRef || publicRef.length < 5) return null;

        const encoded = publicRef.substring(4);
        const saltedId = Buffer.from(encoded, 'base64').toString('utf-8');

        let guestId = "";
        for (let i = 0; i < saltedId.length; i++) {
            if ((i + 1) % 4 !== 0) {
                guestId += saltedId[i];
            }
        }

        return guestId;
    } catch (e) {
        console.error("Failed to deobfuscate:", e);
        return null;
    }
};

// TEST
const testId = "g_DNkkRgV9ecr5jKxA";
console.log("Original ID:", testId);

const obfuscated = obfuscateGuestId(testId);
console.log("Obfuscated:", obfuscated);

const deobfuscated = deobfuscateGuestId(obfuscated);
console.log("Deobfuscated:", deobfuscated);

console.log("Match:", testId === deobfuscated ? "✅ YES" : "❌ NO");
