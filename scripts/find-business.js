const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const localPath = path.join(process.cwd(), 'servizephyr-firebase-adminsdk.json');
let serviceAccount;
if (fs.existsSync(localPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
} else {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function run() {
    const collections = ['restaurants', 'shops', 'street_vendors'];
    let found = [];
    for (const col of collections) {
        const snap = await db.collection(col).get();
        snap.forEach(doc => {
            const data = doc.data();
            const id = doc.id.toLowerCase();
            const name = (data.name || '').toLowerCase();
            if (id.includes('up-14') || name.includes('up 14') || id.includes('chaap') || name.includes('chaap') || id.includes('up14')) {
                found.push({ id: doc.id, name: data.name, collection: col });
            }
        });
    }
    console.log("Matching businesses:", JSON.stringify(found, null, 2));
}

run().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
