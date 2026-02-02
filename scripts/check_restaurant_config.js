
const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Manually read .env.local
const envPath = path.join(__dirname, '../.env.local');
let serviceAccount;

try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON='([^']+)'/);
    if (match && match[1]) {
        serviceAccount = JSON.parse(match[1]);
    } else {
        throw new Error("Regex match failed for service account json");
    }
} catch (e) {
    console.error("Failed to read credentials from .env.local:", e.message);
    process.exit(1);
}

if (!getApps().length) {
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

async function checkAndFixConfig() {
    const restaurantId = "ashwani's-restaurant";
    console.log(`Checking config for: ${restaurantId}`);

    const docRef = db.collection('restaurants').doc(restaurantId);
    const doc = await docRef.get();

    if (!doc.exists) {
        console.log('Restaurant NOT found in "restaurants" collection.');
        return;
    }

    const data = doc.data();
    console.log('--- Current Settings ---');
    console.log('deliveryCodEnabled:', data.deliveryCodEnabled);
    console.log('pickupPodEnabled:', data.pickupPodEnabled);
    console.log('dineInPayAtCounterEnabled:', data.dineInPayAtCounterEnabled);

    if (data.deliveryCodEnabled !== true) {
        console.log('⚠️ COD is DISABLED. Enabling it now...');
        await docRef.update({
            deliveryCodEnabled: true,
            pickupPodEnabled: true, // Also enable Pickup COD just in case
            dineInPayAtCounterEnabled: true // And Dine-in
        });
        console.log('✅ COD Enabled Successfully.');
    } else {
        console.log('✅ COD is already enabled.');
    }
}

checkAndFixConfig().catch(console.error);
